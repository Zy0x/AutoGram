package com.autogram.app.ui.drive.preview

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*

/**
 * Native Android Markdown Viewer with full styling parity to desktop.
 * Supports H1-H6 headers, code blocks with copy action, blockquotes, lists, tables, and raw mode.
 */
@Composable
fun DriveMarkdownViewer(
    fileName: String,
    rawText: String,
    truncated: Boolean = false,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var selectedTab by remember { mutableIntStateOf(0) } // 0 = Rendered, 1 = Raw
    var searchQuery by remember { mutableStateOf("") }
    var showSearch by remember { mutableStateOf(false) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(SurfaceDeep)
            .testTag("drive-markdown-viewer")
    ) {
        // Top Toolbar
        Surface(
            color = SurfaceElevatedDark,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column {
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
                            color = MutedIceCyan.copy(alpha = 0.15f)
                        ) {
                            Text(
                                text = "MD",
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 11.sp
                                ),
                                color = MutedIceCyan,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }

                        Text(
                            text = fileName,
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontWeight = FontWeight.SemiBold
                            ),
                            color = TextPrimaryDark,
                            maxLines = 1
                        )
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        // Toggle search
                        IconButton(
                            onClick = { showSearch = !showSearch; if (!showSearch) searchQuery = "" },
                            modifier = Modifier.size(44.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Search,
                                contentDescription = stringResource(R.string.drive_search_accessibility),
                                tint = if (showSearch) MutedIceCyan else TextSecondaryDark,
                                modifier = Modifier.size(20.dp)
                            )
                        }

                        // Copy full text
                        IconButton(
                            onClick = {
                                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                val clip = ClipData.newPlainText("Markdown Source", rawText)
                                clipboard?.setPrimaryClip(clip)
                                Toast.makeText(context, context.getString(R.string.preview_code_copied), Toast.LENGTH_SHORT).show()
                            },
                            modifier = Modifier.size(44.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.ContentCopy,
                                contentDescription = stringResource(R.string.preview_code_copy),
                                tint = MutedIceCyan,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }

                // Search Bar Input
                if (showSearch) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = searchQuery,
                            onValueChange = { searchQuery = it },
                            placeholder = { Text(stringResource(R.string.preview_code_search_placeholder), fontSize = 13.sp) },
                            singleLine = true,
                            trailingIcon = {
                                if (searchQuery.isNotEmpty()) {
                                    IconButton(onClick = { searchQuery = "" }, modifier = Modifier.size(44.dp)) {
                                        Icon(Icons.Default.Close, contentDescription = null, modifier = Modifier.size(16.dp))
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            textStyle = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp)
                        )
                    }
                }
            }
        }

        // Tabs: Rendered vs Raw
        TabRow(
            selectedTabIndex = selectedTab,
            containerColor = SurfaceDark,
            contentColor = MutedIceCyan
        ) {
            Tab(
                selected = selectedTab == 0,
                onClick = { selectedTab = 0 },
                text = {
                    Text(
                        stringResource(R.string.preview_markdown_rendered),
                        fontSize = 13.sp,
                        fontWeight = if (selectedTab == 0) FontWeight.Bold else FontWeight.Normal
                    )
                },
                modifier = Modifier.heightIn(min = 48.dp)
            )
            Tab(
                selected = selectedTab == 1,
                onClick = { selectedTab = 1 },
                text = {
                    Text(
                        stringResource(R.string.preview_markdown_raw),
                        fontSize = 13.sp,
                        fontWeight = if (selectedTab == 1) FontWeight.Bold else FontWeight.Normal
                    )
                },
                modifier = Modifier.heightIn(min = 48.dp)
            )
        }

        // Truncated warning
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

        // Content
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            if (selectedTab == 0) {
                RenderedMarkdownBody(
                    rawText = rawText,
                    searchQuery = searchQuery,
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp)
                )
            } else {
                RawMarkdownBody(
                    rawText = rawText,
                    searchQuery = searchQuery,
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
    }
}

