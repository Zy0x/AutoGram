package com.autogram.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.compose.currentBackStackEntryAsState
import com.autogram.app.navigation.Screen
import com.autogram.app.theme.*

internal fun navigatePrimary(navController: NavController, route: String, currentRoute: String?) {
    if (currentRoute == route) return
    navController.navigate(route) {
        popUpTo(Screen.Drive.route) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

@Composable
fun AutoGramNavigationRail(navController: NavController) {
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route

    Surface(
        modifier = Modifier.width(108.dp).fillMaxHeight(),
        color = SurfaceGlassStrong,
        border = BorderStroke(1.dp, GlassBorderBrush)
    ) {
        NavigationRail(
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 20.dp),
            containerColor = androidx.compose.ui.graphics.Color.Transparent,
            header = {
                AutoGramBrand(compact = true)
                HorizontalDivider(
                    modifier = Modifier.padding(vertical = 16.dp),
                    color = BorderHairline
                )
            }
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Screen.items.forEach { screen ->
                    val selected = currentRoute == screen.route
                    NavigationRailItem(
                        selected = selected,
                        onClick = { navigatePrimary(navController, screen.route, currentRoute) },
                        icon = {
                            Icon(screen.icon, contentDescription = stringResource(screen.titleRes))
                        },
                        label = {
                            Text(
                                stringResource(screen.titleRes),
                                style = MaterialTheme.typography.labelSmall
                            )
                        },
                        alwaysShowLabel = true,
                        colors = NavigationRailItemDefaults.colors(
                            selectedIconColor = NeonCyan,
                            selectedTextColor = NeonCyan,
                            indicatorColor = NeonCyan.copy(alpha = 0.15f),
                            unselectedIconColor = TextMutedDark,
                            unselectedTextColor = TextMutedDark
                        )
                    )
                }
            }
            Spacer(Modifier.weight(1f))
        }
    }
}
