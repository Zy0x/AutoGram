package com.autogram.app.ui.drive.preview

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import kotlinx.coroutines.launch

/**
 * Native Android Log Inspector with severity filtering, search, line numbers, and auto-scroll.
 */
@Composable
fun DriveLogViewer(
    fileName: String,
    rawLog: String,
    truncated: Boolean = false,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var filterLevel by remember { mutableStateOf(LogLevel.ALL) }
    var searchQuery by remember { mutableStateOf("") }
    var autoScroll by remember { mutableStateOf(false) }

    val parsedLogs = remember(rawLog) {
        rawLog.lines().filter { it.isNotBlank() }.mapIndexed { index, line ->
            parseLogEntry(index + 1, line)
        }
    }

    val filteredLogs = remember(parsedLogs, filterLevel, searchQuery) {
        parsedLogs.filter { entry ->
            val levelMatches = filterLevel == LogLevel.ALL || entry.level == filterLevel
            val searchMatches = searchQuery.isBlank() || entry.rawText.contains(searchQuery, ignoreCase = true)
            levelMatches && searchMatches
        }
    }

    // Auto-scroll effect
    LaunchedEffect(filteredLogs.size, autoScroll) {
        if (autoScroll && filteredLogs.isNotEmpty()) {
            listState.animateScrollToItem(filteredLogs.lastIndex)
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(SurfaceDeep)
            .testTag("drive-log-viewer")
    ) {
        // Toolbar
        Surface(
            color = SurfaceElevatedDark,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(bottom = 6.dp)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = SoftCoral.copy(alpha = 0.15f)
                        ) {
                            Text(
                                text = "LOG",
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 11.sp
                                ),
                                color = SoftCoral,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }

                        Text(
                            text = fileName,
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = TextPrimaryDark,
                            maxLines = 1
                        )
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        // Scroll to bottom button
                        IconButton(
                            onClick = {
                                autoScroll = !autoScroll
                                if (autoScroll && filteredLogs.isNotEmpty()) {
                                    coroutineScope.launch {
                                        listState.animateScrollToItem(filteredLogs.lastIndex)
                                    }
                                }
                            },
                            modifier = Modifier.size(44.dp)
                        ) {
                            Icon(
                                Icons.Default.KeyboardArrowDown,
                                contentDescription = stringResource(R.string.preview_log_autoscroll),
                                tint = if (autoScroll) MutedIceCyan else TextSecondaryDark,
                                modifier = Modifier.size(22.dp)
                            )
                        }

                        // Copy filtered / all logs
                        IconButton(
                            onClick = {
                                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                val contentToCopy = filteredLogs.joinToString("\n") { it.rawText }
                                val clip = ClipData.newPlainText("Log Output", contentToCopy)
                                clipboard?.setPrimaryClip(clip)
                                Toast.makeText(context, context.getString(R.string.preview_log_copied), Toast.LENGTH_SHORT).show()
                            },
                            modifier = Modifier.size(44.dp)
                        ) {
                            Icon(
                                Icons.Default.ContentCopy,
                                contentDescription = stringResource(R.string.preview_log_copy),
                                tint = MutedIceCyan,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }

                // Search Filter Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = searchQuery,
                        onValueChange = { searchQuery = it },
                        placeholder = { Text(stringResource(R.string.preview_log_filter_placeholder), fontSize = 12.sp) },
                        leadingIcon = {
                            Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(18.dp), tint = TextMutedDark)
                        },
                        trailingIcon = {
                            if (searchQuery.isNotEmpty()) {
                                IconButton(onClick = { searchQuery = "" }, modifier = Modifier.size(44.dp)) {
                                    Icon(Icons.Default.Close, contentDescription = null, modifier = Modifier.size(16.dp))
                                }
                            }
                        },
                        singleLine = true,
                        modifier = Modifier.weight(1f).height(48.dp),
                        textStyle = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp)
                    )

                    Text(
                        text = stringResource(R.string.preview_log_matches, filteredLogs.size),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                        color = if (filteredLogs.isNotEmpty()) MutedIceCyan else TextMutedDark
                    )
                }

                // Severity Filter Chips
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    LogLevel.values().forEach { level ->
                        val isSelected = filterLevel == level
                        val chipBg = when (level) {
                            LogLevel.ERROR -> if (isSelected) SoftCoral else SoftCoral.copy(alpha = 0.15f)
                            LogLevel.WARN -> if (isSelected) WarmAmber else WarmAmber.copy(alpha = 0.15f)
                            LogLevel.INFO -> if (isSelected) MutedIceCyan else MutedIceCyan.copy(alpha = 0.15f)
                            LogLevel.DEBUG -> if (isSelected) DustySage else DustySage.copy(alpha = 0.15f)
                            LogLevel.ALL -> if (isSelected) TextPrimaryDark else SurfaceDark
                        }
                        val textColor = if (isSelected) {
                            if (level == LogLevel.ALL) Color.Black else Color.White
                        } else {
                            when (level) {
                                LogLevel.ERROR -> SoftCoral
                                LogLevel.WARN -> WarmAmber
                                LogLevel.INFO -> MutedIceCyan
                                LogLevel.DEBUG -> DustySage
                                LogLevel.ALL -> TextSecondaryDark
                            }
                        }
                        val label = when (level) {
                            LogLevel.ALL -> stringResource(R.string.preview_log_level_all)
                            LogLevel.ERROR -> stringResource(R.string.preview_log_level_error)
                            LogLevel.WARN -> stringResource(R.string.preview_log_level_warn)
                            LogLevel.INFO -> stringResource(R.string.preview_log_level_info)
                            LogLevel.DEBUG -> stringResource(R.string.preview_log_level_debug)
                        }

                        FilterChip(
                            selected = isSelected,
                            onClick = { filterLevel = level },
                            label = { Text(label, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = textColor) },
                            colors = FilterChipDefaults.filterChipColors(
                                containerColor = chipBg,
                                selectedContainerColor = chipBg
                            ),
                            modifier = Modifier.height(32.dp)
                        )
                    }
                }
            }
        }

        // Truncation banner
        if (truncated) {
            Surface(
                color = WarmAmber.copy(alpha = 0.15f),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = stringResource(R.string.cloud_text_truncated),
                    style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.sp),
                    color = WarmAmber,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)
                )
            }
        }

        // Log Entries List
        SelectionContainer(modifier = Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize().padding(horizontal = 8.dp, vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                itemsIndexed(filteredLogs, key = { _, item -> item.lineNumber }) { _, item ->
                    LogEntryRow(item, searchQuery)
                }
            }
        }
    }
}

