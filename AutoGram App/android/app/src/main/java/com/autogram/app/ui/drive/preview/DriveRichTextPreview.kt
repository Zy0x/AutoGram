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
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.features.preview.TextPreview
import com.autogram.app.theme.*

@Composable
fun DriveRichTextPreview(
    fileName: String,
    preview: TextPreview,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val isMarkdown = remember(fileName) {
        val ext = fileName.substringAfterLast('.', "").lowercase()
        ext == "md" || ext == "markdown"
    }

    var selectedTab by remember { mutableIntStateOf(0) } // 0 = Rendered (if MD) or Code, 1 = Raw
    val lines = remember(preview.text) { preview.text.lines() }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(SurfaceDeep)
    ) {
        // Toolbar
        Surface(
            color = SurfaceElevatedDark,
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                // Info badges
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = MutedIceCyan.copy(alpha = 0.15f)
                    ) {
                        Text(
                            text = fileName.substringAfterLast('.', "").uppercase().ifEmpty { "TXT" },
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

                // Copy Action
                IconButton(
                    onClick = {
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                        val clip = ClipData.newPlainText("Source Code", preview.text)
                        clipboard?.setPrimaryClip(clip)
                        Toast.makeText(context, context.getString(R.string.preview_code_copied), Toast.LENGTH_SHORT).show()
                    },
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.ContentCopy,
                        contentDescription = stringResource(R.string.preview_code_copy),
                        tint = MutedIceCyan,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }

        // Markdown Mode Switcher Tabs
        if (isMarkdown) {
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
                    }
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
                    }
                )
            }
        }

        // Truncated indicator banner
        if (preview.truncated) {
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

        // Content Area
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            if (isMarkdown && selectedTab == 0) {
                // Rendered Markdown View
                MarkdownRenderedContent(
                    text = preview.text,
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp)
                )
            } else {
                // Monospace Code / Text View with Line Numbers
                CodeViewerWithLineNumbers(
                    lines = lines,
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
    }
}

@Composable
private fun MarkdownRenderedContent(
    text: String,
    modifier: Modifier = Modifier
) {
    SelectionContainer {
        Column(
            modifier = modifier,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            val paragraphs = remember(text) { text.split("\n\n") }
            paragraphs.forEach { para ->
                val trimmed = para.trim()
                when {
                    trimmed.startsWith("# ") -> {
                        Text(
                            text = trimmed.removePrefix("# ").trim(),
                            style = MaterialTheme.typography.headlineSmall.copy(fontWeight = FontWeight.Bold),
                            color = TextPrimaryDark
                        )
                    }
                    trimmed.startsWith("## ") -> {
                        Text(
                            text = trimmed.removePrefix("## ").trim(),
                            style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                            color = MutedIceCyan
                        )
                    }
                    trimmed.startsWith("### ") -> {
                        Text(
                            text = trimmed.removePrefix("### ").trim(),
                            style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = GoldAccent
                        )
                    }
                    trimmed.startsWith("```") -> {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = SurfaceDark,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = trimmed.removeSurrounding("```").trim(),
                                style = MaterialTheme.typography.bodySmall.copy(
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 12.sp
                                ),
                                color = DustySage,
                                modifier = Modifier.padding(12.dp)
                            )
                        }
                    }
                    trimmed.startsWith("- ") || trimmed.startsWith("* ") -> {
                        trimmed.lines().forEach { itemLine ->
                            Row(
                                modifier = Modifier.padding(start = 8.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Text("•", color = MutedIceCyan, fontWeight = FontWeight.Bold)
                                Text(
                                    text = itemLine.removePrefix("- ").removePrefix("* ").trim(),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = TextPrimaryDark
                                )
                            }
                        }
                    }
                    else -> {
                        Text(
                            text = trimmed,
                            style = MaterialTheme.typography.bodyMedium.copy(lineHeight = 22.sp),
                            color = TextSecondaryDark
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CodeViewerWithLineNumbers(
    lines: List<String>,
    modifier: Modifier = Modifier
) {
    val verticalScroll = rememberScrollState()
    val horizontalScroll = rememberScrollState()

    Row(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(verticalScroll)
    ) {
        // Line numbers column
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

        // Code content column (horizontally scrollable)
        SelectionContainer(
            modifier = Modifier
                .weight(1f)
                .horizontalScroll(horizontalScroll)
                .padding(horizontal = 12.dp, vertical = 12.dp)
        ) {
            Column {
                lines.forEach { line ->
                    Text(
                        text = line.ifEmpty { " " },
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
