package com.autogram.app

import android.app.Application
import android.util.Log
import uniffi.autogram_android_bridge.*

class AutoGramApplication : Application() {

    override fun onCreate() {
        super.onCreate()
        initRustCore()
    }

    private fun initRustCore() {
        try {
            val storageDir = filesDir.absolutePath
            val result = initAutogramRuntime(storageDir)
            Log.i("AutoGramApp", "Rust Core initialized: $result")

            registerEventListener(object : AutoGramEventListener {
                override fun onEvent(eventType: String, payloadJson: String) {
                    Log.d("AutoGramBridge", "Event received: [$eventType] -> $payloadJson")
                }
            })
        } catch (e: Exception) {
            Log.e("AutoGramApp", "Failed to initialize Rust Core: ${e.message}", e)
        }
    }
}
