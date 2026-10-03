package com.autogram.app.features.gate.components

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*

/**
 * Dialog shown when Android Keystore decryption fails unrecoverably.
 * Requires typed confirmation before clearing local corrupted state.
 */
@Composable
fun VaultRecoveryDialog(
    onConfirmReset: () -> Unit,
    onDismiss: () -> Unit
) {
    var confirmationInput by remember { mutableStateOf("") }
    val expectedWord = stringResource(R.string.gate_vault_confirm_word)
    val isConfirmed = confirmationInput.trim().equals(expectedWord, ignoreCase = false)

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = SurfaceDark,
        titleContentColor = TextPrimaryDark,
        textContentColor = TextSecondaryDark,
        icon = {
            Icon(
                imageVector = Icons.Default.Warning,
                contentDescription = null,
                tint = SoftCoral,
                modifier = Modifier.size(36.dp)
            )
        },
        title = {
            Text(
                text = stringResource(R.string.gate_vault_corrupted_title),
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold)
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = stringResource(R.string.gate_vault_corrupted_desc),
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.5.sp)
                )

                Text(
                    text = stringResource(R.string.gate_vault_confirm_instruction),
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                    color = GoldAccent
                )

                OutlinedTextField(
                    value = confirmationInput,
                    onValueChange = { confirmationInput = it },
                    singleLine = true,
                    placeholder = { Text(expectedWord) },
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = SoftCoral,
                        unfocusedBorderColor = BorderHairline,
                        focusedTextColor = TextPrimaryDark,
                        unfocusedTextColor = TextPrimaryDark
                    )
                )
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirmReset,
                enabled = isConfirmed,
                colors = ButtonDefaults.buttonColors(
                    containerColor = SoftCoral,
                    disabledContainerColor = Color(0xFF334155)
                )
            ) {
                Text(
                    text = stringResource(R.string.gate_vault_recover_button),
                    color = if (isConfirmed) Color.White else TextMutedDark
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.auth_cancel), color = TextSecondaryDark)
            }
        }
    )
}
