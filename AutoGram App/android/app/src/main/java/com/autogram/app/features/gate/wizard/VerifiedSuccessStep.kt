package com.autogram.app.features.gate.wizard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.features.auth.AuthAccount
import com.autogram.app.features.gate.components.*
import com.autogram.app.theme.*

/**
 * Step 5 of Onboarding: Verified Account Success Screen before unlocking the app.
 */
@Composable
fun VerifiedSuccessStep(
    account: AuthAccount,
    onEnterApp: () -> Unit,
    modifier: Modifier = Modifier
) {
    GateBackground(modifier = modifier) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp)
                .safeDrawingPadding()
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            WizardStepIndicator(currentStep = 5, totalSteps = 5)

            Spacer(Modifier.height(28.dp))

            // Verified Badge Icon
            Surface(
                shape = CircleShape,
                color = DustySage.copy(alpha = 0.15f),
                border = BorderStroke(1.5.dp, DustySage.copy(alpha = 0.5f)),
                modifier = Modifier.size(72.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Default.Check,
                        contentDescription = null,
                        tint = DustySage,
                        modifier = Modifier.size(40.dp)
                    )
                }
            }

            Spacer(Modifier.height(20.dp))

            Text(
                text = stringResource(R.string.gate_success_title),
                style = MaterialTheme.typography.headlineSmall.copy(
                    fontWeight = FontWeight.Bold,
                    fontSize = 24.sp
                ),
                color = TextPrimaryDark,
                textAlign = TextAlign.Center
            )

            Spacer(Modifier.height(8.dp))

            Text(
                text = stringResource(R.string.gate_success_subtitle),
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                ),
                color = TextSecondaryDark,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 8.dp)
            )

            Spacer(Modifier.height(28.dp))

            // Verified Account Details Card
            GateFrostedCard(
                borderColor = GoldAccent.copy(alpha = 0.4f),
                containerColor = SurfaceGlass
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Surface(
                        shape = CircleShape,
                        color = Color.Transparent,
                        modifier = Modifier
                            .size(54.dp)
                            .clip(CircleShape)
                            .background(Brush.linearGradient(listOf(GoldAccent, MutedIceCyan)))
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = Icons.Default.Person,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(30.dp)
                            )
                        }
                    }

                    Spacer(Modifier.width(16.dp))

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = account.displayName.ifBlank { "Telegram User" },
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 17.sp
                            ),
                            color = TextPrimaryDark
                        )

                        if (!account.username.isNullOrBlank()) {
                            Spacer(Modifier.height(2.dp))
                            Text(
                                text = "@${account.username}",
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp),
                                color = MutedIceCyan
                            )
                        }

                        Spacer(Modifier.height(4.dp))

                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Default.VerifiedUser,
                                contentDescription = null,
                                tint = DustySage,
                                modifier = Modifier.size(14.dp)
                            )
                            Spacer(Modifier.width(4.dp))
                            Text(
                                text = stringResource(R.string.auth_active),
                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                                color = DustySage
                            )
                        }
                    }
                }
            }

            Spacer(Modifier.height(36.dp))

            GateGoldButton(
                text = stringResource(R.string.gate_success_enter_button),
                onClick = onEnterApp
            )

            Spacer(Modifier.height(24.dp))
        }
    }
}
