package com.autogram.app.ui.studio
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.autogram.app.ui.drive.FileGridItem
import com.autogram.app.viewmodel.DriveFileItem

@Composable
fun StudioMediaCard23(item: DriveFileItem, isSelected: Boolean, onClick: () -> Unit,
    onLongClick: () -> Unit, modifier: Modifier = Modifier) {
    FileGridItem(item, isSelected, onClick, onLongClick, modifier)
}
