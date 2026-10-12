package com.autogram.app.features.cloud.grid

/** Density presets mirror the desktop Drive grid's target card widths and soft column caps. */
enum class DriveGridDensity(val targetWidthDp: Int, val maxColumns: Int) {
    EXTRA_SMALL(92, 12),
    SMALL(118, 10),
    MEDIUM(148, 8),
    LARGE(184, 6),
    EXTRA_LARGE(228, 5),
    MAXIMUM(288, 4)
}

data class DriveGridLayout(
    val columns: Int,
    val cardWidthDp: Float,
    val cardHeightDp: Float,
    val rowHeightDp: Float
)

/**
 * Desktop-equivalent column sizing for a responsive container. Widths are dp on Android
 * and CSS px on desktop, which both represent the logical layout coordinate space.
 */
fun computeDriveGridLayout(
    containerWidthDp: Float,
    density: DriveGridDensity,
    gapDp: Float = 10f,
    horizontalPaddingDp: Float = 28f,
    portraitRatio: Float = 2f / 3f
): DriveGridLayout {
    val width = containerWidthDp.takeIf { it.isFinite() && it > 0f } ?: 800f
    val gap = gapDp.takeIf { it.isFinite() && it >= 0f } ?: 10f
    val padding = horizontalPaddingDp.takeIf { it.isFinite() && it >= 0f } ?: 28f
    val inner = maxOf(120f, width - padding)
    val minCard = maxOf(64f, kotlin.math.round(density.targetWidthDp * .55f))
    var columns = kotlin.math.floor((inner + gap) / (density.targetWidthDp + gap))
        .toInt().coerceIn(1, density.maxColumns)
    while (columns > 1 && (inner - gap * (columns - 1)) / columns < minCard - .5f) {
        columns -= 1
    }
    if (inner < 360f && density.ordinal <= DriveGridDensity.MEDIUM.ordinal && columns < 2) {
        if ((inner - gap) / 2f >= 56f) columns = 2
    }
    if (inner < 220f) columns = 1
    val cardWidth = maxOf(48f, (inner - gap * (columns - 1)) / columns)
    val safeRatio = portraitRatio.takeIf { it.isFinite() && it > 0f } ?: 2f / 3f
    val cardHeight = kotlin.math.round(cardWidth / safeRatio)
    return DriveGridLayout(columns, cardWidth, cardHeight, cardHeight + gap)
}

/** Pinch out/in steps match the desktop zoom direction and stop at preset limits. */
fun driveGridDensityAfterPinch(current: DriveGridDensity, scale: Float): DriveGridDensity? {
    if (!scale.isFinite()) return null
    val nextOrdinal = when {
        scale >= 1.20f -> current.ordinal - 1
        scale <= 0.83f -> current.ordinal + 1
        else -> return null
    }.coerceIn(DriveGridDensity.entries.indices)
    return DriveGridDensity.entries[nextOrdinal].takeIf { it != current }
}
