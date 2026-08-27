package com.autogram.app.theme

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// Obsidian & Background Hierarchy
val ObsidianPrimary = Color(0xFF060911)
val ObsidianSecondary = Color(0xFF0B0F19)
val SurfaceDeep = Color(0xFF101521)
val BgDark = ObsidianPrimary
val SurfaceDark = Color(0xFF0D1729)
val SurfaceElevatedDark = Color(0xFF142239)

// Glass Surfaces (Translucent tokens)
val SurfaceGlass = Color(0xBF121927)       // rgba(18, 25, 39, 0.75)
val SurfaceGlassStrong = Color(0xE6121927) // rgba(18, 25, 39, 0.90)
val SurfaceGlassSoft = Color(0x8C141C2C)   // rgba(20, 28, 44, 0.55)
val SurfaceDock = Color(0xD90D1524)        // rgba(13, 21, 36, 0.85)

// Accent Colors
val NeonCyan = Color(0xFF06B6D4)
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

// Text Hierarchy
val TextPrimaryDark = Color(0xFFF8FAFC)
val TextSecondaryDark = Color(0xFF94A3B8)
val TextMutedDark = Color(0xFF64748B)

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

// Hairline Borders
val BorderHairline = Color(0x14FFFFFF)   // rgba(255,255,255,0.08)
val BorderActive = Color(0x403B82F6)     // rgba(59,130,246,0.25)
val BorderCyanGlow = Color(0x6606B6D4)   // rgba(6,182,212,0.40)
val BorderDark = Color(0xFF1E293B)

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
        Color(0x33FFFFFF),
        Color(0x0DFFFFFF),
        Color(0x1A3B82F6)
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
        Color(0x1A06B6D4), // Soft Cyan Bloom
        Color(0x0D3B82F6), // Soft Blue Bloom
        Color.Transparent
    ),
    radius = 1200f
)

// Light theme fallback counterparts
val BgLight = Color(0xFFF9FAFB)
val SurfaceLight = Color(0xFFFFFFFF)
val SurfaceElevatedLight = Color(0xFFF3F4F6)
val BorderLight = Color(0xFFE5E7EB)
val TextPrimaryLight = Color(0xFF111827)
val TextSecondaryLight = Color(0xFF4B5563)
