package com.autogram.app.features.gate.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.theme.*

/**
 * Premium Frosted Glass Card for AutoGram Gate screens.
 */
@Composable
fun GateFrostedCard(
    modifier: Modifier = Modifier,
    borderColor: Color = BorderHairline,
    containerColor: Color = SurfaceGlass,
    shape: RoundedCornerShape = RoundedCornerShape(20.dp),
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = modifier,
        shape = shape,
        colors = CardDefaults.cardColors(containerColor = containerColor),
        border = BorderStroke(1.dp, borderColor)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            content = content
        )
    }
}

/**
 * High-touch warm gold action button (min 48dp height).
 */
@Composable
fun GateGoldButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
    icon: ImageVector? = Icons.AutoMirrored.Filled.ArrowForward
) {
    val buttonBrush = if (enabled && !loading) {
        Brush.horizontalGradient(listOf(GoldAccent, Color(0xFFF59E0B)))
    } else {
        Brush.horizontalGradient(listOf(Color(0xFF334155), Color(0xFF1E293B)))
    }

    Surface(
        onClick = onClick,
        enabled = enabled && !loading,
        shape = RoundedCornerShape(14.dp),
        color = Color.Transparent,
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 52.dp)
            .clip(RoundedCornerShape(14.dp))
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 52.dp)
                .background(buttonBrush),
            contentAlignment = Alignment.Center
        ) {
            if (loading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(22.dp),
                    color = Color.White,
                    strokeWidth = 2.5.dp
                )
            } else {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 14.dp)
                ) {
                    Text(
                        text = text,
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp,
                            letterSpacing = 0.3.sp
                        ),
                        color = if (enabled) Color(0xFF0F172A) else TextMutedDark
                    )
                    if (icon != null) {
                        Spacer(Modifier.width(8.dp))
                        Icon(
                            imageVector = icon,
                            contentDescription = null,
                            tint = if (enabled) Color(0xFF0F172A) else TextMutedDark,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }
        }
    }
}

/**
 * Secondary outlined frosted button (min 48dp height).
 */
@Composable
fun GateOutlinedButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    borderColor: Color = BorderHairline
) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        shape = RoundedCornerShape(14.dp),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = Color(0x1A14243A),
            contentColor = TextPrimaryDark
        ),
        border = BorderStroke(1.dp, borderColor),
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 48.dp),
        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 12.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = TextPrimaryDark, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
            }
            Text(
                text = text,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                color = TextPrimaryDark
            )
        }
    }
}

/**
 * Standard branded header for Gate and Wizard screens.
 */
@Composable
fun GateBrandHeader(
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
    compact: Boolean = false
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // Glowing brand logo pill
        Surface(
            shape = CircleShape,
            color = ChampagneGold.copy(alpha = 0.15f),
            border = BorderStroke(1.dp, ChampagneGold.copy(alpha = 0.35f)),
            modifier = Modifier.size(if (compact) 44.dp else 56.dp)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Default.Bolt,
                    contentDescription = null,
                    tint = ChampagneGold,
                    modifier = Modifier.size(if (compact) 24.dp else 32.dp)
                )
            }
        }

        Spacer(Modifier.height(14.dp))

        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall.copy(
                fontWeight = FontWeight.Bold,
                fontSize = if (compact) 20.sp else 24.sp,
                letterSpacing = (-0.3).sp
            ),
            color = TextPrimaryDark,
            textAlign = TextAlign.Center
        )

        Spacer(Modifier.height(6.dp))

        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodyMedium.copy(
                fontSize = 13.sp,
                lineHeight = 18.sp
            ),
            color = TextSecondaryDark,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 8.dp)
        )
    }
}

/**
 * 5-digit glowing OTP boxes with automated entry and keyboard management.
 */
@Composable
fun OtpDigitBoxes(
    code: String,
    onCodeChange: (String) -> Unit,
    onComplete: (String) -> Unit,
    modifier: Modifier = Modifier,
    length: Int = 5,
    enabled: Boolean = true
) {
    val focusRequester = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        try { focusRequester.requestFocus() } catch (_: Exception) {}
    }

    Box(modifier = modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        // Hidden transparent text field capturing keystrokes
        BasicTextField(
            value = code,
            onValueChange = { input ->
                val filtered = input.filter { it.isDigit() }.take(length)
                onCodeChange(filtered)
                if (filtered.length == length) {
                    onComplete(filtered)
                }
            },
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.NumberPassword,
                imeAction = ImeAction.Done
            ),
            keyboardActions = KeyboardActions(
                onDone = {
                    if (code.length == length) onComplete(code)
                }
            ),
            enabled = enabled,
            modifier = Modifier
                .size(1.dp)
                .focusRequester(focusRequester)
        )

        // Visual digit boxes row
        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.clickable {
                try { focusRequester.requestFocus() } catch (_: Exception) {}
            }
        ) {
            for (i in 0 until length) {
                val digit = code.getOrNull(i)?.toString().orEmpty()
                val isFocused = code.length == i

                val boxBorder = when {
                    isFocused -> BorderStroke(1.5.dp, MutedIceCyan)
                    digit.isNotEmpty() -> BorderStroke(1.dp, GoldAccent.copy(alpha = 0.8f))
                    else -> BorderStroke(1.dp, BorderHairline)
                }

                val boxBg = if (isFocused) {
                    MutedIceCyan.copy(alpha = 0.08f)
                } else {
                    SurfaceGlassSoft
                }

                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = boxBg,
                    border = boxBorder,
                    modifier = Modifier
                        .size(width = 50.dp, height = 60.dp)
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = digit,
                            style = MaterialTheme.typography.headlineMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 24.sp
                            ),
                            color = if (digit.isNotEmpty()) TextPrimaryDark else TextMutedDark,
                            textAlign = TextAlign.Center
                        )
                    }
                }
            }
        }
    }
}

/**
 * Elegant Step Indicator (e.g. Step 1 of 5).
 */
@Composable
fun WizardStepIndicator(
    currentStep: Int,
    totalSteps: Int = 5,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        for (i in 1..totalSteps) {
            val isActive = i == currentStep
            val isPassed = i < currentStep

            val pillColor = when {
                isActive -> GoldAccent
                isPassed -> MutedIceCyan
                else -> Color(0x33667A92)
            }

            Box(
                modifier = Modifier
                    .padding(horizontal = 4.dp)
                    .height(4.dp)
                    .width(if (isActive) 24.dp else 12.dp)
                    .clip(CircleShape)
                    .background(pillColor)
            )
        }
    }
}
