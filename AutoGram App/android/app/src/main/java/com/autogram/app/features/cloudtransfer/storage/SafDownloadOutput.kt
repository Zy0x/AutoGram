package com.autogram.app.features.cloudtransfer.storage

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.os.Process
import android.provider.DocumentsContract
import android.system.ErrnoException
import android.system.OsConstants
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.URI
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.CancellationException

/** Actual SAF adapter. No URI/path logging, deletion, metadata-only success or native coupling. */
class SafDownloadOutput(context: Context) {
    private val context = context.applicationContext
    private val resolver = this.context.contentResolver
    private val identity = Any()

    fun createDocumentRequest(mimeType: String, displayName: String): CreateDocumentRequest {
        require(mimeType.matches(Regex("[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+"))) {
            "Invalid MIME type"
        }
        require(displayName.isNotBlank() && displayName.length <= 255 &&
            displayName.none { it.isISOControl() || it == '/' || it == '\\' }) {
            "Invalid display name"
        }
        return CreateDocumentRequest.issue(identity, mimeType, displayName)
    }

    /** Call ONLY for the actual activity result of this exact request, never a stored/open URI. */
    fun acceptCreatedDocument(
        request: CreateDocumentRequest,
        resultCode: Int,
        result: Intent?,
        persistIfGranted: Boolean = true,
    ): DocumentAcceptance {
        if (!request.claim(identity)) return DocumentAcceptance.Rejected(OutputError.INVALID_OWNERSHIP)
        if (resultCode != Activity.RESULT_OK) return DocumentAcceptance.Rejected(OutputError.PICKER_CANCELLED)
        val uri = result?.data ?: return DocumentAcceptance.Rejected(OutputError.INVALID_URI)
        return try {
            validateUri(uri)
            if ((result.flags and ACCESS) != ACCESS) throw OutputFault(OutputError.GRANT_REQUIRED)
            requireAccess(uri)
            var persisted = false
            if (persistIfGranted && result.flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION != 0) {
                try {
                    // Both flags were required above. Do not pass unrelated activity-result flags.
                    resolver.takePersistableUriPermission(uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
                    persisted = resolver.persistedUriPermissions.any {
                        it.uri == uri && it.isReadPermission && it.isWritePermission
                    }
                    if (!persisted) throw OutputFault(OutputError.PERSISTENCE_UNAVAILABLE)
                } catch (_: SecurityException) {
                    throw OutputFault(OutputError.PERSISTENCE_UNAVAILABLE)
                }
            }
            DocumentAcceptance.Accepted(CreatedDocumentOwnership.issue(identity, uri, persisted))
        } catch (fault: OutputFault) {
            DocumentAcceptance.Rejected(fault.error)
        } catch (_: SecurityException) {
            DocumentAcceptance.Rejected(OutputError.GRANT_REVOKED)
        } catch (_: Exception) {
            DocumentAcceptance.Rejected(OutputError.PROVIDER_FAILURE)
        }
    }

    /** One attempt per ownership token, including failure/cancellation. Pick a new output to retry. */
    suspend fun publish(
        staging: ApprovedStagingFile,
        expected: ExpectedOutput,
        ownership: CreatedDocumentOwnership,
    ): OutputPublication {
        val signal = CancellationSignal()
        // Blocking provider IO runs independently on IO workers. Cancellation immediately
        // cancels descriptor opens and closes already opened streams to unblock reads/writes.
        return publicationIO({ signal.cancel() }) { cancellation ->
            val progress = PublicationProgress()
            try {
                cancellation.check()
                if (!ownership.claim(identity)) throw OutputFault(OutputError.INVALID_OWNERSHIP)
                val uri = ownership.uri
                progress.phase = OutputPhase.GRANT
                validateUri(uri)
                requireAccess(uri)
                progress.phase = OutputPhase.STAGING
                val source = cancellation.track(staging.owner.open(staging, expected))
                source.use {
                    progress.phase = OutputPhase.PREFLIGHT
                    read(uri, signal, cancellation).use { empty ->
                        cancellation.check()
                        if (empty.read() != -1) throw OutputFault(OutputError.TARGET_NOT_EMPTY)
                    }
                    cancellation.check()
                    VerifiedStreamCopy.publish(expected, { source }, {
                        requireAccess(uri)
                        // Append never truncates even if a buggy provider returns an existing
                        // document. Nonempty targets were rejected above; read-back detects races.
                        write(uri, signal, cancellation)
                    }, {
                        requireAccess(uri)
                        read(uri, signal, cancellation)
                    }, {
                        cancellation.check()
                        requireAccess(uri)
                    }, progress).also { requireAccess(uri) }
                }
            } catch (_: CancellationException) {
                throw CancellationException("Output publication cancelled")
            } catch (fault: OutputFault) {
                progress.failed(fault.error)
            } catch (_: SecurityException) {
                progress.failed(OutputError.GRANT_REVOKED)
            } catch (failure: Exception) {
                progress.failed(classify(failure, progress.phase))
            }
        }
    }

    private fun read(uri: Uri, signal: CancellationSignal, cancellation: PublicationCancellation): InputStream {
        requireAccess(uri)
        val parcel = resolver.openFileDescriptor(uri, "r", signal)
            ?: throw OutputFault(OutputError.PROVIDER_UNAVAILABLE)
        return cancellation.track(object : ParcelFileDescriptor.AutoCloseInputStream(parcel) {
            override fun read(): Int = super.read().also { if (it == -1) parcel.checkError() }
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int =
                super.read(bytes, offset, length).also { if (it == -1) parcel.checkError() }
        })
    }

    private fun write(uri: Uri, signal: CancellationSignal, cancellation: PublicationCancellation): OutputStream {
        requireAccess(uri)
        val parcel = resolver.openFileDescriptor(uri, "wa", signal)
            ?: throw OutputFault(OutputError.PROVIDER_UNAVAILABLE)
        return cancellation.track(object : ParcelFileDescriptor.AutoCloseOutputStream(parcel) {
            override fun close() {
                try { parcel.checkError() } finally { super.close() }
            }
        })
    }

    private fun requireAccess(uri: Uri) {
        if (context.checkUriPermission(uri, Process.myPid(), Process.myUid(), ACCESS) !=
            PackageManager.PERMISSION_GRANTED) throw OutputFault(OutputError.GRANT_REVOKED)
    }

    private fun validateUri(uri: Uri) {
        val valid = try {
            URI(uri.toString())
            uri.scheme == "content" &&
                uri.encodedAuthority?.matches(Regex("[A-Za-z0-9_.-]+")) == true &&
                uri.query == null && uri.fragment == null &&
                uri.pathSegments.size == 2 && uri.pathSegments[0] == "document" &&
                uri.pathSegments[1].isNotBlank() && DocumentsContract.isDocumentUri(context, uri)
        } catch (_: Exception) { false }
        if (!valid) throw OutputFault(OutputError.INVALID_URI)
    }

    private fun classify(failure: Exception, phase: OutputPhase): OutputError {
        var cause: Throwable? = failure
        repeat(8) {
            val current = cause
            if (current is ErrnoException && current.errno == OsConstants.ENOSPC)
                return OutputError.SPACE_EXHAUSTED
            cause = current?.cause
        }
        return when {
            failure is FileNotFoundException && phase == OutputPhase.STAGING -> OutputError.STAGING_UNAVAILABLE
            failure is FileNotFoundException -> OutputError.PROVIDER_UNAVAILABLE
            failure is IOException -> OutputError.IO_FAILURE
            else -> OutputError.PROVIDER_FAILURE
        }
    }

    private companion object {
        const val ACCESS = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    }
}

/** Opaque in-memory launch capability; getter returns a fresh Intent to avoid mutating proof. */
class CreateDocumentRequest private constructor(
    private val issuer: Any,
    private val mimeType: String,
    private val displayName: String,
) {
    private val used = AtomicBoolean(false)
    val intent: Intent get() = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = mimeType
        putExtra(Intent.EXTRA_TITLE, displayName)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    }
    internal fun claim(owner: Any) = issuer === owner && used.compareAndSet(false, true)
    override fun toString() = "CreateDocumentRequest(redacted)"
    internal companion object {
        fun issue(owner: Any, mime: String, name: String) = CreateDocumentRequest(owner, mime, name)
    }
}

/** Caller keeps this only for its newly created document. Never serialize or reconstruct it. */
class CreatedDocumentOwnership private constructor(
    private val issuer: Any,
    val uri: Uri,
    val persistedAccess: Boolean,
) {
    private val used = AtomicBoolean(false)
    internal fun claim(owner: Any) = issuer === owner && used.compareAndSet(false, true)
    override fun toString() = "CreatedDocumentOwnership(redacted)"
    internal companion object {
        fun issue(owner: Any, uri: Uri, persisted: Boolean) = CreatedDocumentOwnership(owner, uri, persisted)
    }
}

sealed interface DocumentAcceptance {
    data class Accepted(val ownership: CreatedDocumentOwnership) : DocumentAcceptance
    data class Rejected(val error: OutputError) : DocumentAcceptance
}
