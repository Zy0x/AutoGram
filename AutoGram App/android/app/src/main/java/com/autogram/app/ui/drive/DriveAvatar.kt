package com.autogram.app.ui.drive

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.autogram.app.theme.*

/**
 * Telegram Official 8-Gradient Color Palette
 */
val TELEGRAM_GRADIENT_PAIRS = listOf(
    Pair(Color(0xFFFD746C), Color(0xFFFF9068)), // Coral Red
    Pair(Color(0xFFF2994A), Color(0xFFF2C94C)), // Orange Amber
    Pair(Color(0xFF38EF7D), Color(0xFF11998E)), // Emerald Green
    Pair(Color(0xFF2193B0), Color(0xFF6DD5ED)), // Cyan Blue
    Pair(Color(0xFF8A2387), Color(0xFFE94057)), // Violet Magenta
    Pair(Color(0xFF00B4DB), Color(0xFF0083B0)), // Ocean Blue
    Pair(Color(0xFFFC466B), Color(0xFF3F5EFB)), // Electric Pink
    Pair(Color(0xFF8E2DE2), Color(0xFF4A00E0))  // Deep Purple
)

fun getPeerGradient(peerId: String): Brush {
    val hash = kotlin.math.abs(peerId.hashCode())
    val pair = TELEGRAM_GRADIENT_PAIRS[hash % TELEGRAM_GRADIENT_PAIRS.size]
    return Brush.linearGradient(listOf(pair.first, pair.second))
}

fun getPeerInitials(title: String): String {
    val clean = title.trim()
    if (clean.isBlank()) return "TG"
    val words = clean.split(Regex("[\\s~_\\-\\[\\]()]+")).filter { it.isNotBlank() }
    if (words.size >= 2) {
        val w1 = words[0].replace(Regex("^[^\\w#]"), "")
        val w2 = words[1].replace(Regex("^[^\\w]"), "")
        val c1 = w1.firstOrNull()?.toString().orEmpty()
        val c2 = w2.firstOrNull()?.toString().orEmpty()
        val initials = (c1 + c2).uppercase()
        if (initials.isNotBlank()) return initials.take(2)
    }
    val w1 = words.firstOrNull().orEmpty()
    val cleaned = w1.replace(Regex("^[^\\w#]"), "")
    if (cleaned.length >= 2 && cleaned.startsWith("#")) {
        return cleaned.take(2).uppercase()
    }
    return (cleaned.take(1).ifEmpty { clean.take(1) }).uppercase()
}

/**
 * Universal Peer/Drive Avatar with Telegram gradient monograms,
 * photo support, and distinctive chat kind badges (Saved, Channel, Group, Forum, Bot).
 */
@Composable
fun PeerAvatar(
    title: String,
    peerId: String,
    kind: String, // "self", "channel", "group", "supergroup", "user", "bot", "forum"
    isForum: Boolean = false,
    avatarBytes: ByteArray? = null,
    avatarUri: String? = null,
    size: Dp = 40.dp,
    showBadge: Boolean = true,
    modifier: Modifier = Modifier
) {
    val isSelf = peerId == "me" || kind == "self"
    val initials = remember(title) { if (isSelf) "★" else getPeerInitials(title) }
    val gradient = remember(peerId, isSelf) {
        if (isSelf) {
            Brush.linearGradient(listOf(Color(0xFF00C6FF), Color(0xFF0072FF))) // Bright Saved Blue
        } else {
            getPeerGradient(peerId)
        }
    }

    Box(
        modifier = modifier.size(size),
        contentAlignment = Alignment.Center
    ) {
        // Base Avatar (Photo or Gradient Monogram)
        Surface(
            shape = CircleShape,
            modifier = Modifier.fillMaxSize(),
            color = Color.Transparent
        ) {
            when {
                avatarBytes != null -> {
                    AsyncImage(
                        model = avatarBytes,
                        contentDescription = title,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .fillMaxSize()
                            .clip(CircleShape)
                    )
                }
                !avatarUri.isNullOrBlank() -> {
                    AsyncImage(
                        model = avatarUri,
                        contentDescription = title,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .fillMaxSize()
                            .clip(CircleShape)
                    )
                }
                isSelf -> {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(gradient),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = Icons.Default.Bookmark,
                            contentDescription = "Saved Messages",
                            tint = Color.White,
                            modifier = Modifier.size(size * 0.55f)
                        )
                    }
                }
                else -> {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(gradient),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = initials,
                            style = MaterialTheme.typography.titleMedium.copy(
                                fontWeight = FontWeight.Bold,
                                fontSize = (size.value * 0.4f).sp,
                                letterSpacing = (-0.5).sp
                            ),
                            color = Color.White
                        )
                    }
                }
            }
        }

        // Mini Badge for Channel, Group, Forum, or Bot
        if (showBadge && !isSelf) {
            val badgeIcon = when {
                isForum -> Icons.Default.Forum
                kind == "channel" -> Icons.Default.Campaign
                kind in setOf("group", "supergroup") -> Icons.Default.Groups
                kind == "bot" -> Icons.Default.SmartToy
                else -> null
            }

            val badgeColor = when {
                isForum -> GoldAccent
                kind == "channel" -> MutedIceCyan
                kind in setOf("group", "supergroup") -> DustySage
                kind == "bot" -> SoftViolet
                else -> null
            }

            if (badgeIcon != null && badgeColor != null) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .offset(x = 2.dp, y = 2.dp)
                        .size(size * 0.42f)
                        .background(SurfaceDeep, CircleShape)
                        .border(1.5.dp, SurfaceElevatedDark, CircleShape)
                        .padding(2.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = badgeIcon,
                        contentDescription = kind,
                        tint = badgeColor,
                        modifier = Modifier.fillMaxSize()
                    )
                }
            }
        }
    }
}
