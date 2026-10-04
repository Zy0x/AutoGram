package com.autogram.app.ui.drive.preview

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
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

/**
 * Native Android Code & Script Viewer with full syntax highlighting, line numbers, search, and copy.
 */
@Composable
fun DriveCodeScriptViewer(
    fileName: String,
    rawCode: String,
    truncated: Boolean = false,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val extension = remember(fileName) {
        fileName.substringAfterLast('.', "").lowercase()
    }
    val lines = remember(rawCode) { rawCode.lines() }

    var searchQuery by remember { mutableStateOf("") }
    var showSearch by remember { mutableStateOf(false) }

    // Count matches
    val matchCount = remember(rawCode, searchQuery) {
        if (searchQuery.isBlank()) 0
        else {
            var count = 0
            var idx = 0
            while (idx < rawCode.length) {
                val found = rawCode.indexOf(searchQuery, idx, ignoreCase = true)
                if (found == -1) break
                count++
                idx = found + searchQuery.length
            }
            count
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(SurfaceDeep)
            .testTag("drive-code-viewer")
    ) {
        // Toolbar
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
                                text = extension.uppercase().ifEmpty { "CODE" },
                                style = MaterialTheme.typography.labelSmall.copy(
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 11.sp
                                ),
                                color = MutedIceCyan,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }

                        Text(
                            text = stringResource(R.string.preview_code_lines, lines.size),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                            color = TextSecondaryDark
                        )
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(
                            onClick = { showSearch = !showSearch; if (!showSearch) searchQuery = "" },
                            modifier = Modifier.size(44.dp)
                        ) {
                            Icon(
                                Icons.Default.Search,
                                contentDescription = stringResource(R.string.drive_search_accessibility),
                                tint = if (showSearch) MutedIceCyan else TextSecondaryDark,
                                modifier = Modifier.size(20.dp)
                            )
                        }

                        IconButton(
                            onClick = {
                                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                val clip = ClipData.newPlainText("Source Code", rawCode)
                                clipboard?.setPrimaryClip(clip)
                                Toast.makeText(context, context.getString(R.string.preview_code_copied), Toast.LENGTH_SHORT).show()
                            },
                            modifier = Modifier.size(44.dp)
                        ) {
                            Icon(
                                Icons.Default.ContentCopy,
                                contentDescription = stringResource(R.string.preview_code_copy),
                                tint = MutedIceCyan,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }

                // In-Code Search Bar
                if (showSearch) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
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
                            modifier = Modifier.weight(1f).height(48.dp),
                            textStyle = MaterialTheme.typography.bodySmall.copy(fontSize = 13.sp)
                        )

                        if (searchQuery.isNotBlank()) {
                            Text(
                                text = stringResource(R.string.preview_code_matches, matchCount),
                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                                color = if (matchCount > 0) GoldAccent else TextMutedDark
                            )
                        }
                    }
                }
            }
        }

        // Truncated indicator
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

        // Code Editor Canvas
        val verticalScroll = rememberScrollState()
        val horizontalScroll = rememberScrollState()

        Row(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(verticalScroll)
        ) {
            // Line numbers column
            Column(
                modifier = Modifier
                    .background(SurfaceDark.copy(alpha = 0.85f))
                    .padding(horizontal = 12.dp, vertical = 12.dp),
                horizontalAlignment = Alignment.End
            ) {
                lines.indices.forEach { index ->
                    Text(
                        text = "${index + 1}",
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.sp,
                            lineHeight = 20.sp
                        ),
                        color = TextMutedDark
                    )
                }
            }

            // Syntax Highlighted Code Area
            SelectionContainer(
                modifier = Modifier
                    .weight(1f)
                    .horizontalScroll(horizontalScroll)
                    .padding(horizontal = 14.dp, vertical = 12.dp)
            ) {
                Column {
                    lines.forEach { line ->
                        Text(
                            text = highlightCodeLine(line, extension, searchQuery),
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontFamily = FontFamily.Monospace,
                                fontSize = 12.sp,
                                lineHeight = 20.sp
                            )
                        )
                    }
                }
            }
        }
    }
}

/**
 * Lightweight, fast syntax tokenizer and highlighter for common programming languages.
 */
