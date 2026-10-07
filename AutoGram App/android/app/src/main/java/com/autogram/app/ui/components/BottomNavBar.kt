package com.autogram.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.compose.currentBackStackEntryAsState
import com.autogram.app.navigation.Screen
import com.autogram.app.theme.*

/** Placed after content in a Column, never above it as a touch-catching overlay. */
@Composable
fun BottomNavBar(navController: NavController) {
    val entry by navController.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    Surface(color = CanvasDeepNavy, modifier = Modifier.fillMaxWidth().testTag("primary-navigation")) {
        Column(Modifier.navigationBarsPadding()) {
            HorizontalDivider(color = BorderHairline)
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp)) {
                Screen.primaryItems.forEach { screen ->
                    val selected = route == screen.route ||
                        (route !in Screen.primaryItems.map { it.route } && screen == Screen.Tools)
                    Column(
                        Modifier.weight(1f).heightIn(min = 56.dp).clip(RoundedCornerShape(12.dp))
                            .selectable(selected = selected, role = Role.Tab,
                                onClick = { navigatePrimary(navController, screen.route, route) })
                            .padding(vertical = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Box(Modifier.clip(RoundedCornerShape(10.dp))
                            .background(if (selected) MutedIceCyan.copy(alpha = 0.14f) else Color.Transparent)
                            .padding(horizontal = 14.dp, vertical = 4.dp)) {
                            Icon(screen.icon, null, Modifier.size(22.dp),
                                tint = if (selected) MutedIceCyan else TextSecondaryDark)
                        }
                        Text(stringResource(screen.titleRes),
                            color = if (selected) TextPrimaryDark else TextSecondaryDark,
                            style = MaterialTheme.typography.labelSmall, maxLines = 2,
                            textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}
