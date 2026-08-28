package com.autogram.app.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.ripple.rememberRipple
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.compose.currentBackStackEntryAsState
import com.autogram.app.navigation.Screen
import com.autogram.app.theme.*

@Composable
fun BottomNavBar(navController: NavController) {
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(bottom = 12.dp),
        contentAlignment = Alignment.BottomCenter
    ) {
        Surface(
            modifier = Modifier
                .wrapContentWidth()
                .height(52.dp)
                .clip(CircleShape),
            shape = CircleShape,
            color = Color(0xF00B1C30),
            border = BorderStroke(1.dp, Color(0x26FFFFFF)),
            shadowElevation = 20.dp
        ) {
            Row(
                modifier = Modifier
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Screen.items.forEach { screen ->
                    val isSelected = currentRoute == screen.route

                    // Icon selection matching the design in user screenshot
                    val screenIcon = when (screen) {
                        is Screen.Drive -> Icons.Default.Cloud
                        is Screen.Transfer -> Icons.Default.SwapHoriz
                        is Screen.Studio -> Icons.Default.Palette
                        is Screen.Remote -> Icons.Default.Sensors
                        is Screen.Settings -> Icons.Default.Settings
                    }

                    if (isSelected) {
                        Surface(
                            modifier = Modifier.size(38.dp),
                            shape = CircleShape,
                            color = GoldAccent.copy(alpha = 0.18f),
                            border = BorderStroke(1.dp, GoldAccent.copy(alpha = 0.35f))
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    imageVector = screenIcon,
                                    contentDescription = stringResource(screen.titleRes),
                                    tint = GoldAccent,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                    } else {
                        Box(
                            modifier = Modifier
                                .size(38.dp)
                                .clip(CircleShape)
                                .clickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = rememberRipple(bounded = true, color = GoldAccent)
                                ) {
                                    if (currentRoute != screen.route) {
                                        navigatePrimary(navController, screen.route, currentRoute)
                                    }
                                },
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = screenIcon,
                                contentDescription = stringResource(screen.titleRes),
                                tint = TextSecondaryDark,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}