private fun highlightCodeLine(
    line: String,
    ext: String,
    searchQuery: String
): androidx.compose.ui.text.AnnotatedString {
    if (line.isEmpty()) return buildAnnotatedString { append(" ") }

    // If searching, check search match first
    if (searchQuery.isNotBlank() && line.contains(searchQuery, ignoreCase = true)) {
        return buildAnnotatedString {
            var start = 0
            while (start < line.length) {
                val idx = line.indexOf(searchQuery, start, ignoreCase = true)
                if (idx == -1) {
                    append(line.substring(start))
                    break
                }
                append(line.substring(start, idx))
                withStyle(SpanStyle(background = GoldAccent.copy(alpha = 0.5f), color = Color.White)) {
                    append(line.substring(idx, idx + searchQuery.length))
                }
                start = idx + searchQuery.length
            }
        }
    }

    val trimmed = line.trimStart()
    // Comment line
    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("--") || trimmed.startsWith(";")) {
        return buildAnnotatedString {
            withStyle(SpanStyle(color = TextMutedDark, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic)) {
                append(line)
            }
        }
    }

    val keywords = when (ext) {
        "kt", "kts", "java" -> KEYWORDS_JVM
        "rs" -> KEYWORDS_RUST
        "py" -> KEYWORDS_PYTHON
        "js", "jsx", "ts", "tsx" -> KEYWORDS_JS
        "sql" -> KEYWORDS_SQL
        "sh", "bash", "zsh", "ps1" -> KEYWORDS_SHELL
        else -> KEYWORDS_GENERIC
    }

    return buildAnnotatedString {
        // Regex tokenizer for tokens, strings, numbers, identifiers
        val regex = Regex("""("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b|[^\s\w]+|\s+)""")
        val matches = regex.findAll(line)

        var lastIndex = 0
        for (m in matches) {
            if (m.range.first > lastIndex) {
                append(line.substring(lastIndex, m.range.first))
            }
            val token = m.value
            when {
                // String literal
                token.startsWith("\"") || token.startsWith("'") -> {
                    withStyle(SpanStyle(color = DustySage)) {
                        append(token)
                    }
                }
                // Number
                token.matches(Regex("""^\d+(\.\d+)?$""")) -> {
                    withStyle(SpanStyle(color = WarmAmber)) {
                        append(token)
                    }
                }
                // Keyword
                token in keywords -> {
                    withStyle(SpanStyle(color = MutedIceCyan, fontWeight = FontWeight.Bold)) {
                        append(token)
                    }
                }
                // Type or Capitalized identifier
                token.firstOrNull()?.isUpperCase() == true && token.length > 1 -> {
                    withStyle(SpanStyle(color = GoldAccent)) {
                        append(token)
                    }
                }
                // Standard identifier / text
                else -> {
                    withStyle(SpanStyle(color = TextPrimaryDark)) {
                        append(token)
                    }
                }
            }
            lastIndex = m.range.last + 1
        }
        if (lastIndex < line.length) {
            append(line.substring(lastIndex))
        }
    }
}

private val KEYWORDS_JVM = setOf(
    "package", "import", "class", "interface", "fun", "val", "var", "override", "public", "private",
    "protected", "internal", "data", "sealed", "object", "companion", "return", "if", "else", "when",
    "for", "while", "do", "try", "catch", "finally", "throw", "null", "true", "false", "this", "super",
    "is", "in", "as", "by", "suspend", "inline", "reified", "typealias", "enum"
)

private val KEYWORDS_RUST = setOf(
    "pub", "fn", "let", "mut", "struct", "enum", "impl", "trait", "type", "use", "mod", "crate",
    "self", "Self", "match", "if", "else", "loop", "while", "for", "in", "return", "break", "continue",
    "async", "await", "move", "unsafe", "where", "as", "ref", "true", "false", "Some", "None", "Ok", "Err"
)

private val KEYWORDS_PYTHON = setOf(
    "def", "class", "import", "from", "as", "return", "if", "elif", "else", "for", "while", "try",
    "except", "finally", "raise", "with", "yield", "lambda", "pass", "break", "continue", "True", "False",
    "None", "async", "await", "self", "in", "not", "and", "or", "is"
)

private val KEYWORDS_JS = setOf(
    "const", "let", "var", "function", "return", "if", "else", "switch", "case", "break", "continue",
    "for", "while", "do", "try", "catch", "finally", "throw", "class", "extends", "import", "export",
    "default", "from", "async", "await", "yield", "new", "this", "typeof", "instanceof", "true", "false",
    "null", "undefined", "interface", "type"
)

private val KEYWORDS_SQL = setOf(
    "SELECT", "FROM", "WHERE", "INSERT", "INTO", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "INDEX",
    "DROP", "ALTER", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER", "ON", "GROUP", "BY", "ORDER", "ASC",
    "DESC", "LIMIT", "OFFSET", "AND", "OR", "NOT", "NULL", "PRIMARY", "KEY", "FOREIGN", "REFERENCES",
    "select", "from", "where", "insert", "into", "update", "set", "delete", "create", "table", "index"
)

private val KEYWORDS_SHELL = setOf(
    "if", "then", "else", "elif", "fi", "case", "esac", "for", "while", "until", "do", "done", "in",
    "function", "return", "exit", "echo", "cd", "export", "set", "unset", "local"
)

private val KEYWORDS_GENERIC = setOf(
    "function", "var", "val", "let", "const", "if", "else", "for", "while", "return", "true", "false", "null"
)
