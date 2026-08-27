package com.autogram.app.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// =============================================================================
// Google Stitch: Soft Luxury & Titanium Minimalist Palette
// =============================================================================

// Canvas & Background (Warm Titanium & Deep Obsidian Slate)
val CanvasWarmTitanium = Color(0xFF0C0F17)      // Warm dark titanium canvas
val CanvasSecondaryTitanium = Color(0xFF101520) // Layered background depth
val SurfaceDeep = Color(0xFF141A27)             // Deep inset container
val BgDark = CanvasWarmTitanium
val SurfaceDark = Color(0xFF121824)
val SurfaceElevatedDark = Color(0xFF182030)

// Aliases for backwards compatibility
val ObsidianPrimary = CanvasWarmTitanium
val ObsidianSecondary = CanvasSecondaryTitanium

// Soft Luxury Glass & Cashmere Surfaces (Translucent frosted elegance)
val SurfaceGlass = Color(0x99151C2A)            // rgba(21, 28, 42, 0.60)
val SurfaceGlassStrong = Color(0xCC151C2A)      // rgba(21, 28, 42, 0.80)
val SurfaceGlassSoft = Color(0x59172033)        // rgba(23, 32, 51, 0.35)
val SurfaceDock = Color(0xE60F1420)             // rgba(15, 20, 32, 0.90)

// Soft Luxury Accents (Restrained saturation < 65%, no harsh neon)
val ChampagneGold = Color(0xFFC5A059)           // Primary Soft Luxury Accent
val ChampagneLight = Color(0xFFE2C98A)          // Soft highlight
val MutedIceCyan = Color(0xFF38BDF8)            // Secondary Crisp Cyan Accent
val DustySage = Color(0xFF34D399)               // Verified & Security Emerald
val SoftViolet = Color(0xFFA78BFA)              // Video & Rich Media
val WarmAmber = Color(0xFFFBBF24)               // Audio & Warning
val SoftCoral = Color(0xFFF87171)               // Danger & Deletion

// Semantic Mapping
val NeonCyan = MutedIceCyan
val ElectricBlue = Color(0xFF60A5FA)
val ElectricViolet = SoftViolet
val Emerald = DustySage
val Amber = WarmAmber
val Danger = SoftCoral

val PrimaryBlue = ChampagneGold
val PrimaryBlueHover = ChampagneLight
val AccentCyan = MutedIceCyan
val AccentAmber = WarmAmber
val AccentViolet = SoftViolet

// High-Legibility Cashmere Typography
val TextPrimaryDark = Color(0xFFF8FAFC)
val TextSecondaryDark = Color(0xFF94A3B8)
val TextMutedDark = Color(0xFF64748B)

// Status & Semantic Colors
val SuccessGreen = DustySage
val WarningAmber = WarmAmber
val ErrorRed = SoftCoral

// Multi-Stage Pipeline Colors
val StageScan = SoftViolet
val StageDownload = MutedIceCyan
val StageVerify = Color(0xFF2DD4BF)
val StageEncode = WarmAmber
val StageUpload = ChampagneGold
val StageCommit = Color(0xFFC084FC)
val StageReconcile = DustySage

// Media Category Colors (Soft Muted Tones)
val CategoryVideo = SoftViolet
val CategoryAudio = WarmAmber
val CategoryPhoto = MutedIceCyan
val CategoryDoc = ElectricBlue
val CategoryArchive = DustySage
val CategoryError = SoftCoral

// Hairline Borders (Double-Bezel & Optical Precision)
val BorderHairline = Color(0x17FFFFFF)          // 1px 9% white hairline
val BorderActive = Color(0x59C5A059)            // 35% Champagne gold
val BorderCyanGlow = Color(0x4038BDF8)          // 25% Ice Cyan glow
val BorderDark = Color(0x1AFFFFFF)

// Reusable Soft Luxury Gradient Brushes
val ChampagneToCyanBrush = Brush.horizontalGradient(
    colors = listOf(ChampagneGold, MutedIceCyan)
)

val CyanToBlueBrush = Brush.horizontalGradient(
    colors = listOf(ChampagneGold, MutedIceCyan)
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
        Color(0x33FFFFFF),
        Color(0x08FFFFFF),
        Color(0x2EC5A059)
    )
)

val ActiveGlassBorderBrush = Brush.linearGradient(
    colors = listOf(
        ChampagneGold,
        MutedIceCyan,
        Color(0x33A78BFA)
    )
)

val AmbientBackgroundBrush = Brush.radialGradient(
    colors = listOf(
        Color(0x12C5A059), // Soft Champagne Ambient Bloom
        Color(0x0A38BDF8), // Soft Ice-Cyan Secondary Bloom
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
