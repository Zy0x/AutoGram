package com.autogram.app.ui.drive.gallery

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.features.cloud.*
import com.autogram.app.theme.*

/**
 * Instagram Story-style horizontal rail of Telegram Drives & Channels.
 * Active drive features a glowing gradient ring; clean, compact labels below.
 */
@Composable
fun DriveStories(
    state: CloudState,
    onLoad: (Boolean) -> Unit,
    onChoose: (CloudLocation) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = stringResource(R.string.ui2_drive_header),
                style = MaterialTheme.typography.titleSmall.copy(
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 0.2.sp
                ),
                color = TextPrimaryDark,
                modifier = Modifier.weight(1f)
            )
            IconButton(
                onClick = { onLoad(false) },
                enabled = state.scope.accountId.isNotBlank() && !state.loadingLocations,
                modifier = Modifier.size(48.dp)
            ) {
                Icon(
                    imageVector = Icons.Default.Refresh,
                    contentDescription = stringResource(R.string.cloud_refresh),
                    tint = if (!state.loadingLocations) MutedIceCyan else TextSecondaryDark,
                    modifier = Modifier.size(18.dp)
                )
            }
        }

        LazyRow(
            modifier = Modifier.testTag("drive-stories"),
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item(key = "saved") {
                StoryDrive(
                    location = CloudLocation("me", stringResource(R.string.cloud_saved_messages), "self"),
                    state = state,
                    onChoose = onChoose
                )
            }
            items(
                state.locations.filter { it.id != "me" && it.kind != "self" },
                key = { "location:${it.id}" }
            ) {
                StoryDrive(location = it, state = state, onChoose = onChoose)
            }
            if (state.locationsCursor != null) {
                item(key = "more") {
                    Column(
                        modifier = Modifier.width(76.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Surface(
                            onClick = { onLoad(true) },
                            enabled = !state.loadingLocations,
                            shape = CircleShape,
                            color = SurfaceGlass,
                            border = BorderStroke(1.dp, BorderHairline),
                            modifier = Modifier.size(62.dp)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    imageVector = Icons.Default.MoreHoriz,
                                    contentDescription = stringResource(R.string.clean_drive_more),
                                    tint = MutedIceCyan,
                                    modifier = Modifier.size(24.dp)
                                )
                            }
                        }
                        Spacer(Modifier.height(6.dp))
                        Text(
                            text = stringResource(R.string.ui2_more),
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                            color = TextSecondaryDark,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            textAlign = TextAlign.Center
                        )
                    }
                }
            }
        }

        if (state.loadingLocations) {
            LinearProgressIndicator(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                color = MutedIceCyan
            )
        }
        state.locationsError?.let { code ->
            Text(
                text = stringResource(cloudErrorLabel(code)),
                modifier = Modifier.padding(horizontal = 20.dp),
                color = SoftCoral,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun StoryDrive(
    location: CloudLocation,
    state: CloudState,
    onChoose: (CloudLocation) -> Unit
) {
    val active = state.scope.peerId == location.id || (location.kind == "self" && state.scope.peerId == "me")
    val title = location.title.ifBlank { location.id }
    val initial = title.firstOrNull()?.uppercaseChar()?.toString() ?: "D"

    Surface(
        onClick = { onChoose(location) },
        enabled = state.scope.accountId.isNotBlank(),
        color = Color.Transparent,
        modifier = Modifier
            .width(76.dp)
            .semantics { selected = active }
    ) {
        Column(
            modifier = Modifier.padding(vertical = 2.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Instagram Story ring outer container
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .clip(CircleShape)
                    .then(
                        if (active) {
                            Modifier
                                .background(ChampagneToCyanBrush)
                                .padding(2.5.dp)
                        } else {
                            Modifier
                                .border(1.dp, BorderHairline, CircleShape)
                                .padding(1.dp)
                        }
                    )
                    .clip(CircleShape)
                    .background(CanvasDeepNavy),
                contentAlignment = Alignment.Center
            ) {
                // Inner Avatar
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(2.dp)
                        .clip(CircleShape)
                        .background(
                            if (active) {
                                Brush.linearGradient(
                                    listOf(MutedIceCyan.copy(alpha = 0.35f), SurfaceDeep)
                                )
                            } else {
                                Brush.linearGradient(
                                    listOf(SurfaceGlassSoft, SurfaceDeep)
                                )
                            }
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    if (location.kind == "self") {
                        Icon(
                            imageVector = Icons.Default.Cloud,
                            contentDescription = null,
                            tint = if (active) MutedIceCyan else GoldAccent,
                            modifier = Modifier.size(24.dp)
                        )
                    } else {
                        Text(
                            text = initial,
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 18.sp
                            ),
                            color = if (active) TextPrimaryDark else TextSecondaryDark
                        )
                    }
                }
            }

            Spacer(Modifier.height(6.dp))

            Text(
                text = if (location.kind == "self") stringResource(R.string.ui2_saved) else title,
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 11.sp,
                    fontWeight = if (active) FontWeight.Bold else FontWeight.Medium
                ),
                color = if (active) MutedIceCyan else TextSecondaryDark,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}
