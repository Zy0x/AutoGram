package com.autogram.app

import android.app.Application
import android.util.Log
import com.autogram.app.runtime.NativeRuntime
import uniffi.autogram_android_bridge.*

class AutoGramApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        initRustCore()
    }

    private fun initRustCore() {
        try {
            val storageDir = filesDir.absolutePath
            initAutogramRuntime(storageDir)

            registerEventListener(object : AutoGramEventListener {
                override fun onEvent(eventType: String, payloadJson: String) {
                    NativeRuntime.invalidate(eventType)
                }
            })
            NativeRuntime.ready()
        } catch (_: LinkageError) {
            // An APK missing the ABI library must still open and report unavailable features.
            NativeRuntime.unavailable()
            Log.e("AutoGramApp", "Native runtime library unavailable")
        } catch (e: Exception) {
            NativeRuntime.unavailable()
            Log.e("AutoGramApp", "Native runtime initialization failed")
        }
    }
}
