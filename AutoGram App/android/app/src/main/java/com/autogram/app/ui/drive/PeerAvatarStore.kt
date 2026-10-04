package com.autogram.app.ui.drive

import android.content.Context
import androidx.compose.ui.graphics.Color
import org.json.JSONObject

data class CustomPeerIcon(
    val peerId: String,
    val iconSymbol: String = "default", // default, cloud, folder, vault, video, music, archive, star, bookmark
    val colorHex: String? = null
)

/**
 * Stores user-customized Drive & Group icon assignments in SharedPreferences.
 */
class PeerAvatarStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("autogram_peer_avatars", Context.MODE_PRIVATE)

    fun getCustomIcon(peerId: String): CustomPeerIcon? {
        val raw = preferences.getString("icon_$peerId", null) ?: return null
        return try {
            val json = JSONObject(raw)
            CustomPeerIcon(
                peerId = peerId,
                iconSymbol = json.optString("symbol", "default"),
                colorHex = if (json.has("colorHex")) json.getString("colorHex") else null
            )
        } catch (_: Exception) {
            null
        }
    }

    fun setCustomIcon(peerId: String, symbol: String, colorHex: String?) {
        val json = JSONObject()
            .put("symbol", symbol)
        if (colorHex != null) json.put("colorHex", colorHex)
        preferences.edit().putString("icon_$peerId", json.toString()).apply()
    }

    fun removeCustomIcon(peerId: String) {
        preferences.edit().remove("icon_$peerId").apply()
    }
}
