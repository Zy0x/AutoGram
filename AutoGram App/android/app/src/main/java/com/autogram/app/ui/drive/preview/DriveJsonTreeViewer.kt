package com.autogram.app.ui.drive.preview

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramGlassCard
import org.json.JSONArray
import org.json.JSONObject

enum class JsonValueType { OBJECT, ARRAY, STRING, NUMBER, BOOLEAN, NULL }

data class JsonNode(
    val id: String,
    val key: String?,
    val value: String?,
    val type: JsonValueType,
    val depth: Int,
    val children: List<JsonNode> = emptyList()
)

@Composable
fun DriveJsonTreeViewer(
    rawJson: String,
    modifier: Modifier = Modifier
) {
    var searchQuery by remember { mutableStateOf("") }
    var expandedIds by remember { mutableStateOf<Set<String>>(emptySet()) }

    val rootNodes = remember(rawJson) {
        parseJsonTree(rawJson)
    }

    // Default expand first 2 levels
    LaunchedEffect(rootNodes) {
        val initialExpanded = mutableSetOf<String>()
        fun collectInitial(nodes: List<JsonNode>) {
            nodes.forEach { node ->
                if (node.depth < 2) {
                    initialExpanded.add(node.id)
                    collectInitial(node.children)
                }
            }
        }
        collectInitial(rootNodes)
        expandedIds = initialExpanded
    }

    val visibleList = remember(rootNodes, expandedIds, searchQuery) {
        val list = mutableListOf<JsonNode>()
        fun flatten(nodes: List<JsonNode>) {
            nodes.forEach { node ->
                val matches = searchQuery.isBlank() ||
                        node.key?.contains(searchQuery, ignoreCase = true) == true ||
                        node.value?.contains(searchQuery, ignoreCase = true) == true
                if (matches || searchQuery.isBlank()) {
                    list.add(node)
                }
                if (expandedIds.contains(node.id)) {
                    flatten(node.children)
                }
            }
        }
        flatten(rootNodes)
        list
    }

    fun expandAll() {
        val all = mutableSetOf<String>()
        fun collect(nodes: List<JsonNode>) {
            nodes.forEach {
                if (it.children.isNotEmpty()) {
                    all.add(it.id)
                    collect(it.children)
                }
            }
        }
        collect(rootNodes)
        expandedIds = all
    }

    fun collapseAll() {
        expandedIds = emptySet()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(12.dp)
            .testTag("json-tree-viewer"),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Toolbar: Controls & Expand/Collapse All
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.DataArray, null, tint = SoftViolet, modifier = Modifier.size(20.dp))
                Text(
                    text = stringResource(R.string.preview_json_title),
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                TextButton(onClick = ::expandAll) {
                    Text(stringResource(R.string.preview_json_expand_all), fontSize = 11.sp)
                }
                TextButton(onClick = ::collapseAll) {
                    Text(stringResource(R.string.preview_json_collapse_all), fontSize = 11.sp)
                }
            }
        }

        // Search Filter
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            placeholder = { Text(stringResource(R.string.preview_json_search)) },
            leadingIcon = { Icon(Icons.Default.Search, null, tint = TextMutedDark) },
            trailingIcon = {
                if (searchQuery.isNotEmpty()) {
                    IconButton(onClick = { searchQuery = "" }) {
                        Icon(Icons.Default.Clear, null, tint = TextMutedDark)
                    }
                }
            },
            singleLine = true,
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        )

        // Tree List in Glass Card
        AutoGramGlassCard(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
        ) {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                items(visibleList, key = { it.id }) { node ->
                    val isExpanded = expandedIds.contains(node.id)
                    val hasChildren = node.children.isNotEmpty()

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(enabled = hasChildren) {
                                expandedIds = if (isExpanded) expandedIds - node.id else expandedIds + node.id
                            }
                            .padding(start = (node.depth * 16 + 4).dp, top = 3.dp, bottom = 3.dp, end = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (hasChildren) {
                            Icon(
                                imageVector = if (isExpanded) Icons.Default.KeyboardArrowDown else Icons.Default.KeyboardArrowRight,
                                contentDescription = null,
                                tint = SoftViolet,
                                modifier = Modifier.size(16.dp)
                            )
                        } else {
                            Spacer(Modifier.width(16.dp))
                        }

                        Spacer(Modifier.width(4.dp))

                        // Key
                        if (node.key != null) {
                            Text(
                                text = "\"${node.key}\": ",
                                style = MaterialTheme.typography.bodySmall.copy(
                                    fontFamily = FontFamily.Monospace,
                                    fontWeight = FontWeight.SemiBold,
                                    fontSize = 12.sp
                                ),
                                color = SoftViolet
                            )
                        }

                        // Value or Container type
                        when (node.type) {
                            JsonValueType.OBJECT -> {
                                Text(
                                    text = if (isExpanded) "{" else "{...} (${node.children.size})",
                                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 12.sp),
                                    color = TextSecondaryDark
                                )
                            }
                            JsonValueType.ARRAY -> {
                                Text(
                                    text = if (isExpanded) "[" else "[...] (${node.children.size})",
                                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 12.sp),
                                    color = TextSecondaryDark
                                )
                            }
                            JsonValueType.STRING -> {
                                Text(
                                    text = "\"${node.value}\"",
                                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 12.sp),
                                    color = DustySage
                                )
                            }
                            JsonValueType.NUMBER -> {
                                Text(
                                    text = node.value ?: "",
                                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 12.sp),
                                    color = Color(0xFFFFB74D)
                                )
                            }
                            JsonValueType.BOOLEAN -> {
                                Text(
                                    text = node.value ?: "",
                                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 12.sp),
                                    color = Color(0xFF64B5F6)
                                )
                            }
                            JsonValueType.NULL -> {
                                Text(
                                    text = "null",
                                    style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace, fontSize = 12.sp),
                                    color = TextMutedDark
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun parseJsonTree(raw: String): List<JsonNode> {
    val trimmed = raw.trim()
    return try {
        when {
            trimmed.startsWith("{") -> {
                val obj = JSONObject(trimmed)
                parseObjectNode("root", null, obj, 0)
            }
            trimmed.startsWith("[") -> {
                val arr = JSONArray(trimmed)
                parseArrayNode("root", null, arr, 0)
            }
            else -> emptyList()
        }
    } catch (_: Exception) {
        listOf(JsonNode("error", "raw", trimmed.take(2048), JsonValueType.STRING, 0))
    }
}

private fun parseObjectNode(idPrefix: String, key: String?, obj: JSONObject, depth: Int): List<JsonNode> {
    val children = mutableListOf<JsonNode>()
    val keys = obj.keys()
    var idx = 0
    while (keys.hasNext()) {
        val k = keys.next()
        val childId = "$idPrefix.$k.$idx"
        val v = obj.get(k)
        children.add(parseAny(childId, k, v, depth + 1))
        idx++
    }
    return listOf(JsonNode(idPrefix, key, null, JsonValueType.OBJECT, depth, children))
}

private fun parseArrayNode(idPrefix: String, key: String?, arr: JSONArray, depth: Int): List<JsonNode> {
    val children = mutableListOf<JsonNode>()
    for (i in 0 until arr.length()) {
        val childId = "$idPrefix[$i]"
        val v = arr.get(i)
        children.add(parseAny(childId, "[$i]", v, depth + 1))
    }
    return listOf(JsonNode(idPrefix, key, null, JsonValueType.ARRAY, depth, children))
}

private fun parseAny(id: String, key: String?, value: Any?, depth: Int): JsonNode {
    return when (value) {
        is JSONObject -> JsonNode(id, key, null, JsonValueType.OBJECT, depth, parseObjectNode(id, key, value, depth).first().children)
        is JSONArray -> JsonNode(id, key, null, JsonValueType.ARRAY, depth, parseArrayNode(id, key, value, depth).first().children)
        is String -> JsonNode(id, key, value, JsonValueType.STRING, depth)
        is Number -> JsonNode(id, key, value.toString(), JsonValueType.NUMBER, depth)
        is Boolean -> JsonNode(id, key, value.toString(), JsonValueType.BOOLEAN, depth)
        null, JSONObject.NULL -> JsonNode(id, key, null, JsonValueType.NULL, depth)
        else -> JsonNode(id, key, value.toString(), JsonValueType.STRING, depth)
    }
}
