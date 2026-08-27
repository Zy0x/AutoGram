package com.autogram.app.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.ripple.rememberRipple
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
            .padding(horizontal = 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .height(68.dp)
                .clip(RoundedCornerShape(24.dp)),
            shape = RoundedCornerShape(24.dp),
            color = SurfaceDock,
            border = BorderStroke(1.dp, GlassBorderBrush),
            shadowElevation = 16.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 6.dp),
                horizontalArrangement = Arrangement.SpaceAround,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Screen.items.forEach { screen ->
                    val isSelected = currentRoute == screen.route
                    
                    val animatedIconColor by animateColorAsState(
                        targetValue = if (isSelected) NeonCyan else TextMutedDark,
                        animationSpec = tween(durationMillis = 200),
                        label = "iconColor"
                    )
                    
                    val animatedTextColor by animateColorAsState(
                        targetValue = if (isSelected) TextPrimaryDark else TextMutedDark,
                        animationSpec = tween(durationMillis = 200),
                        label = "textColor"
                    )

                    val pillBackground = if (isSelected) {
                        NeonCyan.copy(alpha = 0.15f)
                    } else {
                        Color.Transparent
                    }

                    Column(
                        modifier = Modifier
                            .clip(RoundedCornerShape(16.dp))
                            .background(pillBackground)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = rememberRipple(bounded = true, color = NeonCyan)
                            ) {
                                if (currentRoute != screen.route) {
                                    navigatePrimary(navController, screen.route, currentRoute)
                                }
                            }
                            .padding(horizontal = 10.dp, vertical = 6.dp)
                            .defaultMinSize(minWidth = 52.dp, minHeight = 48.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = screen.icon,
                                contentDescription = stringResource(screen.titleRes),
                                tint = animatedIconColor,
                                modifier = Modifier.size(22.dp)
                            )
                        }
                        Spacer(Modifier.height(3.dp))
                        Text(
                            text = stringResource(screen.titleRes),
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontSize = 10.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                            ),
                            color = animatedTextColor,
                            maxLines = 1
                        )
                    }
                }
            }
        }
    }
}
