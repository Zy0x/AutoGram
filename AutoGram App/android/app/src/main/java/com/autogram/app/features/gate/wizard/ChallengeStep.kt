package com.autogram.app.features.gate.wizard

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Sms
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.features.auth.LoginChallenge
import com.autogram.app.features.auth.LoginPhase
import com.autogram.app.features.gate.components.*
import com.autogram.app.theme.*
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.delay

/**
 * Step 4 of Onboarding: Authentication Challenge (OTP, 2FA Password, or QR Code with same-device deep-link).
 */
@Composable
fun ChallengeStep(
    challenge: LoginChallenge,
    onSubmit: (String) -> Unit,
    onResend: () -> Unit,
    onRetry: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    isBusy: Boolean = false,
    errorMessage: String? = null
) {
    val context = LocalContext.current
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }

    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            now = System.currentTimeMillis()
        }
    }

    GateBackground(modifier = modifier) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp)
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(Modifier.height(28.dp))

            WizardStepIndicator(currentStep = 4, totalSteps = 5)

            Spacer(Modifier.height(24.dp))

            when (challenge.phase) {
                LoginPhase.CODE -> {
                    CodeChallengeContent(
                        challenge = challenge,
                        now = now,
                        onSubmit = onSubmit,
                        onResend = onResend,
                        isBusy = isBusy,
                        errorMessage = errorMessage
                    )
                }
                LoginPhase.PASSWORD -> {
                    PasswordChallengeContent(
                        challenge = challenge,
                        onSubmit = onSubmit,
                        isBusy = isBusy,
                        errorMessage = errorMessage
                    )
                }
                LoginPhase.QR -> {
                    QrChallengeContent(
                        challenge = challenge,
                        now = now,
                        onRetry = onRetry,
                        onOpenSameDevice = { tokenUrl ->
                            val tgIntent = Intent(Intent.ACTION_VIEW, Uri.parse(tokenUrl))
                            try {
                                context.startActivity(tgIntent)
                            } catch (_: Exception) {
                                // Fallback to generic URL if no Telegram client handler is present
                                try {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://t.me")))
                                } catch (_: Exception) {}
                            }
                        },
                        isBusy = isBusy
                    )
                }
                LoginPhase.AUTHORIZED -> {
                    AuthorizedWaitingContent()
                }
            }

            Spacer(Modifier.height(20.dp))

            GateOutlinedButton(
                text = stringResource(R.string.auth_cancel),
                onClick = onCancel,
                enabled = !isBusy
            )

            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun CodeChallengeContent(
    challenge: LoginChallenge,
    now: Long,
    onSubmit: (String) -> Unit,
    onResend: () -> Unit,
    isBusy: Boolean,
    errorMessage: String?
) {
    var otpDigits by remember { mutableStateOf("") }
    val remainingSeconds = (challenge.resendAt - now / 1000).coerceAtLeast(0)
    val canResendNow = challenge.canResend && remainingSeconds <= 0 && !isBusy

    GateBrandHeader(
        title = stringResource(R.string.gate_otp_title),
        subtitle = stringResource(R.string.gate_otp_subtitle)
    )

    Spacer(Modifier.height(28.dp))

    GateFrostedCard(
        borderColor = if (otpDigits.length == 5) GoldAccent.copy(alpha = 0.6f) else BorderHairline,
        containerColor = SurfaceGlass
    ) {
        Text(
            text = stringResource(R.string.auth_code),
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
            color = TextSecondaryDark,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(Modifier.height(16.dp))

        OtpDigitBoxes(
            code = otpDigits,
            onCodeChange = { otpDigits = it },
            onComplete = { code -> onSubmit(code) },
            enabled = !isBusy
        )

        if (!errorMessage.isNullOrBlank()) {
            Spacer(Modifier.height(14.dp))
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                color = SoftCoral,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        }

        Spacer(Modifier.height(20.dp))

        // Resend status & SMS fallback
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (remainingSeconds > 0) {
                val formattedTime = String.format("%02d:%02d", remainingSeconds / 60, remainingSeconds % 60)
                Text(
                    text = stringResource(R.string.gate_otp_resend_in, formattedTime),
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp),
                    color = TextSecondaryDark
                )
            } else if (challenge.canResend) {
                OutlinedButton(
                    onClick = onResend,
                    enabled = canResendNow,
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MutedIceCyan)
                ) {
                    Icon(Icons.Default.Sms, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(stringResource(R.string.gate_otp_send_sms))
                }
            }
        }
    }

    Spacer(Modifier.height(24.dp))

    GateGoldButton(
        text = stringResource(R.string.auth_verify),
        onClick = { if (otpDigits.isNotBlank()) onSubmit(otpDigits) },
        enabled = otpDigits.length >= 5 && !isBusy,
        loading = isBusy
    )
}

