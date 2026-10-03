package com.autogram.app.features.gate.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.features.auth.AuthAccount
import com.autogram.app.theme.*

/**
 * Gate screen showing saved Telegram accounts from device storage.
 */
@Composable
fun SavedAccountsGate(
    accounts: List<AuthAccount>,
    onSelectAccount: (AuthAccount) -> Unit,
    onAddNewAccount: () -> Unit,
    modifier: Modifier = Modifier,
    isBusy: Boolean = false
) {
    GateBackground(modifier = modifier) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp)
                .safeDrawingPadding()
        ) {
            Spacer(Modifier.height(28.dp))

            GateBrandHeader(
                title = stringResource(R.string.gate_saved_title),
                subtitle = stringResource(R.string.gate_saved_subtitle)
            )

            Spacer(Modifier.height(24.dp))

            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                items(accounts, key = { it.id }) { account ->
                    SavedAccountCard(
                        account = account,
                        onSelect = { onSelectAccount(account) },
                        isBusy = isBusy
                    )
                }

                item {
                    Spacer(Modifier.height(6.dp))
                    GateOutlinedButton(
                        text = stringResource(R.string.gate_saved_add_new),
                        onClick = onAddNewAccount,
                        icon = Icons.Default.Add,
                        enabled = !isBusy
                    )
                }
            }

            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun SavedAccountCard(
    account: AuthAccount,
    onSelect: () -> Unit,
    isBusy: Boolean,
    modifier: Modifier = Modifier
) {
    GateFrostedCard(
        modifier = modifier.fillMaxWidth(),
        borderColor = if (account.active && account.verified) GoldAccent.copy(alpha = 0.5f) else BorderHairline,
        containerColor = SurfaceGlass
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // User Avatar with gradient
            Surface(
                shape = CircleShape,
                color = Color.Transparent,
                modifier = Modifier
                    .size(46.dp)
                    .clip(CircleShape)
                    .background(Brush.linearGradient(listOf(ElectricBlue, MutedIceCyan)))
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Default.Person,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(26.dp)
                    )
                }
            }

            Spacer(Modifier.width(14.dp))

            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = account.displayName.ifBlank { "Telegram User" },
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp
                        ),
                        color = TextPrimaryDark
                    )

                    if (account.active && account.verified) {
                        Surface(
                            shape = CircleShape,
                            color = DustySage.copy(alpha = 0.15f),
                            border = BorderStroke(0.5.dp, DustySage.copy(alpha = 0.4f))
                        ) {
                            Text(
                                text = stringResource(R.string.gate_saved_active),
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 10.sp
                                ),
                                color = DustySage,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }
                }

                if (!account.username.isNullOrBlank()) {
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = "@${account.username}",
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = MutedIceCyan
                    )
                }
            }
        }

        Spacer(Modifier.height(14.dp))

        GateGoldButton(
            text = stringResource(R.string.gate_saved_verify_enter),
            onClick = onSelect,
            enabled = !isBusy,
            loading = isBusy
        )
    }
}
