package com.autogram.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.rememberNavController
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.ui.components.BottomNavBar
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Isolated presentation only: no native runtime, credentials, account or file writes. */
class ReservedNavigationTest {
    @get:Rule val compose = createComposeRule()
    @Test fun contentAndDockNeverOverlapAtCompactWidthWithLargeText() {
        var tapped = false
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, 1.8f)) {
                AutoGramTheme {
                    Column(Modifier.width(320.dp).height(580.dp)) {
                        Box(Modifier.weight(1f).fillMaxWidth().testTag("page-content").clickable { tapped = true }) {
                            Text("fixture")
                        }
                        BottomNavBar(rememberNavController())
                    }
                }
            }
        }
        val page = compose.onNodeWithTag("page-content").getUnclippedBoundsInRoot()
        val dock = compose.onNodeWithTag("primary-navigation").getUnclippedBoundsInRoot()
        assertTrue("Navigation must reserve space", page.bottom <= dock.top)
        compose.onNodeWithTag("page-content").performTouchInput { click() }
        compose.runOnIdle { assertTrue(tapped) }
    }
}
