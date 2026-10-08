package com.autogram.app.features.cloud.preview.controls

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.autogram.app.R

internal data class PreviewTool(
    val id: String,
    val label: String,
    val checked: Boolean? = null,
    val enabled: Boolean = true,
    val children: List<PreviewTool> = emptyList(),
    val action: () -> Unit = {}
)

/** Only the current viewer can publish actions; obsolete disposal cannot clear its successor. */
internal class PreviewToolsRegistry {
    private var owner: Any? = null
    var tools by mutableStateOf<List<PreviewTool>>(emptyList()); private set
    var navigationLocked by mutableStateOf(false); private set
    fun publish(identity: Any, entries: List<PreviewTool>, locked: Boolean) {
        owner = identity
        if (tools !== entries) tools = entries
        navigationLocked = locked
    }
    fun clear(identity: Any) {
        if (owner === identity) { owner = null; tools = emptyList(); navigationLocked = false }
    }
}

internal val LocalPreviewTools = staticCompositionLocalOf<PreviewToolsRegistry?> { null }
internal val LocalPreviewNavigation = staticCompositionLocalOf<(Int) -> Boolean> { { false } }

@Composable
internal fun PublishPreviewTools(tools: List<PreviewTool>, locked: Boolean = false) {
    val registry = LocalPreviewTools.current ?: return
    val owner = remember { Any() }
    DisposableEffect(registry, owner) { onDispose { registry.clear(owner) } }
    SideEffect { registry.publish(owner, tools, locked) }
}

@Composable
internal fun PreviewToolMenuItems(tools: List<PreviewTool>, onClose: () -> Unit, onGroup: (String) -> Unit) {
    tools.forEach { tool ->
        DropdownMenuItem(text = { Text(tool.label) }, enabled = tool.enabled,
            modifier = Modifier.heightIn(min = 48.dp).semantics { selected = tool.checked == true },
            leadingIcon = if (tool.checked == true) { { Icon(Icons.Default.Check, null) } } else null,
            trailingIcon = if (tool.children.isNotEmpty()) { { Icon(Icons.Default.ChevronRight, null) } } else null,
            onClick = { onClose(); if (tool.children.isNotEmpty()) onGroup(tool.id) else tool.action() })
    }
}

@Composable
internal fun PreviewToolDialog(tool: PreviewTool, onDismiss: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text(tool.label) }, text = {
        androidx.compose.foundation.lazy.LazyColumn {
            items(tool.children.size) { index ->
                val choice = tool.children[index]
                TextButton(enabled = choice.enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .semantics { selected = choice.checked == true }, onClick = { choice.action(); onDismiss() }) {
                    if (choice.checked == true) Icon(Icons.Default.Check, null)
                    Text(choice.label, Modifier.weight(1f))
                }
            }
        }
    }, confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.native_close)) } })
}

/** Only standalone viewers need their own overflow; the Drive dialog always supplies the shared one. */
@Composable
internal fun StandalonePreviewTools(tools: List<PreviewTool>, modifier: Modifier = Modifier) {
    if (LocalPreviewTools.current != null) return
    var open by remember { mutableStateOf(false) }
    var groupId by remember { mutableStateOf<String?>(null) }
    Box(modifier) {
        IconButton(onClick = { open = true }, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Default.MoreVert, stringResource(R.string.clean_gallery_actions))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            PreviewToolMenuItems(tools, { open = false }, { groupId = it })
        }
    }
    tools.firstOrNull { it.id == groupId }?.let { PreviewToolDialog(it) { groupId = null } }
}
