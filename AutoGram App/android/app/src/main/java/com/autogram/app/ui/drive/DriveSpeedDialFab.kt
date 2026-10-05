package com.autogram.app.ui.drive

import androidx.compose.animation.*
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*

@Composable
fun DriveSpeedDialFab(
    isForum: Boolean,
    onUpload: () -> Unit,
    onRemoteUpload: () -> Unit,
    onAddTopic: () -> Unit,
    modifier: Modifier = Modifier
) {
    var isExpanded by remember { mutableStateOf(false) }
    val rotationAngle by animateFloatAsState(targetValue = if (isExpanded) 45f else 0f, label = "fab_rotation")

    Box(
        modifier = modifier,
        contentAlignment = Alignment.BottomEnd
    ) {
        // Scrim backdrop when expanded
        if (isExpanded) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.5f))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null
                    ) { isExpanded = false }
            )
        }

        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(14.dp),
            modifier = Modifier.padding(end = 16.dp, bottom = 80.dp)
        ) {
            // Speed Dial Items
            AnimatedVisibility(
                visible = isExpanded,
                enter = fadeIn() + slideInVertically { it / 2 },
                exit = fadeOut() + slideOutVertically { it / 2 }
            ) {
                Column(
                    horizontalAlignment = Alignment.End,
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    // Option 1: Create Topic (if forum group)
                    if (isForum) {
                        SpeedDialActionItem(
                            icon = Icons.Default.Forum,
                            label = stringResource(R.string.drive_action_create_topic),
                            iconTint = GoldAccent,
                            onClick = {
                                isExpanded = false
                                onAddTopic()
                            }
                        )
                    }

                    // Option 2: Remote Upload from URL
                    SpeedDialActionItem(
                        icon = Icons.Default.CloudDownload,
                        label = stringResource(R.string.drive_remote_upload_title),
                        iconTint = MutedIceCyan,
                        onClick = {
                            isExpanded = false
                            onRemoteUpload()
                        }
                    )

                    // Option 3: Upload Local File
                    SpeedDialActionItem(
                        icon = Icons.Default.Upload,
                        label = stringResource(R.string.drive_action_upload),
                        iconTint = Color.White,
                        onClick = {
                            isExpanded = false
                            onUpload()
                        }
                    )
                }
            }

            // Main FAB (+)
            FloatingActionButton(
                onClick = { isExpanded = !isExpanded },
                shape = CircleShape,
                containerColor = GoldAccent,
                contentColor = Color.Black,
                elevation = FloatingActionButtonDefaults.elevation(defaultElevation = 6.dp),
                modifier = Modifier.size(56.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Add,
                    contentDescription = stringResource(R.string.drive_action_upload),
                    modifier = Modifier
                        .size(26.dp)
                        .rotate(rotationAngle)
                )
            }
        }
    }
}

@Composable
private fun SpeedDialActionItem(
    icon: ImageVector,
    label: String,
    iconTint: Color,
    onClick: () -> Unit
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Text Label Capsule
        Surface(
            onClick = onClick,
            shape = RoundedCornerShape(8.dp),
            color = SurfaceElevatedDark,
            shadowElevation = 4.dp
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 12.sp
                ),
                color = TextPrimaryDark,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
            )
        }

        // Mini FAB
        SmallFloatingActionButton(
            onClick = onClick,
            shape = CircleShape,
            containerColor = SurfaceElevatedDark,
            contentColor = iconTint,
            elevation = FloatingActionButtonDefaults.elevation(defaultElevation = 4.dp),
            modifier = Modifier.size(42.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
                modifier = Modifier.size(18.dp)
            )
        }
    }
}
