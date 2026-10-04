package com.autogram.app.ui.drive.preview

import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramGlassCard
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.GZIPInputStream

data class TgsMetadata(
    val width: Int,
    val height: Int,
    val fps: Float,
    val totalFrames: Float,
    val durationSecs: Float,
    val layerCount: Int
)

@Composable
fun DriveLottiePlayer(
    rawBytes: ByteArray,
    fileName: String,
    modifier: Modifier = Modifier
) {
    var isPlaying by remember { mutableStateOf(true) }
    var isLooping by remember { mutableStateOf(true) }
    var isLightCanvas by remember { mutableStateOf(false) }

    // Decompress TGS GZIP bytes in RAM
    val jsonString = remember(rawBytes) {
        try {
            val bis = ByteArrayInputStream(rawBytes)
            val gzip = GZIPInputStream(bis)
            val bos = ByteArrayOutputStream()
            val buf = ByteArray(4096)
            var len: Int
            while (gzip.read(buf).also { len = it } > 0) {
                bos.write(buf, 0, len)
            }
            gzip.close()
            bos.toString("UTF-8")
        } catch (_: Exception) {
            // If already uncompressed JSON
            String(rawBytes, Charsets.UTF_8)
        }
    }

    val metadata = remember(jsonString) {
        try {
            val obj = JSONObject(jsonString)
            val w = obj.optInt("w", 512)
            val h = obj.optInt("h", 512)
            val fr = obj.optDouble("fr", 60.0).toFloat()
            val ip = obj.optDouble("ip", 0.0).toFloat()
            val op = obj.optDouble("op", 180.0).toFloat()
            val layers = obj.optJSONArray("layers")?.length() ?: 0
            val frames = (op - ip).coerceAtLeast(1f)
            val dur = if (fr > 0) frames / fr else 3f
            TgsMetadata(w, h, fr, frames, dur, layers)
        } catch (_: Exception) {
            TgsMetadata(512, 512, 60f, 180f, 3f, 1)
        }
    }

    var currentFrame by remember { mutableFloatStateOf(0f) }

    // Frame animation loop
    LaunchedEffect(isPlaying, isLooping, metadata) {
        if (!isPlaying) return@LaunchedEffect
        val intervalMs = (1000f / metadata.fps.coerceIn(15f, 60f)).toLong().coerceIn(16L, 66L)
        while (isPlaying) {
            delay(intervalMs)
            currentFrame += 1f
            if (currentFrame >= metadata.totalFrames) {
                if (isLooping) {
                    currentFrame = 0f
                } else {
                    currentFrame = metadata.totalFrames
                    isPlaying = false
                }
            }
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp)
            .testTag("sticker-player"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Top Toolbar
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.Animation, null, tint = SoftViolet, modifier = Modifier.size(20.dp))
                Text(
                    text = stringResource(R.string.preview_sticker_title),
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark
                )
            }

            // Canvas Theme Toggle
            IconButton(
                onClick = { isLightCanvas = !isLightCanvas },
                modifier = Modifier.size(40.dp)
            ) {
                Icon(
                    imageVector = if (isLightCanvas) Icons.Default.DarkMode else Icons.Default.LightMode,
                    contentDescription = null,
                    tint = SoftViolet
                )
            }
        }

        // Animated Vector Canvas Box
        Surface(
            shape = RoundedCornerShape(20.dp),
            color = if (isLightCanvas) Color(0xFFF5F5F7) else SurfaceElevatedDark,
            border = BorderStroke(1.dp, BorderHairline),
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 8.dp)
        ) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    // Vector Sticker Visual Indicator (Animated Pulsing Vector Badge)
                    val pulseScale by animateFloatAsState(
                        targetValue = if (isPlaying) 1.05f else 1.0f,
                        animationSpec = infiniteRepeatable(
                            animation = tween(durationMillis = 600, easing = FastOutSlowInEasing),
                            repeatMode = RepeatMode.Reverse
                        ),
                        label = "sticker-pulse"
                    )

                    Surface(
                        shape = CircleShape,
                        color = SoftViolet.copy(alpha = if (isLightCanvas) 0.15f else 0.25f),
                        border = BorderStroke(2.dp, SoftViolet.copy(alpha = 0.5f)),
                        modifier = Modifier.size((140 * pulseScale).dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = Icons.Default.AutoAwesome,
                                contentDescription = null,
                                tint = SoftViolet,
                                modifier = Modifier.size(56.dp)
                            )
                        }
                    }

                    Text(
                        text = fileName,
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold),
                        color = if (isLightCanvas) Color(0xFF1D1D1F) else TextPrimaryDark
                    )

                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = SoftViolet.copy(alpha = 0.2f)
                        ) {
                            Text(
                                text = "${metadata.width}x${metadata.height}",
                                style = MaterialTheme.typography.labelSmall,
                                color = SoftViolet,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = DustySage.copy(alpha = 0.2f)
                        ) {
                            Text(
                                text = "${metadata.fps.toInt()} FPS",
                                style = MaterialTheme.typography.labelSmall,
                                color = DustySage,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = Color(0xFFFFB74D).copy(alpha = 0.2f)
                        ) {
                            Text(
                                text = "${metadata.layerCount} Layers",
                                style = MaterialTheme.typography.labelSmall,
                                color = Color(0xFFFFB74D),
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }
                }
            }
        }

        // Playback Controls Bar
        AutoGramGlassCard(modifier = Modifier.fillMaxWidth()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // Timeline Slider
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "${currentFrame.toInt()} / ${metadata.totalFrames.toInt()}f",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextMutedDark
                    )
                    Text(
                        text = String.format("%.1fs", metadata.durationSecs),
                        style = MaterialTheme.typography.labelSmall,
                        color = TextMutedDark
                    )
                }

                Slider(
                    value = currentFrame,
                    onValueChange = { currentFrame = it },
                    valueRange = 0f..metadata.totalFrames,
                    modifier = Modifier.fillMaxWidth()
                )

                // Buttons: Loop, Play/Pause
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = { isLooping = !isLooping },
                        modifier = Modifier.size(44.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Repeat,
                            contentDescription = stringResource(R.string.preview_sticker_loop),
                            tint = if (isLooping) SoftViolet else TextMutedDark
                        )
                    }

                    Spacer(Modifier.width(16.dp))

                    FilledIconButton(
                        onClick = { isPlaying = !isPlaying },
                        modifier = Modifier.size(52.dp),
                        colors = IconButtonDefaults.filledIconButtonColors(containerColor = SoftViolet)
                    ) {
                        Icon(
                            imageVector = if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = stringResource(if (isPlaying) R.string.preview_sticker_pause else R.string.preview_sticker_play),
                            tint = Color.White
                        )
                    }
                }
            }
        }
    }
}
