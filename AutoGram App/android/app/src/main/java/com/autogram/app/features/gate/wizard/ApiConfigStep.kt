package com.autogram.app.features.gate.wizard

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.features.gate.components.*
import com.autogram.app.theme.*

/**
 * Step 2 of Onboarding: Telegram API ID & Hash Configuration.
 */
@Composable
fun ApiConfigStep(
    onSaveAndContinue: (Int, String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    initialApiId: String = "",
    initialApiHash: String = "",
    isBusy: Boolean = false
) {
    val context = LocalContext.current
    var apiId by remember { mutableStateOf(initialApiId) }
    var apiHash by remember { mutableStateOf(initialApiHash) }
    var showHash by remember { mutableStateOf(false) }

    val cleanId = apiId.trim()
    val cleanHash = apiHash.trim()

    val parsedId = cleanId.toIntOrNull()
    val isValidId = parsedId != null && parsedId > 0
    val isValidHash = cleanHash.matches(Regex("^[0-9a-fA-F]{32}$"))
    val canProceed = isValidId && isValidHash && !isBusy

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

            WizardStepIndicator(currentStep = 2, totalSteps = 5)

            Spacer(Modifier.height(24.dp))

            GateBrandHeader(
                title = stringResource(R.string.gate_api_step_title),
                subtitle = stringResource(R.string.gate_api_step_subtitle)
            )

            Spacer(Modifier.height(24.dp))

            GateFrostedCard(
                borderColor = if (canProceed) GoldAccent.copy(alpha = 0.5f) else BorderHairline,
                containerColor = SurfaceGlass
            ) {
                // API ID Input
                OutlinedTextField(
                    value = apiId,
                    onValueChange = { input -> apiId = input.filter { it.isDigit() } },
                    label = { Text(stringResource(R.string.auth_api_id)) },
                    placeholder = { Text("Contoh: 12345678") },
                    singleLine = true,
                    enabled = !isBusy,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    isError = cleanId.isNotEmpty() && !isValidId,
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

                if (cleanId.isNotEmpty() && !isValidId) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = stringResource(R.string.gate_api_id_format_error),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                        color = SoftCoral
                    )
                }

                Spacer(Modifier.height(14.dp))

                // API Hash Input
                OutlinedTextField(
                    value = apiHash,
                    onValueChange = { apiHash = it.trim() },
                    label = { Text(stringResource(R.string.auth_api_hash)) },
                    placeholder = { Text("32-digit heksadesimal") },
                    singleLine = true,
                    enabled = !isBusy,
                    visualTransformation = if (showHash) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = {
                        IconButton(onClick = { showHash = !showHash }) {
                            Icon(
                                imageVector = if (showHash) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                contentDescription = if (showHash) stringResource(R.string.gate_2fa_hide_password) else stringResource(R.string.gate_2fa_show_password),
                                tint = TextSecondaryDark
                            )
                        }
                    },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                    isError = cleanHash.isNotEmpty() && !isValidHash,
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

                if (cleanHash.isNotEmpty() && !isValidHash) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = stringResource(R.string.gate_api_hash_format_error),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                        color = SoftCoral
                    )
                }

                Spacer(Modifier.height(14.dp))

                // Helper link to my.telegram.org
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clickable {
                            val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://my.telegram.org"))
                            try { context.startActivity(intent) } catch (_: Exception) {}
                        }
                        .padding(vertical = 4.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.OpenInNew,
                        contentDescription = null,
                        tint = MutedIceCyan,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = stringResource(R.string.gate_api_learn_more),
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 12.5.sp
                        ),
                        color = MutedIceCyan
                    )
                }
            }

            Spacer(Modifier.height(28.dp))

            GateGoldButton(
                text = stringResource(R.string.auth_save_api),
                onClick = { if (canProceed) onSaveAndContinue(parsedId!!, cleanHash) },
                enabled = canProceed,
                loading = isBusy
            )

            Spacer(Modifier.height(12.dp))

            GateOutlinedButton(
                text = stringResource(R.string.auth_cancel),
                onClick = onBack,
                enabled = !isBusy
            )

            Spacer(Modifier.height(24.dp))
        }
    }
}
