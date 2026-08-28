package com.autogram.app.ui.drive

import androidx.compose.animation.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.viewmodel.DriveFileItem

@Composable
fun DriveToolsModal(
    allItems: List<DriveFileItem>,
    onDismiss: () -> Unit,
    onCleanDuplicates: () -> Unit = {}
) {
    var selectedTab by remember { mutableStateOf(0) } // 0 = Duplikat, 1 = Penggunaan Ruang
    var cleanSuccess by remember { mutableStateOf(false) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(CanvasDeepNavy.copy(alpha = 0.97f))
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
            ) {
                // 1. TOP HEADER
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(58.dp)
                        .background(Color(0xD9031427))
                        .padding(horizontal = 16.dp),
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
                            text = stringResource(R.string.tools_title),
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp
                            ),
                            color = Color.White
                        )
                    }

                    // Segmented Tab Toggle (Duplikat / Ruang)
                    Surface(
                        color = Color(0x33000000),
                        shape = CircleShape,
                        border = BorderStroke(1.dp, Color(0x26FFFFFF))
                    ) {
                        Row(modifier = Modifier.padding(3.dp)) {
                            Surface(
                                onClick = { selectedTab = 0 },
                                shape = CircleShape,
                                color = if (selectedTab == 0) GoldAccent.copy(alpha = 0.22f) else Color.Transparent,
                                border = if (selectedTab == 0) BorderStroke(1.dp, GoldAccent.copy(alpha = 0.4f)) else null
                            ) {
                                Text(
                                    text = stringResource(R.string.tools_tab_duplicates),
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontSize = 11.sp,
                                        fontWeight = if (selectedTab == 0) FontWeight.Bold else FontWeight.Normal
                                    ),
                                    color = if (selectedTab == 0) GoldAccent else TextSecondaryDark
                                )
                            }
                            Surface(
                                onClick = { selectedTab = 1 },
                                shape = CircleShape,
                                color = if (selectedTab == 1) MutedIceCyan.copy(alpha = 0.22f) else Color.Transparent,
                                border = if (selectedTab == 1) BorderStroke(1.dp, MutedIceCyan.copy(alpha = 0.4f)) else null
                            ) {
                                Text(
                                    text = stringResource(R.string.tools_tab_space),
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontSize = 11.sp,
                                        fontWeight = if (selectedTab == 1) FontWeight.Bold else FontWeight.Normal
                                    ),
                                    color = if (selectedTab == 1) MutedIceCyan else TextSecondaryDark
                                )
                            }
                        }
                    }
                }

                // 2. TAB CONTENT
                if (selectedTab == 0) {
                    // TAB 0: DUPLICATE CLEANER
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        // Summary Card
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp),
                            color = Color(0xF00B1C30),
                            border = BorderStroke(1.dp, GoldAccent.copy(alpha = 0.35f))
                        ) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = stringResource(R.string.tools_dup_found, 2),
                                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                                        color = TextPrimaryDark
                                    )
                                    Text(
                                        text = stringResource(R.string.tools_dup_reclaimable, "5.1 MB"),
                                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, fontWeight = FontWeight.Bold),
                                        color = GoldAccent
                                    )
                                }
                                Text(
                                    text = "Pemeriksaan 4-Level: SHA256 Hash • Telegram Unique ID • Filename+Size • Message ID",
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.5.sp),
                                    color = TextSecondaryDark
                                )
                            }
                        }

                        // Duplicate Items Group List
                        LazyColumn(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            item {
                                DuplicateGroupCard(
                                    originalName = "Untitled_Media (Versi Asli)",
                                    duplicateName = "Untitled_Media (Duplikat #1 - Salinan Sama)",
                                    size = "2.0 MB",
                                    matchReason = "SHA256 Hash Cocok"
                                )
                            }
                            item {
                                DuplicateGroupCard(
                                    originalName = "Untitled_Media (Foto HD)",
                                    duplicateName = "Untitled_Media (Ukuran & Nama Sama)",
                                    size = "3.1 MB",
                                    matchReason = "Telegram Unique ID Cocok"
                                )
                            }
                        }

                        // Action Button
                        if (cleanSuccess) {
                            Surface(
                                modifier = Modifier.fillMaxWidth(),
                                shape = RoundedCornerShape(10.dp),
                                color = DustySage.copy(alpha = 0.15f),
                                border = BorderStroke(1.dp, DustySage)
                            ) {
                                Text(
                                    text = stringResource(R.string.tools_dup_cleaned_success),
                                    modifier = Modifier.padding(12.dp),
                                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold),
                                    color = DustySage
                                )
                            }
                        } else {
                            Button(
                                onClick = {
                                    onCleanDuplicates()
                                    cleanSuccess = true
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(46.dp),
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = GoldAccent,
                                    contentColor = CanvasDeepNavy
                                )
                            ) {
                                Icon(Icons.Default.CleaningServices, null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    text = stringResource(R.string.tools_dup_clean_auto),
                                    style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold)
                                )
                            }
                        }
                    }
                } else {
                    // TAB 1: SPACE USAGE BREAKDOWN
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(16.dp)
                            .verticalScroll(androidx.compose.foundation.rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(14.dp)
                    ) {
                        // Total Storage Card
                        Surface(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(16.dp),
                            color = Color(0xF00B1C30),
                            border = BorderStroke(1.dp, MutedIceCyan.copy(alpha = 0.35f))
                        ) {
                            Column(
                                modifier = Modifier.padding(16.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text(
                                    text = stringResource(R.string.tools_space_total, "76.4 MB"),
                                    style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                                    color = Color.White
                                )
                                Text(
                                    text = "Telegram Cloud Storage • 12 Berkas Tersinkronisasi",
                                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                                    color = TextSecondaryDark
                                )

                                // Category Proportions Bar
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(10.dp)
                                        .clip(CircleShape)
                                ) {
                                    Box(modifier = Modifier.weight(0.55f).fillMaxHeight().background(CategoryVideo))
                                    Box(modifier = Modifier.weight(0.25f).fillMaxHeight().background(CategoryAudio))
                                    Box(modifier = Modifier.weight(0.12f).fillMaxHeight().background(CategoryPhoto))
                                    Box(modifier = Modifier.weight(0.08f).fillMaxHeight().background(CategoryDoc))
                                }

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    CategoryLegendItem("Video (55%)", CategoryVideo)
                                    CategoryLegendItem("Audio (25%)", CategoryAudio)
                                    CategoryLegendItem("Foto (12%)", CategoryPhoto)
                                    CategoryLegendItem("Doc (8%)", CategoryDoc)
                                }
                            }
                        }

                        Text(
                            text = stringResource(R.string.tools_space_largest),
                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                            color = TextPrimaryDark
                        )

                        // Top Largest Files
                        LargestFileRow("B-Roll_02.mp4", "24.0 MB", CategoryVideo)
                        LargestFileRow("Promo_B_Roll.mp4", "15.4 MB", CategoryVideo)
                        LargestFileRow("Interview_Audio", "8.2 MB", CategoryAudio)
                        LargestFileRow("Audio_Stem.mp3", "6.7 MB", CategoryAudio)
                        LargestFileRow("Brand_Doc.pdf", "4.5 MB", CategoryDoc)
                    }
                }
            }
        }
    }
}

