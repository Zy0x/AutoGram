package com.autogram.app.features.gate.wizard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.features.gate.CountryPrefix
import com.autogram.app.features.gate.PopularCountryPrefixes
import com.autogram.app.features.gate.components.*
import com.autogram.app.theme.*

/**
 * Step 3.5 of Onboarding: Phone Number Entry with Country Selector.
 */
@Composable
fun PhoneInputStep(
    onSubmitPhone: (String) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    isBusy: Boolean = false,
    errorMessage: String? = null
) {
    var selectedPrefix by remember { mutableStateOf(PopularCountryPrefixes.first()) }
    var prefixMenuExpanded by remember { mutableStateOf(false) }
    var phoneNumber by remember { mutableStateOf("") }

    val cleanNumber = phoneNumber.trim().trimStart('0')
    val fullPhone = "${selectedPrefix.code}$cleanNumber"
    val isValidPhone = cleanNumber.length >= 7 && !isBusy

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

            WizardStepIndicator(currentStep = 3, totalSteps = 5)

            Spacer(Modifier.height(24.dp))

            GateBrandHeader(
                title = stringResource(R.string.gate_phone_input_title),
                subtitle = stringResource(R.string.gate_phone_input_subtitle)
            )

            Spacer(Modifier.height(28.dp))

            GateFrostedCard(
                borderColor = if (isValidPhone) GoldAccent.copy(alpha = 0.5f) else BorderHairline,
                containerColor = SurfaceGlass
            ) {
                Text(
                    text = stringResource(R.string.auth_phone),
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = TextSecondaryDark
                )

                Spacer(Modifier.height(10.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Country Prefix Dropdown Selector
                    Box {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = SurfaceGlassSoft,
                            border = BorderStroke(1.dp, BorderHairline),
                            modifier = Modifier
                                .height(56.dp)
                                .clickable { prefixMenuExpanded = true }
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Text(selectedPrefix.flag, fontSize = 18.sp)
                                Text(
                                    selectedPrefix.code,
                                    style = MaterialTheme.typography.titleMedium.copy(
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 15.sp
                                    ),
                                    color = TextPrimaryDark
                                )
                                Icon(
                                    Icons.Default.ArrowDropDown,
                                    contentDescription = null,
                                    tint = TextSecondaryDark,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }

                        DropdownMenu(
                            expanded = prefixMenuExpanded,
                            onDismissRequest = { prefixMenuExpanded = false },
                            modifier = Modifier
                                .background(SurfaceDark)
                                .heightIn(max = 280.dp)
                        ) {
                            PopularCountryPrefixes.forEach { prefix ->
                                DropdownMenuItem(
                                    text = {
                                        Text(
                                            "${prefix.flag} ${prefix.code}  ${prefix.name}",
                                            color = TextPrimaryDark,
                                            style = MaterialTheme.typography.bodyMedium
                                        )
                                    },
                                    onClick = {
                                        selectedPrefix = prefix
                                        prefixMenuExpanded = false
                                    }
                                )
                            }
                        }
                    }

                    Spacer(Modifier.width(10.dp))

                    // Phone digits textfield
                    OutlinedTextField(
                        value = phoneNumber,
                        onValueChange = { input -> phoneNumber = input.filter { it.isDigit() } },
                        placeholder = { Text("812-3456-7890") },
                        singleLine = true,
                        enabled = !isBusy,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        modifier = Modifier.weight(1f),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = GoldAccent,
                            unfocusedBorderColor = BorderHairline,
                            focusedTextColor = TextPrimaryDark,
                            unfocusedTextColor = TextPrimaryDark,
                            focusedLabelColor = GoldAccent,
                            unfocusedLabelColor = TextSecondaryDark
                        )
                    )
                }

                if (cleanNumber.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = "Format internasional: $fullPhone",
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                        color = MutedIceCyan
                    )
                }

                if (!errorMessage.isNullOrBlank()) {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = errorMessage,
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                        color = SoftCoral
                    )
                }
            }

            Spacer(Modifier.height(28.dp))

            GateGoldButton(
                text = stringResource(R.string.auth_send_code),
                onClick = { if (isValidPhone) onSubmitPhone(fullPhone) },
                enabled = isValidPhone,
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
