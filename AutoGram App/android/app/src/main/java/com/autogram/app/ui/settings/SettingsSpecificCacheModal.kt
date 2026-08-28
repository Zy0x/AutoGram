package com.autogram.app.ui.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.StatusPill

@Composable
fun SettingsSpecificCacheModal(
    onDismiss: () -> Unit,
    onClean: () -> Unit = {}
) {
    var cleanThumbs by remember { mutableStateOf(true) }
    var cleanTemp by remember { mutableStateOf(true) }
    var vacuumDb by remember { mutableStateOf(false) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(CanvasDeepNavy.copy(alpha = 0.96f))
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .padding(horizontal = 20.dp)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                // Header
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        IconButton(
                            onClick = onDismiss,
                            modifier = Modifier
                                .size(36.dp)
                                .background(Color(0x22FFFFFF), CircleShape)
                        ) {
                            Icon(Icons.Default.Close, null, tint = Color.White, modifier = Modifier.size(18.dp))
                        }
                        Text(
                            text = stringResource(R.string.settings_cache_detail_title),
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp
                            ),
                            color = Color.White
                        )
                    }

                    StatusPill(text = "Total 62.8 MB", color = GoldAccent, isLive = false)
                }

                // Checkbox Options
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    color = CardNavyBg,
                    border = BorderStroke(1.dp, CardNavyBorder)
                ) {
                    Column(
                        modifier = Modifier.padding(14.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        // 1. Thumbs
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(text = "Cache Thumbnail & Pratinjau", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold), color = TextPrimaryDark)
                                Text(text = "14.2 MB di penyimpanan internal", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp), color = TextSecondaryDark)
                            }
                            Checkbox(checked = cleanThumbs, onCheckedChange = { cleanThumbs = it }, colors = CheckboxDefaults.colors(checkedColor = GoldAccent))
                        }
                        HorizontalDivider(color = Color(0x14FFFFFF))

                        // 2. Temp Downloads
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(text = "Berkas Unduhan Sementara MTProto", style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold), color = TextPrimaryDark)
                                Text(text = "48.6 MB chunk streaming", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp), color = TextSecondaryDark)
                            }
                            Checkbox(checked = cleanTemp, onCheckedChange = { cleanTemp = it }, colors = CheckboxDefaults.colors(checkedColor = GoldAccent))
                        }
                        HorizontalDivider(color = Color(0x14FFFFFF))

                        // 3. Vacuum DB
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(text = stringResource(R.string.settings_cache_vacuum_db), style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold), color = TextPrimaryDark)
                                Text(text = "Rekonstruksi & defragmentasi SQLite database", style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp), color = TextSecondaryDark)
                            }
                            Checkbox(checked = vacuumDb, onCheckedChange = { vacuumDb = it }, colors = CheckboxDefaults.colors(checkedColor = GoldAccent))
                        }
                    }
                }

                // Clean Button
                Button(
                    onClick = {
                        onClean()
                        onDismiss()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(48.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = GoldAccent,
                        contentColor = CanvasDeepNavy
                    )
                ) {
                    Icon(Icons.Default.CleaningServices, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = stringResource(R.string.settings_cache_clean_selected),
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold)
                    )
                }

                Spacer(Modifier.height(30.dp))
            }
        }
    }
}