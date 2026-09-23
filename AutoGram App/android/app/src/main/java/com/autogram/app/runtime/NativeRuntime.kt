package com.autogram.app.runtime

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

enum class NativeRuntimeStatus { STARTING, READY, UNAVAILABLE }

/** Runtime readiness is local bridge health, never evidence of Telegram authorization. */
object NativeRuntime {
    private val mutableStatus = MutableStateFlow(NativeRuntimeStatus.STARTING)
    val status = mutableStatus.asStateFlow()
    private val changes = MutableSharedFlow<String>(
        extraBufferCapacity = 16,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val events = changes.asSharedFlow()

    fun ready() { mutableStatus.value = NativeRuntimeStatus.READY }
    fun unavailable() { mutableStatus.value = NativeRuntimeStatus.UNAVAILABLE }

    fun invalidate(eventType: String) {
        // Never retain or log payloads: they may contain a signed URL or account identity.
        if (eventType == "drive_items_changed" || eventType == "transfer_task_changed") {
            changes.tryEmit(eventType)
        }
    }
}
