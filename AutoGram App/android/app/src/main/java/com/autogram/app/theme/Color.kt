package com.autogram.app.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// Obsidian & Ultra-Clean Dark Palette
val ObsidianPrimary = Color(0xFF050811)
val ObsidianSecondary = Color(0xFF090D18)
val SurfaceDeep = Color(0xFF0D1322)
val BgDark = ObsidianPrimary
val SurfaceDark = Color(0xFF0E1526)
val SurfaceElevatedDark = Color(0xFF131D31)

// Refined Glass Surfaces (Lighter, subtle translucent luxury)
val SurfaceGlass = Color(0x990E1627)       // rgba(14, 22, 39, 0.60)
val SurfaceGlassStrong = Color(0xCC0E1627) // rgba(14, 22, 39, 0.80)
val SurfaceGlassSoft = Color(0x59111B30)   // rgba(17, 27, 48, 0.35)
val SurfaceDock = Color(0xD9090F1C)        // rgba(9, 15, 28, 0.85)

// Refined Accent Colors (Sophisticated, non-oversaturated)
val NeonCyan = Color(0xFF00E5FF)
val ElectricBlue = Color(0xFF3B82F6)
val ElectricViolet = Color(0xFF8B5CF6)
val Emerald = Color(0xFF10B981)
val Amber = Color(0xFFF59E0B)
val Danger = Color(0xFFEF4444)

val PrimaryBlue = ElectricBlue
val PrimaryBlueHover = Color(0xFF2563EB)
val AccentCyan = NeonCyan
val AccentAmber = Amber
val AccentViolet = ElectricViolet

// High-Legibility Typography Contrast
val TextPrimaryDark = Color(0xFFFFFFFF)
val TextSecondaryDark = Color(0xFFA0AEC0)
val TextMutedDark = Color(0xFF718096)

// Status & Semantic Colors
val SuccessGreen = Emerald
val WarningAmber = Amber
val ErrorRed = Danger

// Stage Pipeline Colors
val StageScan = ElectricViolet
val StageDownload = NeonCyan
val StageVerify = Color(0xFF14B8A6)
val StageEncode = Amber
val StageUpload = ElectricBlue
val StageCommit = Color(0xFFA855F7)
val StageReconcile = Emerald

// Media Category Colors
val CategoryVideo = ElectricViolet
val CategoryAudio = Amber
val CategoryPhoto = NeonCyan
val CategoryDoc = ElectricBlue
val CategoryArchive = Emerald
val CategoryError = Danger

// Hairline Borders (Ultra-thin & clean)
val BorderHairline = Color(0x14FFFFFF)   // 1px 8% white
val BorderActive = Color(0x4000E5FF)     // 25% cyan
val BorderCyanGlow = Color(0x5500E5FF)   // 33% cyan glow
val BorderDark = Color(0x1AFFFFFF)

// Reusable Gradient Brushes
val CyanToBlueBrush = Brush.horizontalGradient(
    colors = listOf(NeonCyan, ElectricBlue)
)

val BlueToVioletBrush = Brush.horizontalGradient(
    colors = listOf(ElectricBlue, ElectricViolet)
)

val EmeraldToCyanBrush = Brush.horizontalGradient(
    colors = listOf(Emerald, NeonCyan)
)

val AmberToOrangeBrush = Brush.horizontalGradient(
    colors = listOf(Amber, Color(0xFFEA580C))
)

val GlassBorderBrush = Brush.linearGradient(
    colors = listOf(
        Color(0x2EFFFFFF),
        Color(0x08FFFFFF),
        Color(0x1F00E5FF)
    )
)

val ActiveGlassBorderBrush = Brush.linearGradient(
    colors = listOf(
        NeonCyan,
        ElectricBlue,
        Color(0x338B5CF6)
    )
)

val AmbientBackgroundBrush = Brush.radialGradient(
    colors = listOf(
        Color(0x1400E5FF), // Soft Cyan Bloom
        Color(0x0A3B82F6), // Soft Blue Bloom
        Color.Transparent
    ),
    radius = 1400f
)

// Light theme fallback counterparts
val BgLight = Color(0xFFF9FAFB)
val SurfaceLight = Color(0xFFFFFFFF)
val SurfaceElevatedLight = Color(0xFFF3F4F6)
val BorderLight = Color(0xFFE5E7EB)
val TextPrimaryLight = Color(0xFF111827)
val TextSecondaryLight = Color(0xFF4B5563)
