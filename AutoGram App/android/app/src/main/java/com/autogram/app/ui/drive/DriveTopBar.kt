package com.autogram.app.ui.drive

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.ripple.rememberRipple
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*
import com.autogram.app.viewmodel.DriveMediaFilter

@Composable
fun DriveTopBar(
    currentPath: String,
    itemCount: Int,
    selectedCount: Int,
    searchQuery: String,
    onSearchChange: (String) -> Unit,
    mediaFilter: DriveMediaFilter,
    onMediaFilterChange: (DriveMediaFilter) -> Unit,
    isGridView: Boolean,
    onToggleViewMode: () -> Unit,
    onRefresh: () -> Unit,
    onUpload: () -> Unit,
    onClearSelection: () -> Unit,
    onSelectAll: () -> Unit,
    onInvertSelection: () -> Unit,
    onDownloadZip: () -> Unit,
    onCleanForward: () -> Unit,
    onMoveFolder: () -> Unit,
    onCopyLinks: () -> Unit,
    onTagCategory: () -> Unit,
    onDeleteSelected: () -> Unit,
    onOpenTools: () -> Unit = {}
) {
    var isSearchExpanded by remember { mutableStateOf(false) }
    var isSelectionMenuOpen by remember { mutableStateOf(false) }
    var isNormalMenuOpen by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        if (selectedCount > 0) {
            // =========================================================================
            // SELECTION MODE ACTIVE TOP BAR (Matching Stitch Screen: Selection Mode)
            // =========================================================================
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Left: Close (X) + Selection Count
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = rememberRipple(bounded = true, color = GoldAccent)
                            ) { onClearSelection() },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = stringResource(R.string.drive_action_cancel),
                            tint = TextPrimaryDark,
                            modifier = Modifier.size(20.dp)
                        )
                    }

                    Text(
                        text = "$selectedCount dipilih",
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp
                        ),
                        color = GoldAccent
                    )
                }

                // Right: Quick Download + Quick Delete + 3-Dot Bulk Actions Button
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Quick Download Action
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = rememberRipple(bounded = true, color = GoldAccent)
                            ) { onDownloadZip() },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Download,
                            contentDescription = stringResource(R.string.drive_action_download),
                            tint = TextPrimaryDark,
                            modifier = Modifier.size(20.dp)
                        )
                    }

                    // Quick Delete Action
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(CircleShape)
                            .clickable(
                                interactionSource = remember { MutableInteractionSource() },
                                indication = rememberRipple(bounded = true, color = SoftCoral)
                            ) { onDeleteSelected() },
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.DeleteOutline,
                            contentDescription = stringResource(R.string.drive_action_delete),
                            tint = SoftCoral,
                            modifier = Modifier.size(20.dp)
                        )
                    }

                    // 3-Dot Active Button with Dropdown
                    Box {
                        IconButton(
                            onClick = { isSelectionMenuOpen = true },
                            modifier = Modifier
                                .size(36.dp)
                                .background(GoldAccent.copy(alpha = 0.2f), CircleShape)
                                .border(1.dp, GoldAccent.copy(alpha = 0.4f), CircleShape)
                        ) {
                            Icon(
                                imageVector = Icons.Default.MoreVert,
                                contentDescription = "Bulk Actions",
                                tint = GoldAccent,
                                modifier = Modifier.size(20.dp)
                            )
                        }

                        // Floating Frosted Glass Dropdown Menu
                        DropdownMenu(
                            expanded = isSelectionMenuOpen,
                            onDismissRequest = { isSelectionMenuOpen = false },
                            modifier = Modifier
                                .width(230.dp)
                                .background(Color(0xF50B1C30), RoundedCornerShape(16.dp))
                                .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(16.dp))
                        ) {
                            // 1. Pilih Semua
                            DropdownMenuItem(
                                text = {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text(
                                            text = stringResource(R.string.drive_action_select_all),
                                            style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                                            color = TextPrimaryDark
                                        )
                                        Surface(
                                            color = Color(0x33FFFFFF),
                                            shape = CircleShape
                                        ) {
                                            Text(
                                                text = "$itemCount",
                                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                                                color = TextSecondaryDark
                                            )
                                        }
                                    }
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Default.SelectAll,
                                        contentDescription = null,
                                        tint = TextSecondaryDark,
                                        modifier = Modifier.size(18.dp)
                                    )
                                },
                                onClick = {
                                    isSelectionMenuOpen = false
                                    onSelectAll()
                                }
                            )

                            // 2. Balikkan Pilihan
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        text = stringResource(R.string.drive_action_invert_selection),
                                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                                        color = TextPrimaryDark
                                    )
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Default.Deselect,
                                        contentDescription = null,
                                        tint = TextSecondaryDark,
                                        modifier = Modifier.size(18.dp)
                                    )
                                },
                                onClick = {
                                    isSelectionMenuOpen = false
                                    onInvertSelection()
                                }
                            )

                            // 3. Unduh Sebagai ZIP
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        text = stringResource(R.string.drive_action_download_zip),
                                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                                        color = TextPrimaryDark
                                    )
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Default.FolderZip,
                                        contentDescription = null,
                                        tint = GoldAccent,
                                        modifier = Modifier.size(18.dp)
                                    )
                                },
                                onClick = {
                                    isSelectionMenuOpen = false
                                    onDownloadZip()
                                }
                            )

                            // 4. Teruskan Bersih (Clean-Copy)
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        text = stringResource(R.string.drive_action_clean_forward),
                                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                                        color = TextPrimaryDark
                                    )
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Default.Forward,
                                        contentDescription = null,
                                        tint = TextSecondaryDark,
                                        modifier = Modifier.size(18.dp)
                                    )
                                },
                                onClick = {
                                    isSelectionMenuOpen = false
                                    onCleanForward()
                                }
                            )

                            // 5. Pindahkan ke Folder
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        text = stringResource(R.string.drive_action_move_folder),
                                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                                        color = TextPrimaryDark
                                    )
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Default.DriveFileMove,
                                        contentDescription = null,
                                        tint = TextSecondaryDark,
                                        modifier = Modifier.size(18.dp)
                                    )
                                },
                                onClick = {
                                    isSelectionMenuOpen = false
                                    onMoveFolder()
                                }
                            )

                            // 6. Salin Semua Tautan
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        text = stringResource(R.string.drive_action_copy_links),
                                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                                        color = TextPrimaryDark
                                    )
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Default.Link,
                                        contentDescription = null,
                                        tint = TextSecondaryDark,
                                        modifier = Modifier.size(18.dp)
                                    )
                                },
                                onClick = {
                                    isSelectionMenuOpen = false
                                    onCopyLinks()
                                }
                            )

                            // 7. Beri Label Kategori
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        text = stringResource(R.string.drive_action_tag_category),
                                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                                        color = TextPrimaryDark
                                    )
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Default.Label,
                                        contentDescription = null,
                                        tint = TextSecondaryDark,
                                        modifier = Modifier.size(18.dp)
                                    )
                                },
                                onClick = {
                                    isSelectionMenuOpen = false
                                    onTagCategory()
                                }
                            )

                            HorizontalDivider(
                                modifier = Modifier.padding(vertical = 4.dp),
                                color = Color(0x26FFFFFF)
                            )

                            // 8. Hapus Terpilih
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        text = stringResource(R.string.drive_action_delete_selected),
                                        style = MaterialTheme.typography.bodyMedium.copy(
                                            fontSize = 13.5.sp,
                                            fontWeight = FontWeight.SemiBold
                                        ),
                                        color = SoftCoral
                                    )
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Default.DeleteOutline,
                                        contentDescription = null,
                                        tint = SoftCoral,
                                        modifier = Modifier.size(18.dp)
                                    )
                                },
                                onClick = {
                                    isSelectionMenuOpen = false
                                    onDeleteSelected()
                                }
                            )
                        }
                    }
                }
            }
        } else {
            // =========================================================================
            // NORMAL BROWSE TOP BAR (Matching Stitch Screen: Cloud Explorer)
            // =========================================================================
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Left: 🏠 › Telegram Cloud
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.clickable { onRefresh() }
                ) {
                    Icon(
                        imageVector = Icons.Default.Home,
                        contentDescription = null,
                        tint = TextSecondaryDark,
                        modifier = Modifier.size(18.dp)
                    )
                    Text(
                        text = "›",
                        color = TextMutedDark,
                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp)
                    )
                    Text(
                        text = if (currentPath.isBlank() || currentPath == "/") "Telegram Cloud" else currentPath.trimStart('/'),
                        style = MaterialTheme.typography.titleMedium.copy(
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp
                        ),
                        color = TextPrimaryDark
                    )
                }

                // Right: 🔍  +  ➕  +  ⋮
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Search,
                        contentDescription = stringResource(R.string.drive_search_accessibility),
                        tint = TextSecondaryDark,
                        modifier = Modifier
                            .size(20.dp)
                            .clickable { isSearchExpanded = !isSearchExpanded }
                    )
                    Icon(
                        imageVector = Icons.Default.Add,
                        contentDescription = stringResource(R.string.drive_action_upload),
                        tint = TextSecondaryDark,
                        modifier = Modifier
                            .size(22.dp)
                            .clickable { onUpload() }
                    )
                    Box {
                        Icon(
                            imageVector = Icons.Default.MoreVert,
                            contentDescription = stringResource(R.string.drive_toggle_view_accessibility),
                            tint = TextSecondaryDark,
                            modifier = Modifier
                                .size(20.dp)
                                .clickable { isNormalMenuOpen = true }
                        )

                        DropdownMenu(
                            expanded = isNormalMenuOpen,
                            onDismissRequest = { isNormalMenuOpen = false },
                            modifier = Modifier
                                .width(200.dp)
                                .background(Color(0xF50B1C30), RoundedCornerShape(14.dp))
                                .border(1.dp, Color(0x33FFFFFF), RoundedCornerShape(14.dp))
                        ) {
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        text = if (isGridView) "Tampilan Daftar" else "Tampilan Grid",
                                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                                        color = TextPrimaryDark
                                    )
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = if (isGridView) Icons.Default.ViewList else Icons.Default.GridView,
                                        contentDescription = null,
                                        tint = TextSecondaryDark,
                                        modifier = Modifier.size(18.dp)
                                    )
                                },
                                onClick = {
                                    isNormalMenuOpen = false
                                    onToggleViewMode()
                                }
                            )
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        text = stringResource(R.string.tools_title),
                                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                                        color = TextPrimaryDark
                                    )
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Default.Analytics,
                                        contentDescription = null,
                                        tint = GoldAccent,
                                        modifier = Modifier.size(18.dp)
                                    )
                                },
                                onClick = {
                                    isNormalMenuOpen = false
                                    onOpenTools()
                                }
                            )
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        text = stringResource(R.string.drive_action_refresh),
                                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                                        color = TextPrimaryDark
                                    )
                                },
                                leadingIcon = {
                                    Icon(
                                        imageVector = Icons.Default.Refresh,
                                        contentDescription = null,
                                        tint = TextSecondaryDark,
                                        modifier = Modifier.size(18.dp)
                                    )
                                },
                                onClick = {
                                    isNormalMenuOpen = false
                                    onRefresh()
                                }
                            )
                        }
                    }
                }
            }

            // Optional Search Bar when search is expanded
            AnimatedVisibility(visible = isSearchExpanded) {
                TextField(
                    value = searchQuery,
                    onValueChange = onSearchChange,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(44.dp),
                    placeholder = {
                        Text(
                            stringResource(R.string.drive_search_placeholder),
                            style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
                            color = TextMutedDark
                        )
                    },
                    singleLine = true,
                    shape = RoundedCornerShape(10.dp),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = CardNavyBg,
                        unfocusedContainerColor = CardNavyBg,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                        focusedTextColor = TextPrimaryDark,
                        unfocusedTextColor = TextPrimaryDark
                    )
                )
            }
        }

        // Row 2: Filter Pills + Item Count (matching user reference mockup)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState()),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            val filters = listOf(
                DriveMediaFilter.ALL to stringResource(R.string.drive_filter_all),
                DriveMediaFilter.IMAGES to stringResource(R.string.drive_filter_images),
                DriveMediaFilter.VIDEOS to stringResource(R.string.drive_filter_videos),
                DriveMediaFilter.AUDIO to stringResource(R.string.drive_filter_audio),
                DriveMediaFilter.DOCUMENTS to stringResource(R.string.drive_filter_documents)
            )

            filters.forEach { (filter, label) ->
                val isSelected = mediaFilter == filter

                if (isSelected) {
                    // Solid Gold Pill
                    Surface(
                        modifier = Modifier
                            .clip(CircleShape)
                            .clickable { onMediaFilterChange(filter) },
                        shape = CircleShape,
                        color = GoldAccent
                    ) {
                        Text(
                            text = label,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 5.dp),
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = 11.5.sp
                            ),
                            color = CanvasDeepNavy
                        )
                    }
                } else {
                    // Dark Pill
                    Surface(
                        modifier = Modifier
                            .clip(CircleShape)
                            .clickable { onMediaFilterChange(filter) },
                        shape = CircleShape,
                        color = CardNavyBg,
                        border = BorderStroke(1.dp, CardNavyBorder)
                    ) {
                        Text(
                            text = label,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 5.dp),
                            style = MaterialTheme.typography.labelSmall.copy(
                                fontWeight = FontWeight.Medium,
                                fontSize = 11.5.sp
                            ),
                            color = TextSecondaryDark
                        )
                    }
                }
            }

            Spacer(Modifier.width(8.dp))

            // Far-Right: 124 Items Outline Pill
            Surface(
                shape = CircleShape,
                color = Color.Transparent,
                border = BorderStroke(1.dp, GoldAccent.copy(alpha = 0.6f))
            ) {
                Text(
                    text = "$itemCount items",
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
                    style = MaterialTheme.typography.labelSmall.copy(
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 11.sp
                    ),
                    color = GoldAccent
                )
            }
        }
    }
}
