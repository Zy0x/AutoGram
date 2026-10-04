package com.autogram.app.ui.drive.preview

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramGlassCard
import com.autogram.app.ui.drive.formatFileSize

data class HexLine(
    val offset: Long,
    val hexPart: String,
    val asciiPart: String
)

@Composable
fun DriveHexInspector(
    bytes: ByteArray,
    fileName: String,
    modifier: Modifier = Modifier
) {
    val lines = remember(bytes) {
        val list = mutableListOf<HexLine>()
        var offset = 0
        while (offset < bytes.size && list.size < 1000) {
            val chunkLen = minOf(16, bytes.size - offset)
            val chunk = bytes.copyOfRange(offset, offset + chunkLen)

            val hexSb = StringBuilder()
            val asciiSb = StringBuilder()

            for (i in 0 until 16) {
                if (i == 8) hexSb.append(" ")
                if (i < chunkLen) {
                    val b = chunk[i].toInt() and 0xFF
                    hexSb.append(String.format("%02X ", b))
                    if (b in 32..126) {
                        asciiSb.append(b.toChar())
                    } else {
                        asciiSb.append('.')
                    }
                } else {
                    hexSb.append("   ")
                    asciiSb.append(' ')
                }
            }

            list.add(HexLine(offset.toLong(), hexSb.toString(), asciiSb.toString()))
            offset += 16
        }
        list
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(12.dp)
            .testTag("hex-inspector"),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Toolbar
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.Memory, null, tint = SoftViolet, modifier = Modifier.size(20.dp))
                Text(
                    text = stringResource(R.string.preview_hex_title),
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark
                )
            }

            Surface(
                shape = RoundedCornerShape(6.dp),
                color = SoftViolet.copy(alpha = 0.15f)
            ) {
                Text(
                    text = formatFileSize(bytes.size.toLong()),
                    style = MaterialTheme.typography.labelSmall,
                    color = SoftViolet,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                )
            }
        }

        // Monospace Hex Grid
        val hScroll = rememberScrollState()
        AutoGramGlassCard(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .horizontalScroll(hScroll)
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxHeight(),
                    contentPadding = PaddingValues(8.dp),
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    // Header row
                    item {
                        Row(modifier = Modifier.padding(bottom = 6.dp)) {
                            Text(
                                text = stringResource(R.string.preview_hex_offset_header),
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontFamily = FontFamily.Monospace,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 11.sp
                                ),
                                color = SoftViolet
                            )
                            Text(
                                text = "00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F  ",
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontFamily = FontFamily.Monospace,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 11.sp
                                ),
                                color = TextSecondaryDark
                            )
                            Text(
                                text = stringResource(R.string.preview_hex_ascii_header),
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontFamily = FontFamily.Monospace,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 11.sp
                                ),
                                color = DustySage
                            )
                        }
                        HorizontalDivider(color = BorderHairline)
                    }

                    itemsIndexed(lines) { _, line ->
                        Row(modifier = Modifier.padding(vertical = 1.dp)) {
                            // Offset
                            Text(
                                text = String.format("%08X ", line.offset),
                                style = MaterialTheme.typography.bodySmall.copy(
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.sp
                                ),
                                color = SoftViolet
                            )
                            // Hex Bytes
                            Text(
                                text = line.hexPart,
                                style = MaterialTheme.typography.bodySmall.copy(
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.sp
                                ),
                                color = TextPrimaryDark
                            )
                            // ASCII
                            Text(
                                text = " |${line.asciiPart}|",
                                style = MaterialTheme.typography.bodySmall.copy(
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 11.sp
                                ),
                                color = DustySage
                            )
                        }
                    }
                }
            }
        }
    }
}
