package com.autogram.app.ui.studio

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.drive.formatFileSize
import com.autogram.app.viewmodel.DriveFileItem

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun StudioMediaCard23(
    item: DriveFileItem,
    isSelected: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val isVideo = item.mimeType.startsWith("video") || item.telegramCategory.equals("video", ignoreCase = true)
    val isPhoto = item.mimeType.startsWith("image") || item.telegramCategory.equals("photo", ignoreCase = true)
    val isAudio = item.mimeType.startsWith("audio") || item.telegramCategory.equals("audio", ignoreCase = true)

    val formatBadgeText = when {
        isVideo -> if (item.size > 20_000_000) "4K UHD" else "1080p 60F"
        isPhoto -> "PHOTO RAW"
        isAudio -> "AUDIO STEM"
        else -> item.telegramCategory.uppercase()
    }

    val formatBadgeColor = when {
        isVideo -> CategoryVideo
        isPhoto -> CategoryPhoto
        isAudio -> CategoryAudio
        else -> MutedIceCyan
    }

    val border = if (isSelected) {
        BorderStroke(2.dp, GoldAccent)
    } else {
        BorderStroke(1.dp, CardNavyBorder)
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(2f / 3f)
            .clip(RoundedCornerShape(16.dp))
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            ),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) SurfaceElevatedDark else CardNavyBg
        ),
        border = border
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            // 1. Full-Bleed Media Thumbnail / Visual Backdrop
            if (!item.thumbnailUri.isNullOrBlank()) {
                AsyncImage(
                    model = item.thumbnailUri,
                    contentDescription = item.name,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop
                )
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(SurfaceDeep),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = when {
                            isVideo -> Icons.Default.Videocam
                            isPhoto -> Icons.Default.Image
                            isAudio -> Icons.Default.Audiotrack
                            else -> Icons.AutoMirrored.Filled.InsertDriveFile
                        },
                        contentDescription = null,
                        tint = formatBadgeColor.copy(alpha = 0.35f),
                        modifier = Modifier.size(54.dp)
                    )
                }
            }

            // 2. Cinematic Dark Gradient Vignette Overlay
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                Color(0x66000000),
                                Color.Transparent,
                                Color(0x99000000),
                                Color(0xFA040D1A)
                            )
                        )
                    )
            )

            // 3. Top Row: Format Pill (Left) + Selection Circle (Right)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Format / Resolution Pill
                Surface(
                    color = Color(0xCC051120),
                    shape = RoundedCornerShape(6.dp),
                    border = BorderStroke(0.5.dp, formatBadgeColor.copy(alpha = 0.5f))
                ) {
                    Text(
                        text = formatBadgeText,
                        modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = 0.3.sp
                        ),
                        color = formatBadgeColor
                    )
                }

                // 1-Tap Selection Circle Badge
                Box(
                    modifier = Modifier
                        .size(24.dp)
                        .clip(CircleShape)
                        .background(if (isSelected) GoldAccent else Color(0x55000000))
                        .border(
                            1.5.dp,
                            if (isSelected) GoldAccent else Color(0x88FFFFFF),
                            CircleShape
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    if (isSelected) {
                        Icon(
                            imageVector = Icons.Default.Check,
                            contentDescription = stringResource(R.string.drive_item_selected_accessibility),
                            tint = CanvasDeepNavy,
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }
            }

            // 4. Center Play Button for Videos
            if (isVideo && !isSelected) {
                Box(
                    modifier = Modifier
                        .size(42.dp)
                        .clip(CircleShape)
                        .background(Color(0x77000000))
                        .border(1.dp, Color(0x55FFFFFF), CircleShape)
                        .align(Alignment.Center),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.PlayArrow,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(24.dp)
                    )
                }
            }

            // 5. Bottom Info Overlay
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.BottomCenter)
                    .padding(horizontal = 10.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp)
            ) {
                Text(
                    text = item.name,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp
                    ),
                    color = Color.White,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = formatFileSize(item.size),
                        style = MaterialTheme.typography.labelSmall.copy(
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Medium
                        ),
                        color = TextSecondaryDark
                    )

                    if (isVideo) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Memory,
                                contentDescription = null,
                                tint = GoldAccent,
                                modifier = Modifier.size(11.dp)
                            )
                            Text(
                                text = "NVENC",
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontSize = 9.5.sp,
                                    fontWeight = FontWeight.Bold
                                ),
                                color = GoldAccent
                            )
                        }
                    }
                }
            }
        }
    }
}