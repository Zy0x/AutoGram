package com.autogram.app.features.cloudtransfer.upload

import uniffi.autogram_android_bridge.NativeAlbumPacking
import uniffi.autogram_android_bridge.NativeTransferSettings

internal data class PhotoAlbumPackingPlan(val groupSizes: List<Int>, val separateItems: Int)

/** Photo-only subset of the desktop album partition contract; Telegram caps each group at ten. */
internal fun planPhotoAlbumPacking(total: Int, settings: NativeTransferSettings): PhotoAlbumPackingPlan {
    require(total >= 0)
    if (total == 0) return PhotoAlbumPackingPlan(emptyList(), 0)
    val target = when (settings.albumPacking) {
        // The desktop Smart Adaptive policy uses full ten-photo groups. Its
        // legacy Balanced value is the same policy for photos (balancing is
        // reserved for video albums, which this picker does not admit).
        NativeAlbumPacking.SMART_ADAPTIVE, NativeAlbumPacking.MAXIMUM,
        NativeAlbumPacking.FOLLOW_SELECTION, NativeAlbumPacking.BALANCED -> 10
        NativeAlbumPacking.CUSTOM -> settings.albumGroupSize.toInt().coerceIn(2, 10)
        NativeAlbumPacking.NEVER -> 1
    }
    if (target == 1) return PhotoAlbumPackingPlan(emptyList(), total)

    val sizes = mutableListOf<Int>()
    var remaining = total
    while (remaining > target) {
        sizes += target
        remaining -= target
    }
    if (remaining > 0) sizes += remaining
    if (settings.albumAvoidSingle && sizes.size >= 2 && sizes.last() == 1) {
        val donor = sizes.lastIndex - 1
        if (sizes[donor] > 2) {
            sizes[donor] -= 1
            sizes[sizes.lastIndex] = 2
        }
    }
    return PhotoAlbumPackingPlan(sizes.filter { it >= 2 }, sizes.count { it == 1 })
}
