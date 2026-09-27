package com.autogram.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.test.junit4.createComposeRule
import com.autogram.app.theme.AutoGramTheme
import com.autogram.app.theme.SurfaceGlass
import com.autogram.app.ui.components.AutoGramGlassCard
import com.autogram.app.ui.components.AutoGramSurface
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ThemeContentTest {
    @get:Rule val compose = createComposeRule()

    @Test fun gradientPagesAndGlassCardsInheritReadableForeground() {
        var pageColor = Color.Unspecified
        var cardColor = Color.Unspecified
        var expected = Color.Unspecified
        compose.setContent {
            AutoGramTheme {
                val foreground = MaterialTheme.colorScheme.onBackground
                SideEffect { expected = foreground }
                AutoGramSurface {
                    Column {
                        val pageForeground = LocalContentColor.current
                        SideEffect { pageColor = pageForeground }
                        Text("page")
                        AutoGramGlassCard {
                            val cardForeground = LocalContentColor.current
                            SideEffect { cardColor = cardForeground }
                            Text("card")
                        }
                    }
                }
            }
        }
        compose.runOnIdle {
            assertEquals(expected, pageColor)
            assertEquals(expected, cardColor)
            assertTrue("Glass foreground must remain readable",
                (cardColor.luminance() + 0.05f) / (SurfaceGlass.luminance() + 0.05f) >= 4.5f)
        }
    }
}
