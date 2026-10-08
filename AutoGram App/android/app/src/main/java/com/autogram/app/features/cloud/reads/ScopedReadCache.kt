package com.autogram.app.features.cloud.reads

/** Only confirmed server results. Account owners clear this cache when their scope changes. */
class ScopedReadCache<K, V>(private val now: () -> Long, private val ttlMs: Long,
    private val maxEntries: Int, private val maxBytes: Long, private val weigh: (V) -> Long) {
    private data class Entry<V>(val value: V, val expires: Long, val bytes: Long)
    private val entries = LinkedHashMap<K, Entry<V>>(16, 0.75f, true)
    private var bytes = 0L
    fun get(key: K): V? {
        val entry = entries[key] ?: return null
        if (entry.expires <= now()) { remove(key); return null }
        return entry.value
    }
    fun put(key: K, value: V) {
        store(key, value, now() + ttlMs)
    }
    /** Optional image upgrades do not make old metadata/cursors appear freshly fetched. */
    fun replaceIfFresh(key: K, value: V) {
        val entry = entries[key] ?: return
        if (entry.expires <= now()) { remove(key); return }
        store(key, value, entry.expires)
    }
    private fun store(key: K, value: V, expires: Long) {
        remove(key)
        val cost = weigh(value).coerceAtLeast(0)
        if (cost > maxBytes) return
        entries[key] = Entry(value, expires, cost); bytes += cost
        while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys.first())
    }
    private fun remove(key: K) { entries.remove(key)?.let { bytes -= it.bytes } }
    fun clear() { entries.clear(); bytes = 0 }
}
