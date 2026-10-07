package com.autogram.app.ui

import android.app.Activity
import android.app.KeyguardManager
import android.view.WindowManager
import androidx.test.platform.app.InstrumentationRegistry

/** Temporary test window only. Never dismiss keyguard or modify display settings. */
internal fun keepUnlockedFixtureAwake(activity: () -> Activity) {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val keyguard = instrumentation.targetContext.getSystemService(KeyguardManager::class.java)
    check(!keyguard.isKeyguardLocked && !keyguard.isDeviceLocked) {
        "Unlock the physical phone manually before running presentation tests."
    }
    instrumentation.runOnMainSync {
        activity().window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
