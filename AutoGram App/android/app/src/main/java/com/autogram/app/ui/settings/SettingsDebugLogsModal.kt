package com.autogram.app.ui.settings

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.StatusPill

data class LogEntry(
    val timestamp: String,
    val level: String,
    val message: String
)

@Composable
fun SettingsDebugLogsModal(
    onDismiss: () -> Unit
) {
    var filterLevel by remember { mutableStateOf("ALL") }
    val logs = remember {
        listOf(
            LogEntry("22:58:12.102", "INFO", "[MTProto] Connected to DC4 Production (149.154.167.91:443) via Grammers TLS"),
            LogEntry("22:58:12.314", "INFO", "[Auth] Session token verified. User: @AutoGramCloud (ID: 6729104)"),
            LogEntry("22:58:13.001", "INFO", "[Drive] SQLite metadata cache sync completed: 12 entries verified"),
            LogEntry("22:58:14.220", "WARN", "[Concurrency] FloodWait backoff active: reduced parallel threads to 4"),
            LogEntry("22:58:15.541", "INFO", "[MediaCodec] Hardware acceleration initialized: H.264/HEVC 60 FPS"),
            LogEntry("22:58:16.890", "INFO", "[Transfer] Chunk stream 512 KB dispatched with strict SHA256 integrity")
        )
    }

    val filteredLogs = when (filterLevel) {
        "INFO" -> logs.filter { it.level == "INFO" }
        "WARN" -> logs.filter { it.level == "WARN" }
        "ERROR" -> logs.filter { it.level == "ERROR" }
        else -> logs
    }

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
                    .padding(horizontal = 20.dp),
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
                            text = stringResource(R.string.settings_logs_title),
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp
                            ),
                            color = Color.White
                        )
                    }

                    StatusPill(text = "Live Stream", color = DustySage, isLive = true)
                }

                // Filter Level Chips
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    listOf("ALL", "INFO", "WARN", "ERROR").forEach { level ->
                        val isChosen = filterLevel == level
                        val chipColor = when (level) {
                            "WARN" -> ChampagneGold
                            "ERROR" -> SoftCoral
                            "INFO" -> MutedIceCyan
                            else -> GoldAccent
                        }
                        Surface(
                            onClick = { filterLevel = level },
                            shape = RoundedCornerShape(8.dp),
                            color = if (isChosen) chipColor.copy(alpha = 0.2f) else CardNavyBg,
                            border = BorderStroke(1.dp, if (isChosen) chipColor else CardNavyBorder)
                        ) {
                            Text(
                                text = level,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontWeight = if (isChosen) FontWeight.Bold else FontWeight.Medium,
                                    fontSize = 11.sp
                                ),
                                color = if (isChosen) chipColor else TextSecondaryDark
                            )
                        }
                    }
                }

                // Log Stream Box
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    shape = RoundedCornerShape(14.dp),
                    color = Color(0xF0030C18),
                    border = BorderStroke(1.dp, CardNavyBorder)
                ) {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(filteredLogs) { log ->
                            val levelColor = when (log.level) {
                                "WARN" -> ChampagneGold
                                "ERROR" -> SoftCoral
                                else -> MutedIceCyan
                            }
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Row(
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = log.timestamp,
                                        style = MaterialTheme.typography.labelSmall.copy(
                                            fontFamily = FontFamily.Monospace,
                                            fontSize = 9.5.sp
                                        ),
                                        color = TextMutedDark
                                    )
                                    Text(
                                        text = "[${log.level}]",
                                        style = MaterialTheme.typography.labelSmall.copy(
                                            fontFamily = FontFamily.Monospace,
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 9.5.sp
                                        ),
                                        color = levelColor
                                    )
                                }
                                Text(
                                    text = log.message,
                                    style = MaterialTheme.typography.bodySmall.copy(
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 11.sp
                                    ),
                                    color = TextPrimaryDark
                                )
                            }
                        }
                    }
                }

                // Action Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Button(
                        onClick = { onDismiss() },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = GoldAccent,
                            contentColor = CanvasDeepNavy
                        )
                    ) {
                        Icon(Icons.Default.ContentCopy, null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(text = stringResource(R.string.settings_logs_copy), fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}