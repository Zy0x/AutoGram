package com.autogram.app.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// =============================================================================
// AutoGram Compact Modern Palette (Dark Navy & Warm Gold Accent)
// =============================================================================

// Background & Canvas (Deep Obsidian Midnight & Titanium Slate)
val CanvasDeepNavy = Color(0xFF031427)          // #031427 Main dark canvas
val CanvasWarmTitanium = CanvasDeepNavy
val CanvasSecondaryTitanium = Color(0xFF0C0F17) // #0C0F17 Container
val SurfaceDeep = Color(0xFF08162B)
val BgDark = CanvasDeepNavy
val SurfaceDark = Color(0xFF0C0F17)
val SurfaceElevatedDark = Color(0xFF102034)     // #102034 Elevated surface

val ObsidianPrimary = CanvasDeepNavy
val ObsidianSecondary = CanvasSecondaryTitanium

// Card & Container Surfaces
val CardNavyBg = Color(0xFF102034)              // #102034 Card background
val CardNavyBorder = Color(0x26FFFFFF)          // rgba(255,255,255,0.15)
val SurfaceGlass = Color(0xD9102034)
val SurfaceGlassStrong = Color(0xF2102034)
val SurfaceGlassSoft = Color(0x66102034)
val SurfaceDock = Color(0xF20B1C30)             // #0B1C30 Dock

// Gold & Accent System (Titanium Soft Luxury)
val GoldAccent = Color(0xFFE9C176)              // #E9C176 Champagne Ochre
val GoldAccentLight = Color(0xFFFFDEA5)
val ChampagneGold = GoldAccent
val ChampagneLight = GoldAccentLight
val MutedIceCyan = Color(0xFF54D8E8)            // #54D8E8 Electric Ice Cyan
val DustySage = Color(0xFF4ADE80)               // #4ADE80 Mint Success
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