@Composable
private fun PasswordChallengeContent(
    challenge: LoginChallenge,
    onSubmit: (String) -> Unit,
    isBusy: Boolean,
    errorMessage: String?
) {
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }

    GateBrandHeader(
        title = stringResource(R.string.gate_2fa_title),
        subtitle = stringResource(R.string.gate_2fa_subtitle)
    )

    Spacer(Modifier.height(28.dp))

    GateFrostedCard(
        borderColor = if (password.isNotEmpty()) GoldAccent.copy(alpha = 0.5f) else BorderHairline,
        containerColor = SurfaceGlass
    ) {
        if (!challenge.passwordHint.isNullOrBlank()) {
            Surface(
                shape = RoundedCornerShape(10.dp),
                color = SurfaceGlassSoft,
                border = BorderStroke(1.dp, BorderHairline),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = stringResource(R.string.auth_password_hint, challenge.passwordHint),
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp),
                    color = MutedIceCyan,
                    modifier = Modifier.padding(12.dp)
                )
            }
            Spacer(Modifier.height(14.dp))
        }

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text(stringResource(R.string.gate_2fa_input_label)) },
            singleLine = true,
            enabled = !isBusy,
            visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = {
                IconButton(onClick = { showPassword = !showPassword }) {
                    Icon(
                        imageVector = if (showPassword) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = if (showPassword) stringResource(R.string.gate_2fa_hide_password) else stringResource(R.string.gate_2fa_show_password),
                        tint = TextSecondaryDark
                    )
                }
            },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = GoldAccent,
                unfocusedBorderColor = BorderHairline,
                focusedTextColor = TextPrimaryDark,
                unfocusedTextColor = TextPrimaryDark,
                focusedLabelColor = GoldAccent,
                unfocusedLabelColor = TextSecondaryDark
            )
        )

        if (!errorMessage.isNullOrBlank()) {
            Spacer(Modifier.height(10.dp))
            Text(
                text = errorMessage,
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                color = SoftCoral
            )
        }
    }

    Spacer(Modifier.height(24.dp))

    GateGoldButton(
        text = stringResource(R.string.gate_2fa_submit),
        onClick = { if (password.isNotEmpty()) onSubmit(password) },
        enabled = password.isNotEmpty() && !isBusy,
        loading = isBusy,
        icon = Icons.Default.Lock
    )
}

@Composable
private fun QrChallengeContent(
    challenge: LoginChallenge,
    now: Long,
    onRetry: () -> Unit,
    onOpenSameDevice: (String) -> Unit,
    isBusy: Boolean
) {
    val remainingSeconds = (challenge.expiresAt - now / 1000).coerceAtLeast(0)
    val url = challenge.qrUrl
    val isExpired = url == null || remainingSeconds <= 0

    GateBrandHeader(
        title = stringResource(R.string.gate_qr_title),
        subtitle = stringResource(R.string.gate_qr_subtitle)
    )

    Spacer(Modifier.height(24.dp))

    GateFrostedCard(
        borderColor = MutedIceCyan.copy(alpha = 0.35f),
        containerColor = SurfaceGlass
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            if (!isExpired && url != null) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = Color.White,
                    modifier = Modifier.padding(8.dp)
                ) {
                    Box(modifier = Modifier.padding(12.dp)) {
                        QrCodeRenderer(url = url)
                    }
                }

                Spacer(Modifier.height(12.dp))

                Text(
                    text = stringResource(R.string.auth_qr_seconds, remainingSeconds),
                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold),
                    color = MutedIceCyan
                )

                Spacer(Modifier.height(18.dp))

                // Same device login deep link button
                GateGoldButton(
                    text = stringResource(R.string.gate_qr_open_same_device),
                    onClick = { onOpenSameDevice(url) },
                    icon = Icons.Default.OpenInNew
                )
            } else {
                Text(
                    text = stringResource(R.string.auth_qr_refreshing),
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextSecondaryDark,
                    textAlign = TextAlign.Center
                )

                Spacer(Modifier.height(16.dp))

                GateOutlinedButton(
                    text = stringResource(R.string.auth_retry),
                    onClick = onRetry,
                    icon = Icons.Default.Refresh,
                    enabled = !isBusy
                )
            }
        }
    }
}

@Composable
private fun AuthorizedWaitingContent() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        CircularProgressIndicator(color = GoldAccent, modifier = Modifier.size(36.dp))
        Spacer(Modifier.height(16.dp))
        Text(
            text = stringResource(R.string.auth_selecting),
            style = MaterialTheme.typography.bodyMedium,
            color = TextSecondaryDark
        )
    }
}

@Composable
private fun QrCodeRenderer(url: String) {
    val matrix = remember(url) {
        try {
            QRCodeWriter().encode(url, BarcodeFormat.QR_CODE, 0, 0)
        } catch (_: Exception) {
            null
        }
    }

    if (matrix != null) {
        val description = stringResource(R.string.auth_qr_description)
        Canvas(Modifier.size(200.dp).semantics { contentDescription = description }) {
            drawRect(Color.White)
            val cell = minOf(size.width, size.height) / matrix.width
            for (y in 0 until matrix.height) {
                for (x in 0 until matrix.width) {
                    if (matrix[x, y]) {
                        drawRect(Color.Black, Offset(x * cell, y * cell), Size(cell, cell))
                    }
                }
            }
        }
    }
}
