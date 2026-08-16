package com.autogram.app.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class DriveFileItem(
    val id: String,
    val name: String,
    val size: Long,
    val mimeType: String,
    val isFolder: Boolean,
    val modifiedMs: Long,
    val thumbnailUri: String? = null
)

data class DriveUiState(
    val currentPath: String = "/",
    val searchQuery: String = "",
    val isGridView: Boolean = true,
    val isLoading: Boolean = false,
    val items: List<DriveFileItem> = emptyList(),
    val selectedIds: Set<String> = emptySet()
)

class DriveViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(DriveUiState())
    val uiState: StateFlow<DriveUiState> = _uiState.asStateFlow()

    init {
        loadFolder("/")
    }

    fun loadFolder(path: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, currentPath = path, selectedIds = emptySet()) }
            // Mock sample items for demonstration
            val sampleItems = listOf(
                DriveFileItem("1", "Dokumen Kurikulum 2026", 0, "folder", true, System.currentTimeMillis() - 86400000),
                DriveFileItem("2", "Rekaman_Video_Belajar.mp4", 104857600, "video/mp4", false, System.currentTimeMillis() - 3600000),
                DriveFileItem("3", "Modul_Pembelajaran_Murid.pdf", 4194304, "application/pdf", false, System.currentTimeMillis() - 7200000),
                DriveFileItem("4", "Foto_Kegiatan_Praktikum.jpg", 2097152, "image/jpeg", false, System.currentTimeMillis() - 10800000)
            )
            _uiState.update { it.copy(isLoading = false, items = sampleItems) }
        }
    }

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    fun toggleViewMode() {
        _uiState.update { it.copy(isGridView = !it.isGridView) }
    }

    fun toggleItemSelection(id: String) {
        _uiState.update { current ->
            val updated = current.selectedIds.toMutableSet()
            if (updated.contains(id)) {
                updated.remove(id)
            } else {
                updated.add(id)
            }
            current.copy(selectedIds = updated)
        }
    }

    fun clearSelection() {
        _uiState.update { it.copy(selectedIds = emptySet()) }
    }

    fun deleteSelected() {
        _uiState.update { current ->
            val remaining = current.items.filterNot { current.selectedIds.contains(it.id) }
            current.copy(items = remaining, selectedIds = emptySet())
        }
    }
}
