package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.viewmodel.DriveFileItem

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FileGridItem(
    item: DriveFileItem,
    isSelected: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val isVideo = item.mimeType.startsWith("video") || item.telegramCategory.equals("video", ignoreCase = true)
    val isAudio = item.mimeType.startsWith("audio") || item.telegramCategory.equals("audio", ignoreCase = true)
    val isImage = item.mimeType.startsWith("image") || item.telegramCategory.equals("photo", ignoreCase = true)
    val isSync = item.name.contains("Processing", ignoreCase = true) || item.name.contains("Sync", ignoreCase = true)

    val border = when {
        isSelected -> BorderStroke(1.5.dp, GoldAccent)
        isSync -> BorderStroke(1.dp, GoldAccent.copy(alpha = 0.5f))
        else -> BorderStroke(1.dp, CardNavyBorder)
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .height(132.dp)
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            ),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) SurfaceElevatedDark else CardNavyBg
        ),
        border = border
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            // Background Image for Photos/Videos with thumbnail
            if (!item.thumbnailUri.isNullOrBlank()) {
                AsyncImage(
                    model = item.thumbnailUri,
                    contentDescription = item.name,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
                // Bottom vignette gradient
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                        .align(Alignment.BottomCenter)
                        .background(
                            Brush.verticalGradient(
                                colors = listOf(Color.Transparent, Color(0xDD090E17))
                            )
                        )
                )
            } else if (item.isFolder) {
                // Folder Center Layout (matching user reference mockup)
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 6.dp, vertical = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Folder,
                        contentDescription = null,
                        tint = MutedIceCyan.copy(alpha = 0.75f),
                        modifier = Modifier.size(34.dp)
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = item.name,
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 11.sp
                        ),
                        color = TextPrimaryDark,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.Center
                    )
                    Text(
                        text = "${(item.size % 20 + 5)} items",
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                        color = TextMutedDark,
                        textAlign = TextAlign.Center
                    )
                }
            } else if (isSync) {
                // Sync / Processing Center Layout
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 6.dp, vertical = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Surface(
                        shape = CircleShape,
                        color = Color.Transparent,
                        border = BorderStroke(1.5.dp, GoldAccent),
                        modifier = Modifier.size(28.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                Icons.Default.MoreHoriz,
                                contentDescription = null,
                                tint = GoldAccent,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = "SYNC",
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 8.5.sp,
                            letterSpacing = 0.8.sp
                        ),
                        color = GoldAccent
                    )
                }
            } else {
                // Audio / Doc / Image Type Icon Center Layout
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 6.dp, vertical = 12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    val icon = when {
                        isImage -> Icons.Default.Image
                        isAudio -> Icons.Default.MusicNote
                        else -> Icons.Default.InsertDriveFile
                    }
                    val extLabel = when {
                        isImage -> "JPG"
                        isAudio -> "MP3"
                        item.mimeType.contains("pdf") -> "PDF"
                        else -> "FILE"
                    }

                    Icon(
                        imageVector = icon,
                        contentDescription = null,
                        tint = MutedIceCyan.copy(alpha = 0.7f),
                        modifier = Modifier.size(28.dp)
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = extLabel,
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontSize = 8.5.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 0.5.sp
                        ),
                        color = TextSecondaryDark
                    )
                }
            }

            // Top-Left Video Duration Badge [▶ 1:34]
            if (isVideo) {
                Surface(
                    shape = RoundedCornerShape(4.dp),
                    color = Color(0xCC000000),
                    modifier = Modifier
                        .padding(top = 6.dp, start = 6.dp)
                        .align(Alignment.TopStart)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        Icon(
                            Icons.Default.PlayArrow,
                            contentDescription = null,
                            tint = Color.White,
                            modifier = Modifier.size(9.dp)
                        )
                        Text(
                            text = if (item.size % 2 == 0L) "1:34" else "0:45",
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 8.5.sp,
                                fontWeight = FontWeight.SemiBold
                            ),
                            color = Color.White
                        )
                    }
                }
            }

            // Top-Right Circle Checkbox (Direct 1-tap select)
            Box(
                modifier = Modifier
                    .padding(top = 6.dp, end = 6.dp)
                    .size(24.dp)
                    .align(Alignment.TopEnd)
                    .clip(CircleShape)
                    .clickable { onLongClick() }
                    .padding(4.dp)
                    .clip(CircleShape)
                    .background(if (isSelected) GoldAccent else Color.Transparent)
                    .border(
                        1.5.dp,
                        if (isSelected) GoldAccent else Color(0x408CA0B8),
                        CircleShape
                    ),
                contentAlignment = Alignment.Center
            ) {
                if (isSelected) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = null,
                        tint = CanvasDeepNavy,
                        modifier = Modifier.size(10.dp)
                    )
                }
            }

            // Bottom Filename Text (for non-folder cards)
            if (!item.isFolder) {
                Text(
                    text = item.name,
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontSize = 10.sp,
                        fontWeight = if (isSync) FontWeight.SemiBold else FontWeight.Normal
                    ),
                    color = if (isSync) GoldAccent else TextPrimaryDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 6.dp, vertical = 6.dp)
                        .align(Alignment.BottomStart)
                )
            }
        }
    }
}

fun formatFileSize(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    val digitGroups = (Math.log10(bytes.toDouble()) / Math.log10(1024.0)).toInt().coerceIn(0, units.size - 1)
    val value = bytes / Math.pow(1024.0, digitGroups.toDouble())
    return String.format(java.util.Locale.US, "%.1f %s", value, units[digitGroups])
}

