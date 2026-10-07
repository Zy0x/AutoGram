package com.autogram.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.*
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.navigation.Screen
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.ui.components.BottomNavBar
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class BottomNavigationLayoutTest {
    @get:Rule val compose = createComposeRule()

    private fun checkDock(width: Int, fontScale: Float) {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, fontScale)) {
                AutoGramTheme {
                    val controller = rememberNavController()
                    Column(Modifier.width(width.dp).height(580.dp)) {
                        NavHost(controller, startDestination = Screen.Home.route, modifier = Modifier.weight(1f)) {
                            Screen.primaryItems.forEach { screen ->
                                composable(screen.route) { Text("route:${screen.route}") }
                            }
                        }
                        BottomNavBar(controller)
                    }
                }
            }
        }
        Screen.primaryItems.forEach { screen ->
            val item = compose.onNode(hasText(context.getString(screen.titleRes)) and hasClickAction())
            item.assertHeightIsAtLeast(48.dp).assertWidthIsAtLeast(48.dp)
            val bounds = item.getUnclippedBoundsInRoot()
            assertTrue("Dock item expanded at width=$width fontScale=$fontScale",
                bounds.bottom - bounds.top <= 112.dp)
            item.performTouchInput { click() }
            compose.onNodeWithText("route:${screen.route}").assertIsDisplayed()
        }
    }

    @Test fun compactPhoneRetainsPageAndTouchTargets() = checkDock(360, 1f)
    @Test fun enlargedTextDoesNotExpandDockAcrossPage() = checkDock(360, 2f)
    @Test fun regularPhoneRetainsPageAndTouchTargets() = checkDock(410, 1f)
}
