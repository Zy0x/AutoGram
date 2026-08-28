package com.autogram.app.ui.transfer

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.StatusPill

@Composable
fun TransferCaptionModal(
    currentCaption: String = "📁 {filename}\n📦 {size} • 📅 {date}",
    onDismiss: () -> Unit,
    onSaveCaption: (String) -> Unit = {}
) {
    var captionText by remember { mutableStateOf(currentCaption) }

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
                            text = stringResource(R.string.transfer_caption_title),
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp
                            ),
                            color = Color.White
                        )
                    }

                    StatusPill(text = "Markdown V2", color = MutedIceCyan, isLive = false)
                }

                // Template Tag Chips
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = stringResource(R.string.transfer_caption_tags_label),
                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                        color = TextPrimaryDark
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf(
                            "{filename}" to "Nama File",
                            "{size}" to "Ukuran",
                            "{date}" to "Tanggal",
                            "{hash}" to "SHA256 Hash",
                            "{dc}" to "Pusat Data DC"
                        ).forEach { (tag, label) ->
                            Surface(
                                onClick = { captionText += " $tag" },
                                shape = RoundedCornerShape(8.dp),
                                color = GoldAccent.copy(alpha = 0.12f),
                                border = BorderStroke(1.dp, GoldAccent.copy(alpha = 0.4f))
                            ) {
                                Text(
                                    text = tag,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontFamily = FontFamily.Monospace,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 11.sp
                                    ),
                                    color = GoldAccent
                                )
                            }
                        }
                    }
                }

                // Text Input Area
                OutlinedTextField(
                    value = captionText,
                    onValueChange = { captionText = it },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(130.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = GoldAccent,
                        unfocusedBorderColor = CardNavyBorder,
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White
                    ),
                    placeholder = { Text(stringResource(R.string.transfer_caption_hint), color = TextMutedDark) }
                )

                // Live Preview Card
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = stringResource(R.string.transfer_caption_preview_label),
                        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                        color = TextPrimaryDark
                    )
                    Surface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                        color = Color(0xF00B1C30),
                        border = BorderStroke(1.dp, CardNavyBorder)
                    ) {
                        val renderedPreview = captionText
                            .replace("{filename}", "Promo_B_Roll.mp4")
                            .replace("{size}", "14.7 MB")
                            .replace("{date}", "28 Aug 2026")
                            .replace("{hash}", "e3b0c44298fc1c149afbf4c8996fb924")
                            .replace("{dc}", "DC4 Production")

                        Text(
                            text = renderedPreview,
                            modifier = Modifier.padding(12.dp),
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontFamily = FontFamily.Default,
                                fontSize = 12.sp
                            ),
                            color = MutedIceCyan
                        )
                    }
                }

                // Save CTA Button
                Button(
                    onClick = {
                        onSaveCaption(captionText)
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
                    Icon(Icons.Default.Save, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = stringResource(R.string.transfer_caption_save),
                        style = MaterialTheme.typography.labelLarge.copy(fontWeight = FontWeight.Bold)
                    )
                }

                Spacer(Modifier.height(30.dp))
            }
        }
    }
}