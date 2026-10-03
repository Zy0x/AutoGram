package com.autogram.app.features.gate.wizard

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Security
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
 * Step 1 of Onboarding: Welcome & Architecture Value Propositions.
 */
@Composable
fun WelcomeStep(
    onStart: () -> Unit,
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

            WizardStepIndicator(currentStep = 1, totalSteps = 5)

            Spacer(Modifier.height(24.dp))

            GateBrandHeader(
                title = stringResource(R.string.gate_welcome_title),
                subtitle = stringResource(R.string.gate_welcome_subtitle)
            )

            Spacer(Modifier.height(24.dp))

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                FeatureValueCard(
                    icon = Icons.Default.Security,
                    title = stringResource(R.string.gate_welcome_feature1_title),
                    description = stringResource(R.string.gate_welcome_feature1_desc),
                    accentColor = MutedIceCyan
                )

                FeatureValueCard(
                    icon = Icons.Default.Bolt,
                    title = stringResource(R.string.gate_welcome_feature2_title),
                    description = stringResource(R.string.gate_welcome_feature2_desc),
                    accentColor = GoldAccent
                )

                FeatureValueCard(
                    icon = Icons.Default.CheckCircle,
                    title = stringResource(R.string.gate_welcome_feature3_title),
                    description = stringResource(R.string.gate_welcome_feature3_desc),
                    accentColor = DustySage
                )
            }

            Spacer(Modifier.height(32.dp))

            GateGoldButton(
                text = stringResource(R.string.gate_start_button),
                onClick = onStart
            )

            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun FeatureValueCard(
    icon: ImageVector,
    title: String,
    description: String,
    accentColor: Color,
    modifier: Modifier = Modifier
) {
    GateFrostedCard(
        modifier = modifier.fillMaxWidth(),
        borderColor = accentColor.copy(alpha = 0.25f),
        containerColor = SurfaceGlassSoft,
        shape = RoundedCornerShape(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Surface(
                shape = CircleShape,
                color = accentColor.copy(alpha = 0.12f),
                border = BorderStroke(0.5.dp, accentColor.copy(alpha = 0.35f)),
                modifier = Modifier.size(42.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = accentColor,
                        modifier = Modifier.size(22.dp)
                    )
                }
            }

            Spacer(Modifier.width(14.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleSmall.copy(
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.5.sp
                    ),
                    color = TextPrimaryDark
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontSize = 11.5.sp,
                        lineHeight = 16.sp
                    ),
                    color = TextSecondaryDark
                )
            }
        }
    }
}