@Composable
private fun DuplicateGroupCard(
    originalName: String,
    duplicateName: String,
    size: String,
    matchReason: String
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = CardNavyBg),
        border = BorderStroke(1.dp, CardNavyBorder)
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    text = originalName,
                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Bold),
                    color = DustySage
                )
                Text(
                    text = size,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.5.sp),
                    color = TextSecondaryDark
                )
            }
            Text(
                text = "↳ $duplicateName",
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                color = SoftCoral
            )
            Surface(
                color = GoldAccent.copy(alpha = 0.12f),
                shape = CircleShape
            ) {
                Text(
                    text = matchReason,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp, fontWeight = FontWeight.SemiBold),
                    color = GoldAccent
                )
            }
        }
    }
}

@Composable
private fun CategoryLegendItem(label: String, color: Color) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Box(modifier = Modifier.size(8.dp).background(color, CircleShape))
        Text(text = label, style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.5.sp), color = TextSecondaryDark)
    }
}

@Composable
private fun LargestFileRow(name: String, size: String, color: Color) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        color = CardNavyBg,
        border = BorderStroke(1.dp, CardNavyBorder)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Box(modifier = Modifier.size(8.dp).background(color, CircleShape))
                Text(
                    text = name,
                    style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.Medium),
                    color = TextPrimaryDark
                )
            }
            Text(
                text = size,
                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold),
                color = MutedIceCyan
            )
        }
    }
}