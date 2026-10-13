package com.autogram.app.features.cloudtransfer.upload

import android.content.Context
import com.autogram.app.features.cloud.CloudScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import uniffi.autogram_android_bridge.*

/** Original documents only. Visual albums require a distinct prepared-media contract. */
interface UploadQueue {
    suspend fun enqueue(input: NativeUploadInput): NativeUploadAdmission
    fun list(account: String): List<NativeCloudUpload>
    fun control(account: String, operation: String, action: String)
    suspend fun reconcile(account: String, operation: String)
    fun schedule(context: Context): Boolean
    fun wake(context: Context): Boolean
}

class NativeUploadQueue(private val profileName: String) : UploadQueue {
    private val profileId = "android-original-document-v1"
    override suspend fun enqueue(input: NativeUploadInput): NativeUploadAdmission {
        val existing = listTransferProfiles(input.accountId).firstOrNull { it.profileId == profileId }
        val profile = existing ?: saveTransferProfile(input.accountId, profileId, 0, documentSettings(profileName))
        // No active-profile selection or edit. Native validation refuses a changed,
        // unsupported profile; the queue preserves the admitted revision snapshot.
        return enqueueCloudUploadSkippingIdentical(input, profile.profileId, null)
    }
    override fun list(account: String) = listCloudUploads(account)
    override fun control(account: String, operation: String, action: String) =
        controlCloudUpload(account, operation, action)
    override suspend fun reconcile(account: String, operation: String) {
        reconcileCloudUpload(account, operation)
    }
    override fun schedule(context: Context) = UploadScheduling.schedule(context)
    override fun wake(context: Context) = UploadScheduling.startFromUi(context)
}

internal class NativePhotoAlbumQueue {
    suspend fun packingPreference(account: String): Pair<NativeAlbumPacking, Int> {
        val profiles = listTransferProfiles(account)
        val settings = profiles.firstOrNull { it.profileId == PROFILE_ID }?.settings
            ?: activeTransferProfile(account)?.settings
        val policy = settings?.albumPacking?.takeUnless { it == NativeAlbumPacking.NEVER }
            ?: NativeAlbumPacking.SMART_ADAPTIVE
        return policy to (settings?.albumGroupSize?.toInt()?.coerceIn(2, 10) ?: 10)
    }

    suspend fun prepareProfile(
        account: String,
        name: String,
        packing: NativeAlbumPacking,
        customSize: Int,
    ): NativeTransferProfile {
        val selected = activeTransferProfile(account)
        val profiles = listTransferProfiles(account)
        val existing = profiles.firstOrNull { it.profileId == PROFILE_ID }
        val source = selected?.settings ?: existing?.settings ?: documentSettings(name)
        val settings = source.copy(
            name = name,
            qualityMode = if (source.qualityMode == NativeQualityMode.DOCUMENT) NativeQualityMode.ORIGINAL else source.qualityMode,
            presentation = NativePresentationMode.FORCE_NATIVE_MEDIA,
            groupAsAlbum = true,
            albumPacking = packing,
            albumGroupSize = customSize.coerceIn(2, 10).toUInt(),
            albumAvoidSingle = true,
        )
        if (existing?.settings == settings) return existing
        return saveTransferProfile(account, PROFILE_ID, existing?.revision ?: 0, settings)
    }

    suspend fun enqueueBatch(inputs: List<NativeAlbumInput>, profile: NativeTransferProfile): List<NativeCloudAlbum> =
        profileMutex.withLock {
            require(inputs.isNotEmpty())
            val current = listTransferProfiles(profile.accountId).firstOrNull { it.profileId == profile.profileId }
                ?: throw NativeProfileException.RequestFailed("profile_not_found")
            if (current.revision != profile.revision || current.settings != profile.settings) {
                throw NativeProfileException.RequestFailed("profile_conflict")
            }
            val admitted = mutableListOf<NativeCloudAlbum>()
            inputs.forEach { input ->
                try {
                    admitted += enqueueCloudAlbum(input, profile.profileId)
                } catch (cancelled: kotlinx.coroutines.CancellationException) {
                    throw cancelled
                } catch (failure: Throwable) {
                    if (admitted.isNotEmpty()) throw PartialPhotoAlbumBatchFailure(admitted.size, inputs.size, failure)
                    throw failure
                }
            }
            admitted
        }

    fun list(account: String) = listCloudAlbums(account)
    fun control(account: String, operation: String, action: String) =
        controlCloudAlbum(account, operation, action)
    suspend fun reconcile(account: String, operation: String) =
        reconcileCloudAlbum(account, operation)
    suspend fun start(account: String, operation: String) = startCloudAlbum(account, operation)
    fun schedule(context: Context) = UploadScheduling.schedule(context)
    fun wake(context: Context) = UploadScheduling.startFromUi(context)

    companion object {
        private const val PROFILE_ID = "android-native-photo-album-v1"
        private val profileMutex = Mutex()
    }
}

internal class PartialPhotoAlbumBatchFailure(val admitted: Int, val total: Int, cause: Throwable) :
    IllegalStateException("photo_album_batch_partial", cause)

internal fun documentSettings(name: String) = NativeTransferSettings(
    name = name, qualityMode = NativeQualityMode.DOCUMENT,
    presentation = NativePresentationMode.FORCE_DOCUMENT,
    uploadConcurrency = 1u, downloadConcurrency = 4u, groupAsAlbum = false,
    albumPacking = NativeAlbumPacking.NEVER, albumGroupSize = 10u,
    albumAvoidSingle = true, albumFailure = NativeAlbumFailure.ATOMIC_STRICT,
    groupDocuments = false, groupAudio = false, groupOriginalDocuments = false,
    oversizeAction = NativeOversizeAction.SKIP,
    encoder = NativeEncoderSettings(NativeEncoderStrategy.DISABLE_REENCODE,
        NativeEncoderResources.ECO, null, 1u, 50u, 256u, false),
    silent = false, spoiler = false,
)

internal fun canonicalUploadPeer(account: String, peer: String): String =
    if (peer == "me") account.removePrefix("tg_").also { require(it.toLongOrNull()?.let { id -> id > 0 } == true) }
    else peer

internal fun NativeCloudUpload.belongsTo(scope: CloudScope) =
    accountId == scope.accountId && peerId == canonicalUploadPeer(scope.accountId, scope.peerId) && topicId?.toLong() == scope.topicId

internal fun validateAdmission(input: NativeUploadInput, result: NativeUploadAdmission) {
    when (result) {
        is NativeUploadAdmission.Queued -> check(result.upload.let {
            it.operationId == input.operationId && it.accountId == input.accountId &&
                it.peerId == canonicalUploadPeer(input.accountId, input.peerId) && it.topicId == input.topicId && it.filename == input.filename
        }) { "upload_acknowledgement_scope" }
        is NativeUploadAdmission.Reused -> check(result.existing.let {
            it.operationId == input.operationId && it.accountId == input.accountId &&
                it.peerId == canonicalUploadPeer(input.accountId, input.peerId) && it.topicId == input.topicId && it.messageId > 0
        }) { "upload_reuse_scope" }
    }
}
