package com.autogram.app.features.gate.wizard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForwardIos
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.features.gate.components.*
import com.autogram.app.theme.*

/**
 * Step 3 of Onboarding: Choose Login Method (Phone Number vs QR Code).
 */
@Composable
fun MethodSelectStep(
    onSelectPhone: () -> Unit,
    onSelectQr: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
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
                title = stringResource(R.string.gate_method_title),
                subtitle = stringResource(R.string.gate_method_subtitle)
            )

            Spacer(Modifier.height(28.dp))

            // Option 1: Phone Login (Recommended)
            MethodOptionCard(
                icon = Icons.Default.Phone,
                title = stringResource(R.string.gate_method_phone_title),
                description = stringResource(R.string.gate_method_phone_desc),
                badgeText = stringResource(R.string.gate_method_phone_badge),
                accentColor = MutedIceCyan,
                onClick = onSelectPhone
            )

            Spacer(Modifier.height(16.dp))

            // Option 2: QR Code Login
            MethodOptionCard(
                icon = Icons.Default.QrCode2,
                title = stringResource(R.string.gate_method_qr_title),
                description = stringResource(R.string.gate_method_qr_desc),
                badgeText = null,
                accentColor = SoftViolet,
                onClick = onSelectQr
            )

            Spacer(Modifier.height(32.dp))

            GateOutlinedButton(
                text = stringResource(R.string.auth_cancel),
                onClick = onBack
            )

            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun MethodOptionCard(
    icon: ImageVector,
    title: String,
    description: String,
    badgeText: String?,
    accentColor: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    GateFrostedCard(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick),
        borderColor = accentColor.copy(alpha = 0.35f),
        containerColor = SurfaceGlass
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = accentColor.copy(alpha = 0.12f),
                border = BorderStroke(1.dp, accentColor.copy(alpha = 0.35f)),
                modifier = Modifier.size(52.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = accentColor,
                        modifier = Modifier.size(26.dp)
                    )
                }
            }

            Spacer(Modifier.width(16.dp))

            Column(modifier = Modifier.weight(1f)) {
                if (badgeText != null) {
                    Surface(
                        shape = CircleShape,
                        color = DustySage.copy(alpha = 0.15f),
                        border = BorderStroke(0.5.dp, DustySage.copy(alpha = 0.4f)),
                        modifier = Modifier.padding(bottom = 4.dp)
                    ) {
                        Text(
                            text = badgeText,
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 10.sp
                            ),
                            color = DustySage,
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp)
                        )
                    }
                }

                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium.copy(
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp
                    ),
                    color = TextPrimaryDark
                )

                Spacer(Modifier.height(2.dp))

                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontSize = 12.sp,
                        lineHeight = 16.sp
                    ),
                    color = TextSecondaryDark
                )
            }

            Spacer(Modifier.width(8.dp))

            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowForwardIos,
                contentDescription = null,
                tint = TextMutedDark,
                modifier = Modifier.size(16.dp)
            )
        }
    }
}
