package com.autogram.app.ui.automation

import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramGlassCard
import com.autogram.app.ui.components.AutoGramSurface

data class AutomationRule(
    val id: String,
    val name: String,
    val triggerType: String,
    val triggerLabelRes: Int,
    val actionType: String,
    val actionLabelRes: Int,
    val isEnabled: Boolean,
    val lastTriggeredMs: Long
)

@Composable
fun AutomationScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current

    var ruleNameInput by remember { mutableStateOf("") }
    var selectedTrigger by remember { mutableStateOf("1H") }
    var selectedAction by remember { mutableStateOf("SYNC") }

    var rulesList by remember {
        mutableStateOf(
            listOf(
                AutomationRule(
                    id = "rule_1",
                    name = "Auto-Sync Kamera ke Cloud",
                    triggerType = "1H",
                    triggerLabelRes = R.string.automation_trigger_1h,
                    actionType = "SYNC",
                    actionLabelRes = R.string.automation_action_sync,
                    isEnabled = true,
                    lastTriggeredMs = System.currentTimeMillis() - 1_800_000
                ),
                AutomationRule(
                    id = "rule_2",
                    name = "Mirror Saluran Berita (Clean-Copy)",
                    triggerType = "ON_MSG",
                    triggerLabelRes = R.string.automation_trigger_on_message,
                    actionType = "FORWARD",
                    actionLabelRes = R.string.automation_action_forward,
                    isEnabled = true,
                    lastTriggeredMs = System.currentTimeMillis() - 300_000
                ),
                AutomationRule(
                    id = "rule_3",
                    name = "Backup Harian Database SQLite",
                    triggerType = "DAILY",
                    triggerLabelRes = R.string.automation_trigger_daily,
                    actionType = "BACKUP",
                    actionLabelRes = R.string.automation_action_backup,
                    isEnabled = false,
                    lastTriggeredMs = 0L
                )
            )
        )
    }

    val triggers = listOf(
        "15M" to R.string.automation_trigger_15m,
        "1H" to R.string.automation_trigger_1h,
        "6H" to R.string.automation_trigger_6h,
        "DAILY" to R.string.automation_trigger_daily,
        "ON_MSG" to R.string.automation_trigger_on_message
    )

    val actions = listOf(
        "SYNC" to R.string.automation_action_sync,
        "FORWARD" to R.string.automation_action_forward,
        "BACKUP" to R.string.automation_action_backup
    )

    AutoGramSurface(modifier = modifier) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding(),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 120.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header
            item {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        text = stringResource(R.string.automation_title),
                        style = MaterialTheme.typography.headlineMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 24.sp,
                            letterSpacing = (-0.5).sp
                        ),
                        color = TextPrimaryDark
                    )
                    Text(
                        text = stringResource(R.string.automation_subtitle),
                        style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                        color = TextSecondaryDark
                    )
                }
            }

            // Create New Rule Card
            item {
                AutoGramGlassCard(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp),
                    borderColor = BorderHairline,
                    containerColor = SurfaceDeep
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        Text(
                            text = stringResource(R.string.automation_add_rule),
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                            color = TextPrimaryDark
                        )

                        // Name input
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                text = stringResource(R.string.automation_rule_name_label),
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                                color = TextSecondaryDark
                            )
                            OutlinedTextField(
                                value = ruleNameInput,
                                onValueChange = { ruleNameInput = it },
                                placeholder = { Text(stringResource(R.string.automation_rule_name_hint), fontSize = 12.sp) },
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true
                            )
                        }

                        // Trigger Chips
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                text = stringResource(R.string.automation_trigger_label),
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                                color = TextSecondaryDark
                            )
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                                items(triggers) { (trigKey, labelRes) ->
                                    val isSelected = selectedTrigger == trigKey
                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = if (isSelected) SoftViolet.copy(alpha = 0.25f) else SurfaceElevatedDark,
                                        border = BorderStroke(1.dp, if (isSelected) SoftViolet else BorderHairline),
                                        modifier = Modifier.clickable { selectedTrigger = trigKey }
                                    ) {
                                        Text(
                                            text = stringResource(labelRes),
                                            style = MaterialTheme.typography.labelSmall.copy(
                                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                                fontSize = 11.sp
                                            ),
                                            color = if (isSelected) SoftViolet else TextSecondaryDark,
                                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                                        )
                                    }
                                }
                            }
                        }

                        // Action Chips
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                text = stringResource(R.string.automation_action_label),
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                                color = TextSecondaryDark
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                                actions.forEach { (actKey, labelRes) ->
                                    val isSelected = selectedAction == actKey
                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = if (isSelected) MutedIceCyan.copy(alpha = 0.2f) else SurfaceElevatedDark,
                                        border = BorderStroke(1.dp, if (isSelected) MutedIceCyan else BorderHairline),
                                        modifier = Modifier.weight(1f).clickable { selectedAction = actKey }
                                    ) {
                                        Box(modifier = Modifier.padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                                            Text(
                                                text = stringResource(labelRes),
                                                style = MaterialTheme.typography.labelSmall.copy(
                                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                                    fontSize = 10.sp
                                                ),
                                                color = if (isSelected) MutedIceCyan else TextSecondaryDark,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                        }
                                    }
                                }
                            }
                        }

                        // Save Rule Button
                        Button(
                            onClick = {
                                val name = if (ruleNameInput.isBlank()) "Aturan Otomasi Baru" else ruleNameInput
                                val triggerRes = triggers.first { it.first == selectedTrigger }.second
                                val actionRes = actions.first { it.first == selectedAction }.second
                                val newRule = AutomationRule(
                                    id = "rule_${System.currentTimeMillis()}",
                                    name = name,
                                    triggerType = selectedTrigger,
                                    triggerLabelRes = triggerRes,
                                    actionType = selectedAction,
                                    actionLabelRes = actionRes,
                                    isEnabled = true,
                                    lastTriggeredMs = 0L
                                )
                                rulesList = listOf(newRule) + rulesList
                                Toast.makeText(context, context.getString(R.string.automation_saved_success), Toast.LENGTH_SHORT).show()
                                ruleNameInput = ""
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = SoftViolet, contentColor = Color.White),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 44.dp)
                        ) {
                            Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.automation_action_save), fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            // Rules List Header
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Daftar Aturan Otomasi",
                        style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.Bold),
                        color = TextPrimaryDark
                    )
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = SoftViolet.copy(alpha = 0.15f)
                    ) {
                        Text(
                            text = "${rulesList.count { it.isEnabled }} aktif",
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                            style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold, color = SoftViolet)
                        )
                    }
                }
            }

            if (rulesList.isEmpty()) {
                item {
                    AutoGramGlassCard(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = stringResource(R.string.automation_empty),
                            style = MaterialTheme.typography.bodySmall,
                            color = TextMutedDark
                        )
                    }
                }
            } else {
                items(rulesList, key = { it.id }) { rule ->
                    AutomationRuleCard(
                        rule = rule,
                        onToggle = {
                            rulesList = rulesList.map {
                                if (it.id == rule.id) it.copy(isEnabled = !it.isEnabled) else it
                            }
                        },
                        onDelete = {
                            rulesList = rulesList.filter { it.id != rule.id }
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun AutomationRuleCard(
    rule: AutomationRule,
    onToggle: () -> Unit,
    onDelete: () -> Unit
) {
    AutoGramGlassCard(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        borderColor = BorderHairline,
        containerColor = SurfaceDeep
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = rule.name,
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                    color = if (rule.isEnabled) TextPrimaryDark else TextMutedDark,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = RoundedCornerShape(4.dp), color = SoftViolet.copy(alpha = 0.15f)) {
                        Text(
                            text = stringResource(rule.triggerLabelRes),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.sp, color = SoftViolet),
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                    Text("➔", fontSize = 10.sp, color = TextMutedDark)
                    Surface(shape = RoundedCornerShape(4.dp), color = MutedIceCyan.copy(alpha = 0.15f)) {
                        Text(
                            text = stringResource(rule.actionLabelRes),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 10.sp, color = MutedIceCyan),
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                }
            }

            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Switch(checked = rule.isEnabled, onCheckedChange = { onToggle() })
                IconButton(onClick = onDelete, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Default.Delete, contentDescription = null, tint = SoftCoral, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}
