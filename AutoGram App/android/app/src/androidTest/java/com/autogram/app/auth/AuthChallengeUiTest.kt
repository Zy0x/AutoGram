package com.autogram.app.auth

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.autogram.app.R
import com.autogram.app.features.auth.*
import com.autogram.app.theme.AutoGramTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Controlled UI states only; production never receives these fixture challenges. */
class AuthChallengeUiTest {
    @get:Rule val compose = createComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun text(id: Int) = context.getString(id)
    private fun challenge(phase: LoginPhase) = LoginChallenge("ui-fixture", phase, null, 0, 0, false, null, null)

    @Test fun resendIsUnavailableUntilServerDeadline() {
        val code = challenge(LoginPhase.CODE).copy(canResend = true, resendAt = 200)
        compose.setContent { AutoGramTheme {
            AuthChallengeContent(code, true, 100_000, {}, {}, {})
        } }
        compose.onNodeWithText(text(R.string.auth_resend)).assertIsNotEnabled()
        compose.onNodeWithText(text(R.string.auth_verify)).assertIsNotEnabled()
    }

    @Test fun expiredQrIsRemovedFromTheScreen() {
        val qr = challenge(LoginPhase.QR).copy(qrUrl = "tg://login?token=fixture", expiresAt = 100)
        compose.setContent { AutoGramTheme {
            AuthChallengeContent(qr, true, 101_000, {}, {}, {})
        } }
        compose.onNodeWithContentDescription(text(R.string.auth_qr_description)).assertDoesNotExist()
        compose.onNodeWithText(text(R.string.auth_qr_refreshing)).assertIsDisplayed()
    }

    @Test fun passwordWhitespaceIsPreservedAndFieldIsClearedAfterSubmission() {
        var submitted: String? = null
        compose.setContent { AutoGramTheme {
            AuthChallengeContent(challenge(LoginPhase.PASSWORD), true, 0, { submitted = it }, {}, {})
        } }
        compose.onNode(hasSetTextAction()).performTextInput(" password ")
        compose.onNodeWithText(text(R.string.auth_verify)).performClick()
        compose.runOnIdle { assertEquals(" password ", submitted) }
        compose.onNodeWithText(text(R.string.auth_verify)).assertIsNotEnabled()
    }
}
