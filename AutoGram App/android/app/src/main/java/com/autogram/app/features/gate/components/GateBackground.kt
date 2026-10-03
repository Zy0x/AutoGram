package com.autogram.app.features.gate.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import com.autogram.app.theme.CanvasDeepNavy
import com.autogram.app.theme.MutedIceCyan
import com.autogram.app.theme.SoftViolet
import kotlin.math.cos
import kotlin.math.sin

/**
 * High-performance Aurora Navy animated background canvas.
 * Renders an ethereal, ambient glow combining deep obsidian navy (#08111F),
 * electric ice cyan (#42D9FF), and soft cosmic violet (#A78BFA).
 */
@Composable
fun GateBackground(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit
) {
    val infiniteTransition = rememberInfiniteTransition(label = "aurora_ambient")
    val phase by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = (2 * Math.PI).toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 18000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "aurora_phase"
    )

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(CanvasDeepNavy)
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val width = size.width
            val height = size.height

            // Calculate subtle drifting centers for the two aurora glow nodes
            val cyanOffsetX = width * (0.25f + 0.12f * sin(phase))
            val cyanOffsetY = height * (0.20f + 0.08f * cos(phase))
            val violetOffsetX = width * (0.75f - 0.10f * cos(phase))
            val violetOffsetY = height * (0.45f + 0.10f * sin(phase))

            // Cyan ambient bloom
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        MutedIceCyan.copy(alpha = 0.16f),
                        MutedIceCyan.copy(alpha = 0.05f),
                        Color.Transparent
                    ),
                    center = Offset(cyanOffsetX, cyanOffsetY),
                    radius = width * 0.75f
                ),
                radius = width * 0.75f,
                center = Offset(cyanOffsetX, cyanOffsetY)
            )

            // Violet cosmic bloom
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        SoftViolet.copy(alpha = 0.14f),
                        SoftViolet.copy(alpha = 0.04f),
                        Color.Transparent
                    ),
                    center = Offset(violetOffsetX, violetOffsetY),
                    radius = width * 0.85f
                ),
                radius = width * 0.85f,
                center = Offset(violetOffsetX, violetOffsetY)
            )

            // Fine celestial orbital accents (subtle hairline arcs)
            drawCircle(
                color = MutedIceCyan.copy(alpha = 0.04f),
                radius = width * 0.65f,
                center = Offset(width * 0.5f, height * 0.35f),
                style = Stroke(width = 1f)
            )
            drawCircle(
                color = SoftViolet.copy(alpha = 0.03f),
                radius = width * 0.95f,
                center = Offset(width * 0.5f, height * 0.35f),
                style = Stroke(width = 0.75f)
            )
        }

        content()
    }
}
