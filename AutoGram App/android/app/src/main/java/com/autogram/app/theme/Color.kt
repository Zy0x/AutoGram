package com.autogram.app.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// =============================================================================
// AutoGram Compact Modern Palette (Dark Navy & Warm Gold Accent)
// =============================================================================

// Background & Canvas (Deep Navy Obsidian)
val CanvasDeepNavy = Color(0xFF090E17)          // #090E17 Main dark canvas
val CanvasWarmTitanium = CanvasDeepNavy
val CanvasSecondaryTitanium = Color(0xFF0E1624)
val SurfaceDeep = Color(0xFF0F1827)
val BgDark = CanvasDeepNavy
val SurfaceDark = Color(0xFF131D2E)
val SurfaceElevatedDark = Color(0xFF19253B)

val ObsidianPrimary = CanvasDeepNavy
val ObsidianSecondary = CanvasSecondaryTitanium

// Card & Container Surfaces
val CardNavyBg = Color(0xFF121C2D)              // #121C2D Card background
val CardNavyBorder = Color(0xFF1E2D44)          // #1E2D44 Card border
val SurfaceGlass = Color(0xD9121C2D)
val SurfaceGlassStrong = Color(0xF2121C2D)
val SurfaceGlassSoft = Color(0x66121C2D)
val SurfaceDock = Color(0xF20F1726)

// Gold & Accent System (Matching user reference mockup)
val GoldAccent = Color(0xFFE5A93C)              // #E5A93C Amber Gold
val GoldAccentLight = Color(0xFFFBD38D)
val ChampagneGold = GoldAccent
val ChampagneLight = GoldAccentLight
val MutedIceCyan = Color(0xFF38BDF8)            // Cyan folder & image accent
val DustySage = Color(0xFF34D399)               // Success & live
val SoftViolet = Color(0xFFA78BFA)              // Video
val WarmAmber = Color(0xFFFBBF24)               // Audio
val SoftCoral = Color(0xFFF87171)               // Danger

// Semantic Mapping
val NeonCyan = MutedIceCyan
val ElectricBlue = Color(0xFF60A5FA)
val ElectricViolet = SoftViolet
val Emerald = DustySage
val Amber = WarmAmber
val Danger = SoftCoral

val PrimaryBlue = GoldAccent
val PrimaryBlueHover = GoldAccentLight
val AccentCyan = MutedIceCyan
val AccentAmber = WarmAmber
val AccentViolet = SoftViolet

// Typography
val TextPrimaryDark = Color(0xFFF8FAFC)
val TextSecondaryDark = Color(0xFF8CA0B8)
val TextMutedDark = Color(0xFF5C6F84)

// Status & Pipeline Colors
val SuccessGreen = DustySage
val WarningAmber = WarmAmber
val ErrorRed = SoftCoral

val StageScan = SoftViolet
val StageDownload = MutedIceCyan
val StageVerify = Color(0xFF2DD4BF)
val StageEncode = WarmAmber
val StageUpload = GoldAccent
val StageCommit = Color(0xFFC084FC)
val StageReconcile = DustySage

// Category Colors
val CategoryVideo = SoftViolet
val CategoryAudio = WarmAmber
val CategoryPhoto = MutedIceCyan
val CategoryDoc = ElectricBlue
val CategoryArchive = DustySage
val CategoryError = SoftCoral

// Hairline Borders
val BorderHairline = Color(0x1F38BDF8)
val BorderActive = Color(0x80E5A93C)
val BorderCyanGlow = Color(0x4038BDF8)
val BorderDark = CardNavyBorder

// Gradient Brushes
val ChampagneToCyanBrush = Brush.horizontalGradient(
    colors = listOf(GoldAccent, MutedIceCyan)
)

val CyanToBlueBrush = Brush.horizontalGradient(
    colors = listOf(GoldAccent, MutedIceCyan)
)

val BlueToVioletBrush = Brush.horizontalGradient(
    colors = listOf(ElectricBlue, SoftViolet)
)

val EmeraldToCyanBrush = Brush.horizontalGradient(
    colors = listOf(DustySage, MutedIceCyan)
)

val AmberToOrangeBrush = Brush.horizontalGradient(
    colors = listOf(WarmAmber, Color(0xFFFB923C))
)

val GlassBorderBrush = Brush.linearGradient(
    colors = listOf(
        Color(0x3338BDF8),
        Color(0x1AFFFFFF),
        Color(0x33E5A93C)
    )
)

val ActiveGlassBorderBrush = Brush.linearGradient(
    colors = listOf(
        GoldAccent,
        MutedIceCyan,
        Color(0x33A78BFA)
    )
)

val AmbientBackgroundBrush = Brush.radialGradient(
    colors = listOf(
        Color(0x0DE5A93C),
        Color(0x0A38BDF8),
        Color.Transparent
    ),
    radius = 1500f
)

// Light theme fallback counterparts
val BgLight = Color(0xFFFBF9F5)
val SurfaceLight = Color(0xFFFFFFFF)
val SurfaceElevatedLight = Color(0xFFF5F2EB)
val BorderLight = Color(0xFFE6E0D5)
val TextPrimaryLight = Color(0xFF1A1917)
val TextSecondaryLight = Color(0xFF78716C)
