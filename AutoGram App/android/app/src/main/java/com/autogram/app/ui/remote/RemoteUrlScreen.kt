package com.autogram.app.ui.remote

import android.widget.Toast
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.ui.platform.LocalClipboardManager
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
import com.autogram.app.ui.components.ScreenHeader
import com.autogram.app.ui.drive.formatFileSize
import com.autogram.app.viewmodel.*

@Composable
fun RemoteUrlScreen(
    viewModel: RemoteUrlViewModel,
    onOpenLocalDownloads: () -> Unit,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val clipboardManager = LocalClipboardManager.current

    AutoGramSurface(modifier) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .imePadding()
                .padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 96.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            ScreenHeader(R.string.remote_title, R.string.remote_subtitle)

            // Top Segmented Tabs: Resolver vs Crawler
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                TabPill(
                    selected = state.tab == RemoteScreenTab.RESOLVER,
                    icon = Icons.Default.Link,
                    label = stringResource(R.string.remote_tab_resolver),
                    onClick = { viewModel.setTab(RemoteScreenTab.RESOLVER) },
                    modifier = Modifier.weight(1f)
                )
                TabPill(
                    selected = state.tab == RemoteScreenTab.CRAWLER,
                    icon = Icons.Default.TravelExplore,
                    label = stringResource(R.string.remote_tab_crawler),
                    onClick = { viewModel.setTab(RemoteScreenTab.CRAWLER) },
                    modifier = Modifier.weight(1f)
                )
            }

            when (state.tab) {
                RemoteScreenTab.RESOLVER -> {
                    ResolverContent(
                        state = state,
                        viewModel = viewModel,
                        onPaste = {
                            val clip = clipboardManager.getText()?.toString()?.trim()
                            if (!clip.isNullOrBlank()) viewModel.updateUrl(clip)
                        },
                        onOpenDownloads = onOpenLocalDownloads
                    )
                }
                RemoteScreenTab.CRAWLER -> {
                    CrawlerContent(
                        state = state,
                        viewModel = viewModel
                    )
                }
            }
        }
    }
}

@Composable
private fun TabPill(
    selected: Boolean,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        selected = selected,
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        color = if (selected) SoftViolet.copy(alpha = 0.22f) else SurfaceElevatedDark,
        border = BorderStroke(1.dp, if (selected) SoftViolet else BorderHairline),
        modifier = modifier.heightIn(min = 44.dp)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = if (selected) SoftViolet else TextMutedDark,
                modifier = Modifier.size(18.dp)
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.titleSmall.copy(
                    fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium,
                    fontSize = 13.sp
                ),
                color = if (selected) TextPrimaryDark else TextSecondaryDark
            )
        }
    }
}

