package com.autogram.app.ui.drive

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Label
import androidx.compose.material.icons.filled.LocalOffer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.autogram.app.R
import com.autogram.app.theme.*

private data class CategoryOption(val id: String, val label: String, val color: Color)

@Composable
fun DriveTagCategoryModal(
    selectedCount: Int,
    onApply: (category: String, tag: String) -> Unit = { _, _ -> },
    onDismiss: () -> Unit
) {
    val categories = remember {
        listOf(
            CategoryOption("pribadi", "Pribadi", MutedIceCyan),
            CategoryOption("pekerjaan", "Pekerjaan", DustySage),
            CategoryOption("penting", "Penting", SoftCoral),
            CategoryOption("arsip", "Arsip", SoftViolet),
            CategoryOption("favorit", "Favorit", Color(0xFFFFB74D))
        )
    }
    var selectedCategory by remember { mutableStateOf("pribadi") }
    var customTag by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = MutedIceCyan.copy(alpha = 0.15f),
                modifier = Modifier.size(48.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Default.Label,
                        contentDescription = null,
                        tint = MutedIceCyan,
                        modifier = Modifier.size(26.dp)
                    )
                }
            }
        },
        title = {
            Text(
                text = stringResource(R.string.drive_tag_title),
                style = MaterialTheme.typography.titleLarge.copy(
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp
                ),
                color = TextPrimaryDark
            )
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text(
                    text = stringResource(R.string.drive_tag_select, selectedCount),
                    style = MaterialTheme.typography.bodySmall,
                    color = TextSecondaryDark
                )

                // Category Chips
                Text(
                    text = "Pilih Kategori Utama:",
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = TextPrimaryDark
                )
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    items(categories) { cat ->
                        val isSelected = selectedCategory == cat.id
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = if (isSelected) cat.color.copy(alpha = 0.2f) else SurfaceElevatedDark,
                            border = BorderStroke(1.dp, if (isSelected) cat.color else BorderHairline),
                            modifier = Modifier.clickable { selectedCategory = cat.id }
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Surface(
                                    shape = RoundedCornerShape(4.dp),
                                    color = cat.color,
                                    modifier = Modifier.size(8.dp)
                                ) {}
                                Text(
                                    text = cat.label,
                                    style = MaterialTheme.typography.labelSmall.copy(
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                    ),
                                    color = if (isSelected) cat.color else TextSecondaryDark
                                )
                            }
                        }
                    }
                }

                // Custom Tag text field
                OutlinedTextField(
                    value = customTag,
                    onValueChange = { customTag = it },
                    label = { Text("Tag Kustom (opsional, misal: #kerja)") },
                    leadingIcon = { Icon(Icons.Default.LocalOffer, null, tint = SoftViolet) },
                    singleLine = true,
                    shape = RoundedCornerShape(12.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = SoftViolet,
                        unfocusedBorderColor = BorderHairline,
                        focusedTextColor = TextPrimaryDark,
                        unfocusedTextColor = TextPrimaryDark
                    ),
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onApply(selectedCategory, customTag.trim())
                    onDismiss()
                },
                colors = ButtonDefaults.buttonColors(
                    containerColor = MutedIceCyan,
                    contentColor = SurfaceDeep
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.heightIn(min = 44.dp)
            ) {
                Text(
                    text = stringResource(R.string.drive_tag_apply),
                    fontWeight = FontWeight.Bold
                )
            }
        },
        dismissButton = {
            OutlinedButton(
                onClick = onDismiss,
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.heightIn(min = 44.dp)
            ) {
                Text(stringResource(R.string.drive_action_cancel))
            }
        },
        shape = RoundedCornerShape(20.dp),
        containerColor = SurfaceDeep
    )
}
