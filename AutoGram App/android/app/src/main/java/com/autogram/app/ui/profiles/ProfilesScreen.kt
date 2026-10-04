package com.autogram.app.ui.profiles

import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramGlassCard
import com.autogram.app.ui.components.AutoGramSurface

data class TransferProfilePreset(
    val id: String,
    val titleRes: Int,
    val descRes: Int,
    val streams: Int,
    val chunkSize: String,
    val circuitBreaker: Boolean,
    val accentColor: Color
)

@Composable
fun ProfilesScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current

    val presets = listOf(
        TransferProfilePreset(
            id = "TURBO",
            titleRes = R.string.profiles_preset_turbo,
            descRes = R.string.profiles_preset_turbo_desc,
            streams = 8,
            chunkSize = "1 MB",
            circuitBreaker = true,
            accentColor = SoftViolet
        ),
        TransferProfilePreset(
            id = "BALANCED",
            titleRes = R.string.profiles_preset_balanced,
            descRes = R.string.profiles_preset_balanced_desc,
            streams = 4,
            chunkSize = "512 KB",
            circuitBreaker = true,
            accentColor = MutedIceCyan
        ),
        TransferProfilePreset(
            id = "ECO",
            titleRes = R.string.profiles_preset_eco,
            descRes = R.string.profiles_preset_eco_desc,
            streams = 2,
            chunkSize = "128 KB",
            circuitBreaker = true,
            accentColor = DustySage
        )
    )

    var activePresetId by remember { mutableStateOf("BALANCED") }
    var streamsCount by remember { mutableIntStateOf(4) }
    var selectedChunkSize by remember { mutableStateOf("512 KB") }
    var circuitBreakerEnabled by remember { mutableStateOf(true) }

    val chunkSizes = listOf("128 KB", "256 KB", "512 KB", "1 MB")

    AutoGramSurface(modifier = modifier) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = stringResource(R.string.profiles_title),
                        style = MaterialTheme.typography.headlineMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 24.sp,
                            letterSpacing = (-0.5).sp
                        ),
                        color = TextPrimaryDark
                    )
                    Text(
                        text = stringResource(R.string.profiles_subtitle),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = TextSecondaryDark
                    )
                }
            }

            // Presets Cards
            item {
                Text(
                    text = "Preset Cepat:",
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = TextSecondaryDark
                )
            }

            items(presets.size) { index ->
                val p = presets[index]
                val isSelected = activePresetId == p.id
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    borderColor = if (isSelected) p.accentColor else BorderHairline,
                    containerColor = if (isSelected) p.accentColor.copy(alpha = 0.08f) else SurfaceDeep,
                    onClick = {
                        activePresetId = p.id
                        streamsCount = p.streams
                        selectedChunkSize = p.chunkSize
                        circuitBreakerEnabled = p.circuitBreaker
                    }
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    text = stringResource(p.titleRes),
                                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                    color = if (isSelected) p.accentColor else TextPrimaryDark
                                )
                                if (isSelected) {
                                    Surface(shape = RoundedCornerShape(4.dp), color = p.accentColor.copy(alpha = 0.2f)) {
                                        Text(
                                            text = "AKTIF",
                                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, fontSize = 9.sp, color = p.accentColor)
                                        )
                                    }
                                }
                            }
                            Text(
                                text = stringResource(p.descRes),
                                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                color = TextSecondaryDark
                            )
                        }

                        RadioButton(
                            selected = isSelected,
                            onClick = {
                                activePresetId = p.id
                                streamsCount = p.streams
                                selectedChunkSize = p.chunkSize
                                circuitBreakerEnabled = p.circuitBreaker
                            },
                            colors = RadioButtonDefaults.colors(selectedColor = p.accentColor)
                        )
                    }
                }
            }

            // Custom Fine-Tuning Card
            item {
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    borderColor = BorderHairline,
                    containerColor = SurfaceDeep
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Text(
                            text = stringResource(R.string.profiles_preset_custom),
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            color = TextPrimaryDark
                        )

                        // Streams Concurrency Slider
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = stringResource(R.string.profiles_streams_slider, streamsCount),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextPrimaryDark
                                )
                            }
                            Slider(
                                value = streamsCount.toFloat(),
                                onValueChange = {
                                    streamsCount = it.toInt()
                                    activePresetId = "CUSTOM"
                                },
                                valueRange = 1f..8f,
                                steps = 6,
                                colors = SliderDefaults.colors(
                                    thumbColor = MutedIceCyan,
                                    activeTrackColor = MutedIceCyan,
                                    inactiveTrackColor = SurfaceElevatedDark
                                )
                            )
                        }

                        // Chunk Size Selector
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                text = stringResource(R.string.profiles_chunk_label),
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                                color = TextSecondaryDark
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                                chunkSizes.forEach { cSize ->
                                    val isSelected = selectedChunkSize == cSize
                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = if (isSelected) MutedIceCyan.copy(alpha = 0.2f) else SurfaceElevatedDark,
                                        border = BorderStroke(1.dp, if (isSelected) MutedIceCyan else BorderHairline),
                                        modifier = Modifier.weight(1f).clickable {
                                            selectedChunkSize = cSize
                                            activePresetId = "CUSTOM"
                                        }
                                    ) {
                                        Box(modifier = Modifier.padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                                            Text(
                                                text = cSize,
                                                style = MaterialTheme.typography.labelSmall.copy(
                                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                                    fontSize = 11.sp
                                                ),
                                                color = if (isSelected) MutedIceCyan else TextSecondaryDark
                                            )
                                        }
                                    }
                                }
                            }
                        }

                        // FloodWait Circuit Breaker Switch
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(stringResource(R.string.profiles_circuit_breaker), style = MaterialTheme.typography.bodySmall, color = TextPrimaryDark)
                            Switch(
                                checked = circuitBreakerEnabled,
                                onCheckedChange = {
                                    circuitBreakerEnabled = it
                                    activePresetId = "CUSTOM"
                                }
                            )
                        }

                        // Apply Button
                        Button(
                            onClick = {
                                Toast.makeText(context, context.getString(R.string.profiles_applied_success), Toast.LENGTH_SHORT).show()
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = DustySage, contentColor = SurfaceDeep),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 44.dp)
                        ) {
                            Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.profiles_action_apply), fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}
