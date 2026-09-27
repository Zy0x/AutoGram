package com.autogram.app.features.auth

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.WindowManager
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.ui.components.AutoGramSurface
import kotlinx.coroutines.delay

@Composable
fun AuthAccountsScreen(viewModel: AuthViewModel, configureOnly: Boolean = false) {
    val state by viewModel.state.collectAsState()
    val controller = viewModel.controller
    val activity = LocalContext.current.authActivity()
    DisposableEffect(activity) {
        val window = activity?.window
        val wasSecure = window?.attributes?.flags?.and(WindowManager.LayoutParams.FLAG_SECURE) != 0
        window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose {
            controller.cancel()
            if (!wasSecure) window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
    AuthAccountsContent(state, controller, configureOnly)
}

private fun Context.authActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> if (baseContext !== this) baseContext.authActivity() else null
    else -> null
}

@Composable
internal fun AuthAccountsContent(state: AuthUiState, controller: AuthController, configureOnly: Boolean = false) {
    var editingApi by remember { mutableStateOf(configureOnly) }
    var phone by remember { mutableStateOf("") }
    var logoutTarget by remember { mutableStateOf<AuthAccount?>(null) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = System.currentTimeMillis() } }
    val allowed = !state.busy && now >= state.retryAt
    AutoGramSurface {
        LazyColumn(Modifier.fillMaxSize().safeDrawingPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item { Text(stringResource(R.string.auth_title), style = MaterialTheme.typography.headlineMedium) }
            item { Text(stringResource(R.string.auth_security)) }
            if (state.busy) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            if (state.errorCode != null) item { Text(stringResource(authErrorLabel(state.errorCode)), color = MaterialTheme.colorScheme.error) }
            if (state.retryAt > now) item {
                Text(stringResource(R.string.auth_wait_seconds, (state.retryAt - now + 999) / 1000))
            }
            if (!state.configured || editingApi) item {
                ApiCredentialForm(allowed && state.attemptId == null, state.configured, onSave = { id, hash ->
                    controller.configure(id, hash)
                    editingApi = false
                })
            }
            if (state.configured && !editingApi && state.attemptId == null) item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(stringResource(R.string.auth_api_saved))
                    OutlinedTextField(phone, { phone = it }, label = { Text(stringResource(R.string.auth_phone)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = allowed)
                    Button(onClick = { controller.begin(phone.trim()); phone = "" },
                        enabled = allowed && phone.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.auth_send_code))
                    }
                    OutlinedButton(onClick = { controller.begin(null) }, enabled = allowed, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.auth_login_qr))
                    }
                    TextButton(onClick = { editingApi = true }, enabled = allowed) { Text(stringResource(R.string.auth_edit_api)) }
                }
            }
            state.challenge?.let { challenge -> item {
                key(challenge.attemptId, challenge.phase) {
                    AuthChallengeContent(challenge, allowed, now, controller::submit, controller::resend, controller::retryChallenge)
                }
            } }
            if (state.attemptId != null) item {
                OutlinedButton(onClick = controller::cancel, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.auth_cancel))
                }
            }
            item {
                OutlinedButton(onClick = { controller.refresh() }, enabled = allowed && state.attemptId == null) {
                    Text(stringResource(R.string.auth_refresh))
                }
            }
            if (state.accounts.isEmpty()) item { Text(stringResource(R.string.auth_no_accounts)) }
            items(state.accounts, key = { it.id }) { account ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(account.displayName, style = MaterialTheme.typography.titleMedium)
                        account.username?.let { Text(it) }
                        Text(stringResource(if (account.active && account.verified) R.string.auth_active else R.string.auth_verify_account))
                        Button(onClick = { controller.select(account.id) }, enabled = allowed && state.attemptId == null) {
                            Text(stringResource(R.string.auth_select))
                        }
                        TextButton(onClick = { logoutTarget = account }, enabled = allowed && state.attemptId == null) {
                            Text(stringResource(R.string.auth_logout))
                        }
                    }
                }
            }
        }
    }
    logoutTarget?.let { account ->
        AlertDialog(onDismissRequest = { logoutTarget = null },
            title = { Text(stringResource(R.string.auth_logout)) },
            text = { Text(stringResource(R.string.auth_logout_confirm, account.displayName)) },
            confirmButton = { TextButton(onClick = { controller.logout(account.id); logoutTarget = null }) {
                Text(stringResource(R.string.auth_logout))
            } }, dismissButton = { TextButton(onClick = { logoutTarget = null }) { Text(stringResource(R.string.auth_cancel)) } })
    }
}

@Composable
private fun ApiCredentialForm(enabled: Boolean, configured: Boolean, onSave: (Int, String) -> Unit) {
    var apiId by remember { mutableStateOf("") }
    var apiHash by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(R.string.auth_api_instructions))
        if (configured) Text(stringResource(R.string.auth_api_saved))
        OutlinedTextField(apiId, { apiId = it }, label = { Text(stringResource(R.string.auth_api_id)) },
            enabled = enabled, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        OutlinedTextField(apiHash, { apiHash = it }, label = { Text(stringResource(R.string.auth_api_hash)) },
            enabled = enabled, singleLine = true, visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password))
        Button(onClick = {
            val id = apiId.toIntOrNull() ?: return@Button
            onSave(id, apiHash.trim())
            apiHash = ""
        }, enabled = enabled && (apiId.toIntOrNull() ?: 0) > 0 && apiHash.trim().matches(Regex("[0-9a-fA-F]{32}"))) {
            Text(stringResource(R.string.auth_save_api))
        }
    }
}
