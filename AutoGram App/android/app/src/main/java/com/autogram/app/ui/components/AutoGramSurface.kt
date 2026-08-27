package com.autogram.app.ui.components

import androidx.annotation.StringRes
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.FolderOpen
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*

@Composable
fun AutoGramSurface(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(CanvasWarmTitanium)
            .background(AmbientBackgroundBrush)
    ) {
        content()
    }
}

@Composable
fun AutoGramBrand(modifier: Modifier = Modifier, compact: Boolean = false) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Surface(
            shape = CircleShape,
            color = ChampagneGold.copy(alpha = 0.15f),
            modifier = Modifier.size(if (compact) 32.dp else 40.dp)
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    Icons.Default.Bolt,
                    contentDescription = null,
                    tint = ChampagneGold,
                    modifier = Modifier.size(if (compact) 18.dp else 22.dp)
                )
            }
        }
        if (!compact) {
            Text(
                text = "AutoGram",
                style = MaterialTheme.typography.titleMedium.copy(
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.5.sp
                ),
                color = TextPrimaryDark
            )
        }
    }
}

@Composable
fun AutoGramGlassCard(
    modifier: Modifier = Modifier,
    shape: RoundedCornerShape = RoundedCornerShape(18.dp),
    borderColor: Color = BorderHairline,
    containerColor: Color = SurfaceGlass,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit
) {
    Card(
        modifier = modifier
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        shape = shape,
        colors = CardDefaults.cardColors(containerColor = containerColor),
        border = BorderStroke(1.dp, borderColor)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            content()
        }
    }
}

@Composable
fun AutoGramDoubleBezelCard(
    modifier: Modifier = Modifier,
    outerShape: RoundedCornerShape = RoundedCornerShape(22.dp),
    innerShape: RoundedCornerShape = RoundedCornerShape(16.dp),
    borderColor: Color = BorderHairline,
    content: @Composable ColumnScope.() -> Unit
) {
    Surface(
        modifier = modifier,
        shape = outerShape,
        color = SurfaceGlassSoft,
        border = BorderStroke(1.dp, borderColor)
    ) {
        Box(modifier = Modifier.padding(3.dp)) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                shape = innerShape,
                color = SurfaceGlass,
                border = BorderStroke(0.5.dp, Color(0x10FFFFFF))
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    content()
                }
            }
        }
    }
}

@Composable
fun AutoGramCard(
    modifier: Modifier = Modifier,
    shape: RoundedCornerShape = RoundedCornerShape(18.dp),
    content: @Composable () -> Unit
) {
    Card(
        modifier = modifier,
        shape = shape,
        colors = CardDefaults.cardColors(containerColor = SurfaceGlass),
        border = BorderStroke(1.dp, BorderHairline)
    ) {
        content()
    }
}

@Composable
fun AutoGramMetricCard(
    icon: ImageVector,
    value: String,
    label: String,
    accent: Color,
    modifier: Modifier = Modifier,
    deltaText: String? = null
) {
    AutoGramGlassCard(
        modifier = modifier,
        borderColor = accent.copy(alpha = 0.25f),
        containerColor = SurfaceGlass
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = value,
                    style = MaterialTheme.typography.headlineSmall.copy(
                        fontWeight = FontWeight.Bold,
                        fontSize = 20.sp
                    ),
                    color = TextPrimaryDark
                )
                Spacer(Modifier.height(1.dp))
                Text(
                    text = label,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    color = TextSecondaryDark,
                    maxLines = 1
                )
            }

            Surface(
                shape = CircleShape,
                color = accent.copy(alpha = 0.12f),
                modifier = Modifier.size(34.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = accent,
                        modifier = Modifier.size(17.dp)
                    )
                }
            }
        }
    }
}

@Composable
fun AutoGramGlowButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    brush: Brush = ChampagneToCyanBrush,
    enabled: Boolean = true
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier
            .height(44.dp)
            .clip(RoundedCornerShape(14.dp)),
        shape = RoundedCornerShape(14.dp),
        color = Color.Transparent
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(if (enabled) brush else Brush.linearGradient(listOf(Color(0xFF334155), Color(0xFF1E293B)))),
            contentAlignment = Alignment.Center
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(horizontal = 18.dp)
            ) {
                if (icon != null) {
                    Icon(icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                }
                Text(
                    text = text,
                    color = Color.White,
                    style = MaterialTheme.typography.labelLarge.copy(
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 0.3.sp
                    )
                )
            }
        }
    }
}

