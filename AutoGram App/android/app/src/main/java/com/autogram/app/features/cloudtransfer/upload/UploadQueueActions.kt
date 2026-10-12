package com.autogram.app.features.cloudtransfer.upload

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Start already accepted uploads without turning queue-worker failure into false success. */
internal suspend fun wakeUploadQueue(queue: UploadQueue, context: Context): Boolean = try {
    withContext(Dispatchers.IO) { queue.wake(context) }
} catch (cancelled: CancellationException) {
    throw cancelled
} catch (_: Exception) {
    false
} catch (_: LinkageError) {
    false
}

/** A picker cancellation must not prevent already accepted work from being scheduled. */
internal suspend fun wakeAcceptedUploads(queue: UploadQueue, context: Context, count: Int) {
    if (count <= 0) return
    try {
        withContext(kotlinx.coroutines.NonCancellable + Dispatchers.IO) { queue.wake(context) }
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (_: Exception) {
        // Persisted queue scheduling is retried by the panel's NonCancellable cleanup.
    } catch (_: LinkageError) {
        // The operation stays persisted; the truthful result is still partial acceptance.
    }
}
