package com.autogram.app.features.auth

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter

@Composable
internal fun AuthChallengeContent(challenge: LoginChallenge, enabled: Boolean, now: Long,
    onSubmit: (String) -> Unit, onResend: () -> Unit, onRetry: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when (challenge.phase) {
            LoginPhase.CODE, LoginPhase.PASSWORD -> {
                var input by remember { mutableStateOf("") }
                val password = challenge.phase == LoginPhase.PASSWORD
                Text(stringResource(if (password) R.string.auth_password_required else R.string.auth_code_sent))
                if (password && !challenge.passwordHint.isNullOrBlank()) {
                    Text(stringResource(R.string.auth_password_hint, challenge.passwordHint))
                }
                OutlinedTextField(input, { input = it }, singleLine = true, enabled = enabled,
                    label = { Text(stringResource(if (password) R.string.auth_password else R.string.auth_code)) },
                    visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
                    keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else KeyboardType.Text))
                Button(onClick = { onSubmit(input); input = "" }, enabled = enabled && if (password) input.isNotEmpty() else input.isNotBlank()) {
                    Text(stringResource(R.string.auth_verify))
                }
                if (!password && challenge.canResend) {
                    OutlinedButton(onClick = onResend, enabled = enabled && now / 1000 >= challenge.resendAt) {
                        Text(stringResource(R.string.auth_resend))
                    }
                }
            }
            LoginPhase.QR -> {
                Text(stringResource(R.string.auth_qr_instructions))
                val url = challenge.qrUrl
                if (url != null && now / 1000 < challenge.expiresAt) {
                    LoginQrCode(url)
                    Text(stringResource(R.string.auth_qr_seconds, (challenge.expiresAt - now / 1000).coerceAtLeast(0)))
                } else Text(stringResource(R.string.auth_qr_refreshing))
                OutlinedButton(onClick = onRetry, enabled = enabled) { Text(stringResource(R.string.auth_retry)) }
            }
            LoginPhase.AUTHORIZED -> {
                Text(stringResource(R.string.auth_selecting))
                OutlinedButton(onClick = onRetry, enabled = enabled) { Text(stringResource(R.string.auth_retry)) }
            }
        }
    }
}

@Composable
private fun LoginQrCode(url: String) {
    val matrix = remember(url) { QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, 0, 0) }
    val description = stringResource(R.string.auth_qr_description)
    Canvas(Modifier.size(256.dp).semantics { contentDescription = description }) {
        drawRect(Color.White)
        val cell = minOf(size.width, size.height) / matrix.width
        for (y in 0 until matrix.height) for (x in 0 until matrix.width) {
            if (matrix[x, y]) drawRect(Color.Black, Offset(x * cell, y * cell), Size(cell, cell))
        }
    }
}

internal fun authErrorLabel(code: String): Int = when (code) {
    "invalid_api_credentials", "api_not_configured" -> R.string.auth_error_api
    "invalid_phone" -> R.string.auth_error_phone
    "invalid_code" -> R.string.auth_error_code
    "code_expired", "login_expired", "wrong_auth_step" -> R.string.auth_error_expired
    "invalid_password" -> R.string.auth_error_password
    "password_required" -> R.string.auth_password_required
    "flood_wait" -> R.string.auth_error_wait
    "vault_error" -> R.string.auth_error_vault
    "official_app_required" -> R.string.auth_error_official
    "not_authorized", "account_missing", "account_mismatch" -> R.string.auth_error_session
    "login_cancelled" -> R.string.auth_cancelled
    "network_error", "network_timeout" -> R.string.auth_error_network
    "qr_expired" -> R.string.auth_qr_refreshing
    "auth_not_initialized" -> R.string.accounts_runtime_unavailable
    "resend_unavailable" -> R.string.auth_error_resend
    else -> R.string.auth_error_generic
}