@Composable
fun AutoGramStatusDot(
    color: Color,
    modifier: Modifier = Modifier,
    isPulsing: Boolean = false,
    size: Dp = 8.dp
) {
    if (isPulsing) {
        val infiniteTransition = rememberInfiniteTransition(label = "pulse")
        val alpha by infiniteTransition.animateFloat(
            initialValue = 0.3f,
            targetValue = 1f,
            animationSpec = infiniteRepeatable(
                animation = tween(900, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse
            ),
            label = "pulseAlpha"
        )
        val scale by infiniteTransition.animateFloat(
            initialValue = 0.8f,
            targetValue = 1.2f,
            animationSpec = infiniteRepeatable(
                animation = tween(900, easing = LinearEasing),
                repeatMode = RepeatMode.Reverse
            ),
            label = "pulseScale"
        )

        Box(modifier = modifier.size(size * 1.5f), contentAlignment = Alignment.Center) {
            Box(
                modifier = Modifier
                    .size(size * scale)
                    .clip(CircleShape)
                    .background(color.copy(alpha = alpha * 0.35f))
            )
            Box(
                modifier = Modifier
                    .size(size)
                    .clip(CircleShape)
                    .background(color)
            )
        }
    } else {
        Box(
            modifier = modifier
                .size(size)
                .clip(CircleShape)
                .background(color)
        )
    }
}

@Composable
fun StatusPill(
    text: String,
    color: Color = ChampagneGold,
    modifier: Modifier = Modifier,
    isLive: Boolean = false
) {
    Surface(
        modifier = modifier,
        color = color.copy(alpha = 0.12f),
        shape = CircleShape,
        border = BorderStroke(1.dp, color.copy(alpha = 0.35f))
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            if (isLive) {
                AutoGramStatusDot(color = color, isPulsing = true, size = 6.dp)
            }
            Text(
                text = text,
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, fontSize = 10.5.sp),
                color = color
            )
        }
    }
}

@Composable
fun AutoGramProgressBar(
    progress: Float,
    brush: Brush = ChampagneToCyanBrush,
    modifier: Modifier = Modifier,
    height: Dp = 5.dp
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
            .clip(CircleShape)
            .background(SurfaceDeep)
    ) {
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .fillMaxWidth(progress.coerceIn(0f, 1f))
                .clip(CircleShape)
                .background(brush)
        )
    }
}

@Composable
fun AutoGramEmptyState(
    title: String,
    description: String,
    icon: ImageVector = Icons.Default.FolderOpen,
    modifier: Modifier = Modifier
) {
    AutoGramGlassCard(
        modifier = modifier.fillMaxWidth(),
        containerColor = SurfaceGlassSoft,
        borderColor = BorderHairline
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 32.dp, horizontal = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Surface(
                shape = CircleShape,
                color = ChampagneGold.copy(alpha = 0.12f),
                modifier = Modifier.size(56.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = ChampagneGold,
                        modifier = Modifier.size(28.dp)
                    )
                }
            }
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                color = TextPrimaryDark
            )
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                color = TextSecondaryDark,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center
            )
        }
    }
}

@Composable
fun AutoGramErrorState(
    message: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    AutoGramGlassCard(
        modifier = modifier.fillMaxWidth(),
        borderColor = SoftCoral.copy(alpha = 0.35f),
        containerColor = SurfaceGlass
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Icon(Icons.Default.ErrorOutline, null, tint = SoftCoral, modifier = Modifier.size(36.dp))
            Text(text = message, color = TextPrimaryDark, style = MaterialTheme.typography.bodyMedium)
            Button(
                onClick = onRetry,
                colors = ButtonDefaults.buttonColors(containerColor = SoftCoral)
            ) {
                Text(stringResource(R.string.drive_action_refresh), color = Color.White)
            }
        }
    }
}

@Composable
fun ScreenHeader(
    @StringRes titleRes: Int,
    @StringRes subtitleRes: Int,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = stringResource(titleRes),
                style = MaterialTheme.typography.headlineMedium.copy(
                    fontWeight = FontWeight.Bold,
                    fontSize = 24.sp,
                    letterSpacing = (-0.3).sp
                ),
                color = TextPrimaryDark
            )
            Spacer(Modifier.height(1.dp))
            Text(
                text = stringResource(subtitleRes),
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                color = TextSecondaryDark
            )
        }
        if (action != null) {
            Spacer(Modifier.width(12.dp))
            action()
        }
    }
}
