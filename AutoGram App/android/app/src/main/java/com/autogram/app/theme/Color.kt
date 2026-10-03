package com.autogram.app.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// =============================================================================
// AutoGram Compact Modern Palette (Dark Navy & Warm Gold Accent)
// =============================================================================

// Background & Canvas (Deep Obsidian Midnight & Titanium Slate)
val CanvasDeepNavy = Color(0xFF101418)          // Neutral charcoal canvas
val CanvasWarmTitanium = CanvasDeepNavy
val CanvasSecondaryTitanium = Color(0xFF191E23)
val SurfaceDeep = Color(0xFF191E23)
val BgDark = CanvasDeepNavy
val SurfaceDark = SurfaceDeep
val SurfaceElevatedDark = Color(0xFF252B31)

val ObsidianPrimary = CanvasDeepNavy
val ObsidianSecondary = CanvasSecondaryTitanium

// Card & Container Surfaces
val CardNavyBg = SurfaceDeep
val CardNavyBorder = Color(0x26FFFFFF)          // rgba(255,255,255,0.15)
val SurfaceGlass = SurfaceDeep
val SurfaceGlassStrong = SurfaceElevatedDark
val SurfaceGlassSoft = Color(0xFF161B20)
val SurfaceDock = Color(0xFF1B2127)

// Gold & Accent System (Titanium Soft Luxury)
val GoldAccent = Color(0xFFE0C89C)              // Reserved warm status accent
val GoldAccentLight = Color(0xFFFFD27A)
val ChampagneGold = GoldAccent
val ChampagneLight = GoldAccentLight
val MutedIceCyan = Color(0xFFB0CADB)            // Quiet blue-gray primary
val DustySage = Color(0xFFA8C6B1)
val SoftViolet = Color(0xFFA78BFA)              // Video
val WarmAmber = Color(0xFFE9C176)               // Audio / Amber
val SoftCoral = Color(0xFFFFB4AB)               // #FFB4AB Soft Coral Danger

// Semantic Mapping
val NeonCyan = MutedIceCyan
val ElectricBlue = Color(0xFF60A5FA)
val ElectricViolet = SoftViolet
val Emerald = DustySage
val Amber = WarmAmber
val Danger = SoftCoral

val PrimaryBlue = MutedIceCyan
val PrimaryBlueHover = Color(0xFF73E3FF)
val AccentCyan = MutedIceCyan
val AccentAmber = WarmAmber
val AccentViolet = SoftViolet

// Typography
val TextPrimaryDark = Color(0xFFF8FAFC)
val TextSecondaryDark = Color(0xFFADB6BF)
val TextMutedDark = Color(0xFF909AA5)

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
val BorderHairline = Color(0x26ADB6BF)
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
