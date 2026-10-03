package com.autogram.app.features.cloudtransfer.storage

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.system.Os
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** No Telegram or personal file access. Provider tests require parent-owned manifest registration. */
@RunWith(AndroidJUnit4::class)
class SafDownloadOutputTest {
    private lateinit var context: Context
    private lateinit var testContext: Context
    private lateinit var area: AppOwnedStaging
    private lateinit var stagingDirectory: File
    private lateinit var source: File
    private lateinit var adapter: SafDownloadOutput
    private val fixtures = mutableListOf<Uri>()
    private val bytes = ByteArray(200_017) { (it * 13).toByte() }
    private val access = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION

    @Before fun setup() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        context = instrumentation.targetContext
        testContext = instrumentation.context
        area = AppOwnedStaging(context)
        stagingDirectory = File(area.directory, "fixture-${UUID.randomUUID()}")
        assertTrue(stagingDirectory.mkdirs())
        source = File(stagingDirectory, "completed.bin").apply { writeBytes(bytes) }
        adapter = SafDownloadOutput(context)
    }

    @After fun cleanup() {
        fixtures.forEach { uri ->
            fixtureCall(uri, "revokeFixture")
            fixtureCall(uri, "removeFixture")
        }
        // Explicit list and UUID-bound files only. Never recursively delete through a symlink.
        for (file in stagingDirectory.listFiles().orEmpty()) {
            assertEquals(stagingDirectory.absolutePath, file.absoluteFile.parent)
            assertTrue(file.delete())
        }
        assertTrue(stagingDirectory.delete())
    }

    @Test fun pickerRequestIsCreateOnlyAndSingleUse() {
        val request = adapter.createDocumentRequest("application/octet-stream", "synthetic.bin")
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, request.intent.action)
        assertTrue(request.intent.hasCategory(Intent.CATEGORY_OPENABLE))
        assertEquals(access, request.intent.flags and access)
        assertEquals(DocumentAcceptance.Rejected(OutputError.PICKER_CANCELLED),
            adapter.acceptCreatedDocument(request, Activity.RESULT_CANCELED, null))
        assertEquals(DocumentAcceptance.Rejected(OutputError.INVALID_OWNERSHIP),
            adapter.acceptCreatedDocument(request, Activity.RESULT_OK, Intent()))
    }

    @Test fun foreignRequestCannotIssueOwnership() {
        val other = SafDownloadOutput(context)
        assertEquals(DocumentAcceptance.Rejected(OutputError.INVALID_OWNERSHIP),
            other.acceptCreatedDocument(adapter.createDocumentRequest("application/octet-stream", "synthetic.bin"),
                Activity.RESULT_OK, Intent()))
    }

    @Test fun malformedAndForeignSchemesAreRejected() {
        for (value in listOf("file:///private/data", "https://example.invalid/file", "content://",
            "content://authority@host/document/a", "content://authority/document/%xx",
            "content://authority/tree/a/document/b", "content://authority/document/a?x=1")) {
            val result = adapter.acceptCreatedDocument(
                adapter.createDocumentRequest("application/octet-stream", "synthetic.bin"), Activity.RESULT_OK,
                Intent().setData(Uri.parse(value)).addFlags(access),
            )
            assertEquals(DocumentAcceptance.Rejected(OutputError.INVALID_URI), result)
        }
    }

    @Test fun stagingRejectsOutsidePathTraversalAndSymlinks() {
        val outside = File(context.cacheDir, "output-staging-test-${UUID.randomUUID()}")
        try {
            outside.writeBytes(bytes)
            assertEquals(StagingApproval.Rejected(OutputError.UNSAFE_STAGING), area.approve(outside))
            assertEquals(StagingApproval.Rejected(OutputError.UNSAFE_STAGING),
                area.approve(File(stagingDirectory, "../${stagingDirectory.name}/completed.bin")))
            val link = File(stagingDirectory, "link.bin")
            Os.symlink(source.path, link.path)
            assertEquals(StagingApproval.Rejected(OutputError.UNSAFE_STAGING), area.approve(link))
            val ancestor = File(stagingDirectory, "linked-directory")
            Os.symlink(stagingDirectory.path, ancestor.path)
            assertEquals(StagingApproval.Rejected(OutputError.UNSAFE_STAGING), area.approve(File(ancestor, source.name)))
        } finally { assertTrue(outside.delete()) }
    }

    @Test fun approvedDescriptorRejectsReplacementAndUnexpectedSize() {
        val approval = (area.approve(source) as StagingApproval.Approved).file
        val wrongSize = ExpectedOutput.parse(bytes.size.toLong() + 1, expected().sha256)!!
        assertEquals(OutputError.SOURCE_SIZE_MISMATCH,
            assertThrows(OutputFault::class.java) { area.open(approval, wrongSize).close() }.error)
        val original = File(stagingDirectory, "original.bin")
        assertTrue(source.renameTo(original))
        source.writeBytes(bytes)
        assertEquals(OutputError.UNSAFE_STAGING,
            assertThrows(OutputFault::class.java) { area.open(approval, expected()).close() }.error)
    }

    @Test fun actualProviderCopyAndNonPersistableGrant() = runBlocking {
        val uri = fixture("normal")
        grant(uri)
        val accepted = accept(uri) as DocumentAcceptance.Accepted
        assertFalse(accepted.ownership.persistedAccess)
        val result = adapter.publish(approved(), expected(), accepted.ownership)
        assertTrue(result is OutputPublication.Verified)
        context.contentResolver.openInputStream(uri)!!.use { assertArrayEquals(bytes, it.readBytes()) }
        assertEquals(OutputError.INVALID_OWNERSHIP,
            (adapter.publish(approved(), expected(), accepted.ownership) as OutputPublication.Failed).error)
    }

    @Test fun actualRevokedGrantFailsBeforeWriting() = runBlocking {
        val uri = fixture("normal")
        grant(uri)
        val token = (accept(uri) as DocumentAcceptance.Accepted).ownership
        fixtureCall(uri, "revokeFixture")
        val failure = adapter.publish(approved(), expected(), token) as OutputPublication.Failed
        assertEquals(OutputError.GRANT_REVOKED, failure.error)
        assertFalse(failure.partialDocumentMayRemain)
    }

    @Test fun missingReadOrWriteResultGrantIsRejected() {
        val uri = fixture("normal")
        grant(uri)
        for (flags in listOf(0, Intent.FLAG_GRANT_READ_URI_PERMISSION, Intent.FLAG_GRANT_WRITE_URI_PERMISSION)) {
            assertEquals(DocumentAcceptance.Rejected(OutputError.GRANT_REQUIRED), accept(uri, flags))
        }
    }

    @Test fun resultCannotClaimPersistablePermissionThatPlatformDidNotGrant() {
        val uri = fixture("normal")
        grant(uri)
        assertEquals(DocumentAcceptance.Rejected(OutputError.PERSISTENCE_UNAVAILABLE),
            accept(uri, access or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION))
    }

    @Test fun persistenceIsTakenOnlyFromAnActualPersistableGrant() {
        val uri = fixture("normal")
        fixtureCall(uri, "grantPersistableFixture")
        val accepted = accept(uri, access or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
            as DocumentAcceptance.Accepted
        assertTrue(accepted.ownership.persistedAccess)
        assertTrue(context.contentResolver.persistedUriPermissions.any {
            it.uri == uri && it.isReadPermission && it.isWritePermission
        })
    }

    @Test fun existingNonemptyDocumentIsNeverChanged() = runBlocking {
        val uri = fixture("nonempty")
        grant(uri)
        val token = (accept(uri) as DocumentAcceptance.Accepted).ownership
        val failure = adapter.publish(approved(), expected(), token) as OutputPublication.Failed
        assertEquals(OutputError.TARGET_NOT_EMPTY, failure.error)
        context.contentResolver.openInputStream(uri)!!.use { assertArrayEquals(byteArrayOf(42), it.readBytes()) }
    }

    @Test fun providerShortWriteCorruptionUnreadabilityAndRevocationNeverSucceed() = runBlocking {
        for ((behavior, error) in listOf("short" to OutputError.OUTPUT_SIZE_MISMATCH,
            "corrupt" to OutputError.OUTPUT_HASH_MISMATCH, "unreadable" to OutputError.PROVIDER_UNAVAILABLE,
            "revoked" to OutputError.GRANT_REVOKED)) {
            val uri = fixture(behavior)
            grant(uri)
            val token = (accept(uri) as DocumentAcceptance.Accepted).ownership
            val failure = adapter.publish(approved(), expected(), token) as OutputPublication.Failed
            assertEquals(error, failure.error)
            assertEquals(OutputPhase.VERIFY, failure.phase)
            assertTrue(failure.partialDocumentMayRemain)
            // Fixture remains present after failure; adapter never calls deleteDocument.
            context.contentResolver.query(uri, null, null, null, null)!!.use { assertTrue(it.moveToFirst()) }
        }
    }

    private fun fixture(behavior: String): Uri {
        val authority = DownloadOutputFixtureProvider.AUTHORITY
        assertNotNull("Download provider fixture must be registered; never skip output verification",
            testContext.packageManager.resolveContentProvider(authority, 0))
        val base = Uri.parse("content://${DownloadFixtureControlProvider.AUTHORITY}")
        val id = context.contentResolver.call(base, "createFixture", behavior, null)!!.getString("id")!!
        return DocumentsContract.buildDocumentUri(authority, id).also { fixtures.add(it) }
    }

    private fun fixtureCall(uri: Uri, method: String) = context.contentResolver.call(
        Uri.parse("content://${DownloadFixtureControlProvider.AUTHORITY}"), method,
        DocumentsContract.getDocumentId(uri), null,
    )
    private fun grant(uri: Uri) { fixtureCall(uri, "grantFixture") }
    private fun accept(uri: Uri, flags: Int = access) = adapter.acceptCreatedDocument(
        adapter.createDocumentRequest("application/octet-stream", "synthetic.bin"), Activity.RESULT_OK,
        Intent().setData(uri).addFlags(flags),
    )
    private fun approved() = (area.approve(source) as StagingApproval.Approved).file
    private fun expected() = ExpectedOutput.parse(bytes.size.toLong(),
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) })!!
}
