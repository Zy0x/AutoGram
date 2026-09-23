package com.autogram.app.transfer.service

import com.autogram.app.transfer.domain.TransferTaskItem
import uniffi.autogram_android_bridge.listTransferTasks
import uniffi.autogram_android_bridge.setTransferPaused

class NativeTransferService : TransferService {
    override fun list(): List<TransferTaskItem> = listTransferTasks().map { task ->
        TransferTaskItem(
            id = task.id,
            fileName = task.fileName,
            totalBytes = task.totalBytes.coerceAtMost(Long.MAX_VALUE.toULong()).toLong(),
            transferredBytes = task.processedBytes.coerceAtMost(Long.MAX_VALUE.toULong()).toLong(),
            speedBps = task.speedBps.coerceAtMost(Long.MAX_VALUE.toULong()).toLong(),
            etaSecs = task.etaSeconds.coerceAtMost(Long.MAX_VALUE.toULong()).toLong(),
            status = task.status,
            stage = task.stage,
            paused = task.paused,
            attempt = task.attempt.coerceAtMost(Int.MAX_VALUE.toUInt()).toInt(),
            sourceIdentity = task.sourceIdentity,
            destinationIdentity = task.destinationIdentity,
            errorCode = task.errorCode
        )
    }

    override fun setPaused(id: String, paused: Boolean): Boolean = setTransferPaused(id, paused)
}
