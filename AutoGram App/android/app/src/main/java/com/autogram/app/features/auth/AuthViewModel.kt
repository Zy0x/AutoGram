package com.autogram.app.features.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope

class AuthViewModel : ViewModel() {
    val controller = AuthController(NativeAuthService(), viewModelScope)
    val state = controller.state
    init { controller.refresh(restore = true) }
    override fun onCleared() { controller.close() }
}