@Composable
private fun LogEntryRow(entry: LogEntry, query: String) {
    val levelColor = when (entry.level) {
        LogLevel.ERROR -> SoftCoral
        LogLevel.WARN -> WarmAmber
        LogLevel.INFO -> MutedIceCyan
        LogLevel.DEBUG -> DustySage
        LogLevel.ALL -> TextMutedDark
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Line number
        Text(
            text = "${entry.lineNumber}",
            style = MaterialTheme.typography.bodySmall.copy(
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
                lineHeight = 16.sp
            ),
            color = TextMutedDark,
            modifier = Modifier.width(36.dp)
        )

        // Severity indicator
        Surface(
            shape = RoundedCornerShape(3.dp),
            color = levelColor.copy(alpha = 0.18f),
            modifier = Modifier.padding(top = 1.dp)
        ) {
            Text(
                text = entry.level.name.take(4),
                style = MaterialTheme.typography.labelSmall.copy(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold
                ),
                color = levelColor,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 1.dp)
            )
        }

        // Timestamp (if detected)
        if (entry.timestamp.isNotBlank()) {
            Text(
                text = entry.timestamp,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    lineHeight = 16.sp
                ),
                color = TextMutedDark
            )
        }

        // Message text
        Text(
            text = highlightSearchQuery(entry.message, query),
            style = MaterialTheme.typography.bodySmall.copy(
                fontFamily = FontFamily.Monospace,
                fontSize = 11.sp,
                lineHeight = 16.sp
            ),
            color = if (entry.level == LogLevel.ERROR) SoftCoral else TextPrimaryDark,
            modifier = Modifier.weight(1f)
        )
    }
}

private fun highlightSearchQuery(text: String, query: String): androidx.compose.ui.text.AnnotatedString {
    if (query.isBlank()) return buildAnnotatedString { append(text) }

    return buildAnnotatedString {
        var start = 0
        while (start < text.length) {
            val idx = text.indexOf(query, start, ignoreCase = true)
            if (idx == -1) {
                append(text.substring(start))
                break
            }
            append(text.substring(start, idx))
            withStyle(SpanStyle(background = GoldAccent.copy(alpha = 0.5f), color = Color.White)) {
                append(text.substring(idx, idx + query.length))
            }
            start = idx + query.length
        }
    }
}

enum class LogLevel {
    ALL, ERROR, WARN, INFO, DEBUG
}

private data class LogEntry(
    val lineNumber: Int,
    val level: LogLevel,
    val timestamp: String,
    val message: String,
    val rawText: String
)

private fun parseLogEntry(lineNum: Int, line: String): LogEntry {
    val upper = line.uppercase()
    val level = when {
        upper.contains("ERROR") || upper.contains("FATAL") || upper.contains("SEVERE") || upper.contains("CRITICAL") -> LogLevel.ERROR
        upper.contains("WARN") || upper.contains("WARNING") -> LogLevel.WARN
        upper.contains("INFO") -> LogLevel.INFO
        upper.contains("DEBUG") || upper.contains("TRACE") -> LogLevel.DEBUG
        else -> LogLevel.ALL
    }

    // Match ISO or standard timestamps like 2026-10-04 12:34:56 or 12:34:56.789
    val tsRegex = Regex("""^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?)""")
    val tsMatch = tsRegex.find(line.trim())
    val timestamp = tsMatch?.value ?: ""
    val message = if (timestamp.isNotBlank()) line.trim().removePrefix(timestamp).trim() else line

    return LogEntry(
        lineNumber = lineNum,
        level = level,
        timestamp = timestamp,
        message = message,
        rawText = line
    )
}