@Composable
private fun RenderedMarkdownBody(
    rawText: String,
    searchQuery: String,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val blocks = remember(rawText) { parseMarkdownBlocks(rawText) }

    SelectionContainer {
        Column(
            modifier = modifier,
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            blocks.forEach { block ->
                when (block) {
                    is MdBlock.Header -> {
                        val headerStyle = when (block.level) {
                            1 -> MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold, color = TextPrimaryDark)
                            2 -> MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold, color = MutedIceCyan)
                            3 -> MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold, color = GoldAccent)
                            4 -> MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold, color = TextPrimaryDark)
                            else -> MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Medium, color = TextSecondaryDark)
                        }
                        Text(
                            text = highlightSearchText(block.text, searchQuery),
                            style = headerStyle
                        )
                        if (block.level <= 2) {
                            HorizontalDivider(
                                color = SurfaceElevatedDark,
                                thickness = 1.dp,
                                modifier = Modifier.padding(vertical = 4.dp)
                            )
                        }
                    }
                    is MdBlock.CodeBlock -> {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = SurfaceDark,
                            border = androidx.compose.foundation.BorderStroke(1.dp, SurfaceElevatedDark),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column {
                                // Code header with language and copy button
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .background(SurfaceElevatedDark.copy(alpha = 0.5f))
                                        .padding(horizontal = 12.dp, vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text(
                                        text = block.language.ifEmpty { "code" }.uppercase(),
                                        style = MaterialTheme.typography.labelSmall.copy(
                                            fontFamily = FontFamily.Monospace,
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.SemiBold
                                        ),
                                        color = TextSecondaryDark
                                    )
                                    IconButton(
                                        onClick = {
                                            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                            val clip = ClipData.newPlainText("Code Block", block.code)
                                            clipboard?.setPrimaryClip(clip)
                                            Toast.makeText(context, context.getString(R.string.preview_code_copied), Toast.LENGTH_SHORT).show()
                                        },
                                        modifier = Modifier.size(36.dp)
                                    ) {
                                        Icon(
                                            Icons.Default.ContentCopy,
                                            contentDescription = stringResource(R.string.preview_code_copy),
                                            tint = MutedIceCyan,
                                            modifier = Modifier.size(16.dp)
                                        )
                                    }
                                }
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .horizontalScroll(rememberScrollState())
                                        .padding(12.dp)
                                ) {
                                    Text(
                                        text = highlightSearchText(block.code, searchQuery),
                                        style = MaterialTheme.typography.bodySmall.copy(
                                            fontFamily = FontFamily.Monospace,
                                            fontSize = 12.sp,
                                            lineHeight = 18.sp
                                        ),
                                        color = DustySage
                                    )
                                }
                            }
                        }
                    }
                    is MdBlock.Quote -> {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .width(4.dp)
                                    .fillMaxHeight()
                                    .background(MutedIceCyan, RoundedCornerShape(2.dp))
                            )
                            Text(
                                text = highlightSearchText(block.text, searchQuery),
                                style = MaterialTheme.typography.bodyMedium.copy(
                                    fontStyle = FontStyle.Italic,
                                    color = TextSecondaryDark,
                                    lineHeight = 22.sp
                                )
                            )
                        }
                    }
                    is MdBlock.ListItem -> {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(start = (block.depth * 16).dp, top = 2.dp, bottom = 2.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(
                                text = if (block.ordered) "${block.index}." else "•",
                                color = MutedIceCyan,
                                fontWeight = FontWeight.Bold,
                                fontSize = 14.sp
                            )
                            Text(
                                text = highlightSearchText(block.text, searchQuery),
                                style = MaterialTheme.typography.bodyMedium.copy(
                                    color = TextPrimaryDark,
                                    lineHeight = 20.sp
                                )
                            )
                        }
                    }
                    is MdBlock.Divider -> {
                        HorizontalDivider(
                            color = SurfaceElevatedDark,
                            thickness = 2.dp,
                            modifier = Modifier.padding(vertical = 8.dp)
                        )
                    }
                    is MdBlock.Table -> {
                        RenderMarkdownTable(block, searchQuery)
                    }
                    is MdBlock.Paragraph -> {
                        Text(
                            text = highlightSearchText(block.text, searchQuery),
                            style = MaterialTheme.typography.bodyMedium.copy(
                                color = TextPrimaryDark,
                                lineHeight = 22.sp
                            )
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RenderMarkdownTable(table: MdBlock.Table, searchQuery: String) {
    val horizontalScroll = rememberScrollState()
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(horizontalScroll)
            .padding(vertical = 6.dp)
    ) {
        Column(
            modifier = Modifier
                .border(1.dp, SurfaceElevatedDark, RoundedCornerShape(6.dp))
                .clip(RoundedCornerShape(6.dp))
        ) {
            // Header Row
            Row(
                modifier = Modifier
                    .background(SurfaceDark)
                    .padding(vertical = 6.dp)
            ) {
                table.headers.forEach { header ->
                    Box(
                        modifier = Modifier
                            .widthIn(min = 90.dp, max = 220.dp)
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = highlightSearchText(header, searchQuery),
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontWeight = FontWeight.Bold,
                                color = MutedIceCyan
                            )
                        )
                    }
                }
            }
            HorizontalDivider(color = SurfaceElevatedDark, thickness = 1.dp)
            // Data Rows
            table.rows.forEachIndexed { idx, row ->
                val rowBg = if (idx % 2 == 0) SurfaceDeep else SurfaceDark.copy(alpha = 0.5f)
                Row(
                    modifier = Modifier
                        .background(rowBg)
                        .padding(vertical = 6.dp)
                ) {
                    row.forEach { cell ->
                        Box(
                            modifier = Modifier
                                .widthIn(min = 90.dp, max = 220.dp)
                                .padding(horizontal = 10.dp, vertical = 4.dp)
                        ) {
                            Text(
                                text = highlightSearchText(cell, searchQuery),
                                style = MaterialTheme.typography.bodySmall.copy(
                                    color = TextPrimaryDark
                                )
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun RawMarkdownBody(
    rawText: String,
    searchQuery: String,
    modifier: Modifier = Modifier
) {
    val lines = remember(rawText) { rawText.lines() }
    val verticalScroll = rememberScrollState()
    val horizontalScroll = rememberScrollState()

    Row(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(verticalScroll)
    ) {
        // Line numbers
        Column(
            modifier = Modifier
                .background(SurfaceDark.copy(alpha = 0.7f))
                .padding(horizontal = 10.dp, vertical = 12.dp),
            horizontalAlignment = Alignment.End
        ) {
            lines.indices.forEach { index ->
                Text(
                    text = "${index + 1}",
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                        lineHeight = 18.sp
                    ),
                    color = TextMutedDark
                )
            }
        }

        // Raw lines
        SelectionContainer(
            modifier = Modifier
                .weight(1f)
                .horizontalScroll(horizontalScroll)
                .padding(horizontal = 12.dp, vertical = 12.dp)
        ) {
            Column {
                lines.forEach { line ->
                    Text(
                        text = highlightSearchText(line.ifEmpty { " " }, searchQuery),
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            lineHeight = 18.sp
                        ),
                        color = TextPrimaryDark
                    )
                }
            }
        }
    }
}

// Sealed hierarchy for parsed Markdown elements
private sealed class MdBlock {
    data class Header(val level: Int, val text: String) : MdBlock()
    data class CodeBlock(val language: String, val code: String) : MdBlock()
    data class Quote(val text: String) : MdBlock()
    data class ListItem(val ordered: Boolean, val index: Int, val depth: Int, val text: String) : MdBlock()
    data class Table(val headers: List<String>, val rows: List<List<String>>) : MdBlock()
    data class Paragraph(val text: String) : MdBlock()
    object Divider : MdBlock()
}

private fun parseMarkdownBlocks(text: String): List<MdBlock> {
    val blocks = mutableListOf<MdBlock>()
    val lines = text.lines()
    var i = 0

    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trim()

        when {
            // Code block
            trimmed.startsWith("```") -> {
                val lang = trimmed.removePrefix("```").trim()
                val codeLines = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trim().startsWith("```")) {
                    codeLines.add(lines[i])
                    i++
                }
                blocks.add(MdBlock.CodeBlock(lang, codeLines.joinToString("\n")))
                i++
            }
            // Horizontal rule
            trimmed == "---" || trimmed == "***" || trimmed == "___" -> {
                blocks.add(MdBlock.Divider)
                i++
            }
            // Headers
            trimmed.startsWith("#") -> {
                val level = trimmed.takeWhile { it == '#' }.length.coerceIn(1, 6)
                val headerText = trimmed.drop(level).trim()
                blocks.add(MdBlock.Header(level, headerText))
                i++
            }
            // Blockquote
            trimmed.startsWith(">") -> {
                val quoteLines = mutableListOf<String>()
                while (i < lines.size && lines[i].trim().startsWith(">")) {
                    quoteLines.add(lines[i].trim().removePrefix(">").trim())
                    i++
                }
                blocks.add(MdBlock.Quote(quoteLines.joinToString("\n")))
            }
            // Table row starting with |
            trimmed.startsWith("|") && trimmed.endsWith("|") -> {
                val headers = trimmed.split("|").filter { it.isNotBlank() }.map { it.trim() }
                i++
                // Skip separator row |---|---|
                if (i < lines.size && lines[i].trim().startsWith("|") && lines[i].contains("-")) {
                    i++
                }
                val rows = mutableListOf<List<String>>()
                while (i < lines.size && lines[i].trim().startsWith("|")) {
                    val cells = lines[i].trim().split("|").filter { it.isNotBlank() }.map { it.trim() }
                    rows.add(cells)
                    i++
                }
                blocks.add(MdBlock.Table(headers, rows))
            }
            // Unordered list
            trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("+ ") -> {
                val bulletText = trimmed.drop(2).trim()
                val depth = (line.takeWhile { it.isWhitespace() }.length / 2).coerceAtMost(4)
                blocks.add(MdBlock.ListItem(ordered = false, index = 0, depth = depth, text = bulletText))
                i++
            }
            // Ordered list
            trimmed.matches(Regex("""^\d+\.\s+.*""")) -> {
                val num = trimmed.takeWhile { it.isDigit() }.toIntOrNull() ?: 1
                val listText = trimmed.replace(Regex("""^\d+\.\s+"""), "").trim()
                val depth = (line.takeWhile { it.isWhitespace() }.length / 2).coerceAtMost(4)
                blocks.add(MdBlock.ListItem(ordered = true, index = num, depth = depth, text = listText))
                i++
            }
            // Blank lines
            trimmed.isEmpty() -> {
                i++
            }
            // Paragraph
            else -> {
                val paraLines = mutableListOf<String>()
                while (i < lines.size && lines[i].isNotBlank() &&
                    !lines[i].trim().startsWith("#") &&
                    !lines[i].trim().startsWith("```") &&
                    !lines[i].trim().startsWith(">") &&
                    !lines[i].trim().startsWith("|") &&
                    !lines[i].trim().startsWith("- ") &&
                    !lines[i].trim().startsWith("* ")
                ) {
                    paraLines.add(lines[i].trim())
                    i++
                }
                blocks.add(MdBlock.Paragraph(paraLines.joinToString(" ")))
            }
        }
    }

    return blocks
}

private fun highlightSearchText(text: String, query: String): androidx.compose.ui.text.AnnotatedString {
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
            withStyle(SpanStyle(background = GoldAccent.copy(alpha = 0.4f), color = Color.White)) {
                append(text.substring(idx, idx + query.length))
            }
            start = idx + query.length
        }
    }
}
