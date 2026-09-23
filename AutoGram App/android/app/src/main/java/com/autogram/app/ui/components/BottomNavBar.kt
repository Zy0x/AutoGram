package com.autogram.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
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

    Box(modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 12.dp, vertical = 10.dp)) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(26.dp)),
            shape = RoundedCornerShape(26.dp),
            color = SurfaceDock.copy(alpha = 0.97f),
            border = BorderStroke(1.dp, Color(0x2AFFFFFF)),
            shadowElevation = 18.dp
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(6.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Screen.primaryItems.forEach { screen ->
                    val isSelected = when {
                        currentRoute == screen.route -> true
                        currentRoute !in Screen.primaryItems.map { it.route } && screen is Screen.Tools -> true
                        else -> false
                    }
                    Surface(
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 64.dp)
                            .clip(RoundedCornerShape(20.dp))
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = rememberRipple(bounded = true, color = NeonCyan)
                            ) {
                                navigatePrimary(navController, screen.route, currentRoute)
                            },
                        shape = RoundedCornerShape(20.dp),
                        color = if (isSelected) NeonCyan.copy(alpha = 0.14f) else Color.Transparent,
                        border = if (isSelected) BorderStroke(1.dp, NeonCyan.copy(alpha = 0.28f)) else null
                    ) {
                        Column(
                            modifier = Modifier.fillMaxSize(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center
                        ) {
                            Icon(
                                imageVector = screen.icon,
                                contentDescription = stringResource(screen.titleRes),
                                tint = if (isSelected) NeonCyan else TextSecondaryDark,
                                modifier = Modifier.size(21.dp)
                            )
                            Spacer(Modifier.height(3.dp))
                            Text(
                                text = stringResource(screen.titleRes),
                                color = if (isSelected) TextPrimaryDark else TextSecondaryDark,
                                style = MaterialTheme.typography.labelSmall,
                                maxLines = 2
                            )
                        }
                    }
                }
            }
        }
    }
}
