package com.autogram.app.ui.accounts

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.R
import com.autogram.app.features.accounts.AccountSessionItem
import com.autogram.app.features.accounts.AccountsUiState
import com.autogram.app.theme.AutoGramTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class AccountsScreenTest {
    @get:Rule val compose = createComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun localizedAccountStatusAndRefreshWorkInSmallViewport() {
        var refreshes = 0
        val state = AccountsUiState(sessions = listOf(
            AccountSessionItem("header", "unverified", "grammers"),
            AccountSessionItem("Legacy", "migration_required", "telethon_migration_source")
        ))
        compose.setContent {
            AutoGramTheme {
                Box(Modifier.size(320.dp, 360.dp)) { AccountsContent(state, { refreshes++ }) }
            }
        }
        compose.onNodeWithContentDescription(context.getString(R.string.accounts_refresh)).performClick()
        assertEquals(1, refreshes)
        val label = context.getString(R.string.accounts_source_status,
            context.getString(R.string.accounts_source_legacy), context.getString(R.string.accounts_status_migration))
        compose.onNodeWithText(label).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("migration_required", substring = true).assertDoesNotExist()
        compose.onNodeWithText("telethon_migration_source", substring = true).assertDoesNotExist()
    }

    @Test fun loadingDisablesRefreshWithoutHidingLastInventory() {
        compose.setContent {
            AutoGramTheme {
                AccountsContent(AccountsUiState(isLoading = true, sessions = listOf(
                    AccountSessionItem("Last good inventory", "unverified", "grammers")
                )), {})
            }
        }
        compose.onNodeWithContentDescription(context.getString(R.string.accounts_refresh)).assertIsNotEnabled()
        compose.onNodeWithText("Last good inventory").performScrollTo().assertIsDisplayed()
    }

    @Test fun nativeFailureShowsSpecificMessageAndRetry() {
        var refreshes = 0
        compose.setContent {
            AutoGramTheme { AccountsContent(AccountsUiState(errorCode = "native_runtime_unavailable"), { refreshes++ }) }
        }
        compose.onNodeWithText(context.getString(R.string.accounts_runtime_unavailable)).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(context.getString(R.string.drive_action_refresh)).performScrollTo().performClick()
        assertEquals(1, refreshes)
    }
}
