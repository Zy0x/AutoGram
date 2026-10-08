package com.autogram.app.features.cloud.reads

/** One automatic recovery per user intent; another server wait must not create a retry loop. */
class CloudAutomaticRetryBudget {
    private var used = false
    fun take(): Boolean {
        if (used) return false
        used = true
        return true
    }
    fun reset() { used = false }
}
