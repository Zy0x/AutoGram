package com.autogram.app.ui.drive.preview

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.TableChart
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.ui.components.AutoGramGlassCard

@Composable
fun DriveTabularViewer(
    rawText: String,
    fileName: String,
    modifier: Modifier = Modifier
) {
    var searchQuery by remember { mutableStateOf("") }

    val isTsv = remember(fileName, rawText) {
        fileName.endsWith(".tsv", ignoreCase = true) || (!rawText.contains(",") && rawText.contains("\t"))
    }

    val parsedRows = remember(rawText, isTsv) {
        parseDelimited(rawText, if (isTsv) '\t' else ',')
    }

    val headers = remember(parsedRows) {
        parsedRows.firstOrNull() ?: emptyList()
    }

    val dataRows = remember(parsedRows) {
        if (parsedRows.size > 1) parsedRows.drop(1) else emptyList()
    }

    val filteredRows = remember(dataRows, searchQuery) {
        if (searchQuery.isBlank()) dataRows
        else dataRows.filter { row ->
            row.any { cell -> cell.contains(searchQuery, ignoreCase = true) }
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(12.dp)
            .testTag("tabular-viewer"),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Toolbar: file info & badges
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.TableChart, null, tint = SoftViolet, modifier = Modifier.size(20.dp))
                Text(
                    text = stringResource(R.string.preview_tabular_title),
                    style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                    color = TextPrimaryDark
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = SoftViolet.copy(alpha = 0.15f)
                ) {
                    Text(
                        text = stringResource(R.string.preview_tabular_rows, parsedRows.size),
                        style = MaterialTheme.typography.labelSmall,
                        color = SoftViolet,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = DustySage.copy(alpha = 0.15f)
                ) {
                    Text(
                        text = stringResource(R.string.preview_tabular_cols, headers.size),
                        style = MaterialTheme.typography.labelSmall,
                        color = DustySage,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
            }
        }

        // Search filter
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            placeholder = { Text(stringResource(R.string.preview_tabular_search)) },
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

        // Scrollable Table Surface
        val hScrollState = rememberScrollState()
        AutoGramGlassCard(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .horizontalScroll(hScrollState)
            ) {
                LazyColumn(
                    modifier = Modifier.fillMaxHeight(),
                    contentPadding = PaddingValues(bottom = 16.dp)
                ) {
                    // Header Row
                    item {
                        Row(
                            modifier = Modifier
                                .background(SurfaceElevatedDark)
                                .padding(vertical = 8.dp)
                        ) {
                            // Row number col
                            TableCell(
                                text = "#",
                                isHeader = true,
                                width = 48.dp
                            )
                            headers.forEachIndexed { colIdx, header ->
                                TableCell(
                                    text = header.ifBlank { "Kolom ${colIdx + 1}" },
                                    isHeader = true,
                                    width = 140.dp
                                )
                            }
                        }
                        HorizontalDivider(color = BorderHairline)
                    }

                    // Data Rows
                    itemsIndexed(filteredRows) { idx, row ->
                        val isEven = idx % 2 == 0
                        Row(
                            modifier = Modifier
                                .background(if (isEven) SurfaceDeep.copy(alpha = 0.5f) else SurfaceElevatedDark.copy(alpha = 0.25f))
                                .padding(vertical = 6.dp)
                        ) {
                            TableCell(
                                text = (idx + 1).toString(),
                                isHeader = false,
                                isIndex = true,
                                width = 48.dp
                            )
                            headers.indices.forEach { colIdx ->
                                val cellVal = row.getOrNull(colIdx) ?: ""
                                TableCell(
                                    text = cellVal,
                                    isHeader = false,
                                    width = 140.dp
                                )
                            }
                        }
                        HorizontalDivider(color = BorderHairline.copy(alpha = 0.3f))
                    }
                }
            }
        }
    }
}

@Composable
private fun TableCell(
    text: String,
    isHeader: Boolean,
    isIndex: Boolean = false,
    width: androidx.compose.ui.unit.Dp
) {
    Box(
        modifier = Modifier
            .width(width)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        contentAlignment = if (isIndex) Alignment.Center else Alignment.CenterStart
    ) {
        Text(
            text = text,
            style = if (isHeader) {
                MaterialTheme.typography.labelMedium.copy(
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.sp,
                    fontFamily = FontFamily.Monospace
                )
            } else {
                MaterialTheme.typography.bodySmall.copy(
                    fontSize = 11.5.sp,
                    fontFamily = if (isIndex) FontFamily.Monospace else FontFamily.Default
                )
            },
            color = when {
                isHeader -> SoftViolet
                isIndex -> TextMutedDark
                else -> TextPrimaryDark
            },
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )
    }
}

private fun parseDelimited(content: String, delimiter: Char): List<List<String>> {
    val lines = content.lines().filter { it.isNotBlank() }
    val result = mutableListOf<List<String>>()

    lines.take(500).forEach { line ->
        val cells = mutableListOf<String>()
        val sb = StringBuilder()
        var inQuotes = false

        for (c in line) {
            when {
                c == '"' -> inQuotes = !inQuotes
                c == delimiter && !inQuotes -> {
                    cells.add(sb.toString().trim())
                    sb.clear()
                }
                else -> sb.append(c)
            }
        }
        cells.add(sb.toString().trim())
        result.add(cells)
    }
    return result
}