@Composable
private fun ResolverContent(
    state: RemoteUrlUiState,
    viewModel: RemoteUrlViewModel,
    onPaste: () -> Unit,
    onOpenDownloads: () -> Unit
) {
    val context = LocalContext.current

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Mode Switch: Single URL vs Batch
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilterChip(
                    selected = state.mode == ResolverMode.SINGLE,
                    onClick = { viewModel.setMode(ResolverMode.SINGLE) },
                    label = { Text(stringResource(R.string.remote_mode_single)) },
                    modifier = Modifier.heightIn(min = 44.dp)
                )
                FilterChip(
                    selected = state.mode == ResolverMode.BATCH,
                    onClick = { viewModel.setMode(ResolverMode.BATCH) },
                    label = { Text(stringResource(R.string.remote_mode_batch)) },
                    modifier = Modifier.heightIn(min = 44.dp)
                )
                Spacer(Modifier.weight(1f))
                IconButton(
                    onClick = onOpenDownloads,
                    modifier = Modifier.size(44.dp)
                ) {
                    Icon(
                        Icons.Default.Download,
                        contentDescription = stringResource(R.string.remote_open_local),
                        tint = SoftViolet
                    )
                }
            }
        }

        if (state.mode == ResolverMode.SINGLE) {
            item {
                AutoGramGlassCard(modifier = Modifier.fillMaxWidth()) {
                    OutlinedTextField(
                        value = state.url,
                        onValueChange = viewModel::updateUrl,
                        label = { Text(stringResource(R.string.remote_input_label)) },
                        placeholder = { Text(stringResource(R.string.remote_input_placeholder)) },
                        singleLine = true,
                        trailingIcon = {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                if (state.url.isNotBlank()) {
                                    IconButton(onClick = { viewModel.updateUrl("") }, modifier = Modifier.size(40.dp)) {
                                        Icon(Icons.Default.Clear, null, tint = TextMutedDark)
                                    }
                                }
                                IconButton(onClick = onPaste, modifier = Modifier.size(40.dp)) {
                                    Icon(Icons.Default.ContentPaste, null, tint = SoftViolet)
                                }
                            }
                        },
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(Modifier.height(10.dp))

                    // Platform detected badge
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = SoftViolet.copy(alpha = 0.15f)
                        ) {
                            Text(
                                text = stringResource(state.platformRes),
                                style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.SemiBold),
                                color = SoftViolet,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }
                        if (state.host != null) {
                            Text(
                                text = stringResource(R.string.remote_source_host, state.host!!),
                                style = MaterialTheme.typography.bodySmall,
                                color = TextMutedDark
                            )
                        }
                    }
                }
            }

            // Quality & Formats
            item {
                AutoGramGlassCard(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = stringResource(R.string.remote_quality_title),
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold)
                    )
                    Spacer(Modifier.height(10.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        RemoteFormat.values().forEach { fmt ->
                            val isSel = state.selectedFormat == fmt
                            Surface(
                                selected = isSel,
                                onClick = { viewModel.selectFormat(fmt) },
                                shape = RoundedCornerShape(10.dp),
                                color = if (isSel) SoftViolet.copy(alpha = 0.25f) else SurfaceElevatedDark,
                                border = BorderStroke(1.dp, if (isSel) SoftViolet else BorderHairline),
                                modifier = Modifier
                                    .weight(1f)
                                    .heightIn(min = 44.dp)
                            ) {
                                Column(
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 8.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally
                                ) {
                                    Text(
                                        text = fmt.badge,
                                        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
                                        color = if (isSel) TextPrimaryDark else TextSecondaryDark
                                    )
                                    Text(
                                        text = fmt.ext.uppercase(),
                                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                                        color = if (isSel) SoftViolet else TextMutedDark
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Clean-Copy Settings
            item {
                AutoGramGlassCard(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = stringResource(R.string.remote_clean_copy_title),
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold)
                    )
                    Spacer(Modifier.height(6.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = stringResource(R.string.remote_option_strip_caption),
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondaryDark
                        )
                        Switch(
                            checked = state.stripCaption,
                            onCheckedChange = viewModel::setStripCaption
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = stringResource(R.string.remote_option_dedup),
                            style = MaterialTheme.typography.bodySmall,
                            color = TextSecondaryDark
                        )
                        Switch(
                            checked = state.dedupCheck,
                            onCheckedChange = viewModel::setDedupCheck
                        )
                    }
                }
            }

            // Dual Action Buttons
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedButton(
                        onClick = {
                            viewModel.enqueueSingleDownload(context) { ok, msg ->
                                Toast.makeText(
                                    context,
                                    if (ok) context.getString(R.string.remote_toast_download_queued) else msg,
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                        },
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(Icons.Default.Download, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(R.string.remote_action_download_local), fontSize = 12.sp)
                    }

                    Button(
                        onClick = {
                            viewModel.enqueueSingleUpload { ok, msg ->
                                Toast.makeText(
                                    context,
                                    if (ok) context.getString(R.string.remote_toast_upload_queued) else msg,
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                        },
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = SoftViolet)
                    ) {
                        Icon(Icons.Default.CloudUpload, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(R.string.remote_action_upload_cloud), fontSize = 12.sp)
                    }
                }
            }
        } else {
            // Batch Mode
            item {
                AutoGramGlassCard(modifier = Modifier.fillMaxWidth()) {
                    OutlinedTextField(
                        value = state.batchText,
                        onValueChange = viewModel::updateBatchText,
                        label = { Text(stringResource(R.string.remote_batch_input_label)) },
                        placeholder = { Text(stringResource(R.string.remote_batch_input_placeholder)) },
                        minLines = 4,
                        maxLines = 8,
                        shape = RoundedCornerShape(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(8.dp))
                    Text(
                        text = stringResource(R.string.remote_batch_count, state.batchUrls.size),
                        style = MaterialTheme.typography.labelSmall,
                        color = SoftViolet
                    )
                }
            }

            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedButton(
                        onClick = {
                            viewModel.enqueueBatchDownload(context) { count ->
                                Toast.makeText(
                                    context,
                                    context.getString(R.string.remote_toast_batch_queued, count),
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                        },
                        enabled = state.batchUrls.isNotEmpty(),
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(stringResource(R.string.remote_action_batch_download, state.batchUrls.size), fontSize = 12.sp)
                    }

                    Button(
                        onClick = {
                            viewModel.enqueueBatchUpload { count ->
                                Toast.makeText(
                                    context,
                                    context.getString(R.string.remote_toast_batch_queued, count),
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                        },
                        enabled = state.batchUrls.isNotEmpty(),
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = SoftViolet)
                    ) {
                        Text(stringResource(R.string.remote_action_batch_upload, state.batchUrls.size), fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun CrawlerContent(
    state: RemoteUrlUiState,
    viewModel: RemoteUrlViewModel
) {
    val context = LocalContext.current

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Target Website Input
        item {
            AutoGramGlassCard(modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = state.crawlerUrl,
                    onValueChange = viewModel::updateCrawlerUrl,
                    label = { Text(stringResource(R.string.crawler_url_label)) },
                    placeholder = { Text(stringResource(R.string.crawler_url_placeholder)) },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                )

                Spacer(Modifier.height(10.dp))

                // Media Kind Filter Chips
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    CrawlerKind.values().forEach { kind ->
                        val isSel = state.crawlerFilterKind == kind
                        FilterChip(
                            selected = isSel,
                            onClick = { viewModel.setCrawlerFilterKind(kind) },
                            label = {
                                Text(
                                    when (kind) {
                                        CrawlerKind.ALL -> stringResource(R.string.crawler_filter_all)
                                        CrawlerKind.IMAGE -> stringResource(R.string.crawler_filter_images)
                                        CrawlerKind.VIDEO -> stringResource(R.string.crawler_filter_videos)
                                        CrawlerKind.AUDIO -> stringResource(R.string.crawler_filter_audio)
                                        CrawlerKind.DOCUMENT -> stringResource(R.string.crawler_filter_docs)
                                    },
                                    fontSize = 11.sp
                                )
                            },
                            modifier = Modifier.heightIn(min = 36.dp)
                        )
                    }
                }

                Spacer(Modifier.height(10.dp))

                // Action Button: Start or Stop
                Button(
                    onClick = {
                        if (state.isCrawling) viewModel.stopCrawling() else viewModel.startCrawling()
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp),
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (state.isCrawling) MaterialTheme.colorScheme.error else SoftViolet
                    )
                ) {
                    if (state.isCrawling) {
                        CircularProgressIndicator(color = Color.White, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.crawler_action_stop))
                    } else {
                        Icon(Icons.Default.TravelExplore, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.crawler_action_start))
                    }
                }
            }
        }

        // Discovery Results Header
        if (state.crawledEntries.isNotEmpty()) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = stringResource(
                            R.string.crawler_discovered_count,
                            state.crawledEntries.size,
                            state.selectedEntries.size
                        ),
                        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                        color = TextPrimaryDark
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = viewModel::selectAllEntries) {
                            Text(stringResource(R.string.crawler_select_all), fontSize = 12.sp)
                        }
                        TextButton(onClick = viewModel::deselectAllEntries) {
                            Text(stringResource(R.string.crawler_deselect_all), fontSize = 12.sp)
                        }
                    }
                }
            }

            // Results List
            items(state.crawledEntries, key = { it.id }) { item ->
                val isSelected = item.id in state.selectedEntries
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = SurfaceElevatedDark,
                    border = BorderStroke(1.dp, if (isSelected) SoftViolet else BorderHairline),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { viewModel.toggleEntrySelection(item.id) }
                ) {
                    Row(
                        modifier = Modifier.padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Checkbox(
                            checked = isSelected,
                            onCheckedChange = { viewModel.toggleEntrySelection(item.id) },
                            modifier = Modifier.size(24.dp)
                        )
                        Icon(
                            imageVector = when (item.kind) {
                                CrawlerKind.IMAGE -> Icons.Default.Image
                                CrawlerKind.VIDEO -> Icons.Default.Movie
                                CrawlerKind.AUDIO -> Icons.Default.MusicNote
                                else -> Icons.Default.InsertDriveFile
                            },
                            contentDescription = null,
                            tint = SoftViolet,
                            modifier = Modifier.size(20.dp)
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = item.name,
                                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                color = TextPrimaryDark
                            )
                            Text(
                                text = item.url,
                                style = MaterialTheme.typography.labelSmall,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                color = TextMutedDark
                            )
                        }
                    }
                }
            }

            // Batch Actions for Crawled Media
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedButton(
                        onClick = {
                            viewModel.downloadSelectedCrawled(context) { count ->
                                Toast.makeText(
                                    context,
                                    context.getString(R.string.remote_toast_batch_queued, count),
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                        },
                        enabled = state.selectedEntries.isNotEmpty(),
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(
                            stringResource(R.string.crawler_download_selected, state.selectedEntries.size),
                            fontSize = 11.sp
                        )
                    }

                    Button(
                        onClick = {
                            viewModel.uploadSelectedCrawled { count ->
                                Toast.makeText(
                                    context,
                                    context.getString(R.string.remote_toast_batch_queued, count),
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                        },
                        enabled = state.selectedEntries.isNotEmpty(),
                        modifier = Modifier
                            .weight(1f)
                            .heightIn(min = 48.dp),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = SoftViolet)
                    ) {
                        Text(
                            stringResource(R.string.crawler_upload_selected, state.selectedEntries.size),
                            fontSize = 11.sp
                        )
                    }
                }
            }
        } else if (!state.isCrawling) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(24.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = stringResource(R.string.crawler_empty),
                        style = MaterialTheme.typography.bodySmall,
                        color = TextMutedDark
                    )
                }
            }
        }
    }
}
