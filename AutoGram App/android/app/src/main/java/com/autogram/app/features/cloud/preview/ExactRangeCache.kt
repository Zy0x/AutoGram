package com.autogram.app.features.cloud.preview

/** Per-capability memory only. Reuse fetched bytes; never fetch ahead or cross accounts. */
internal class ExactRangeCache(private val budget: Int = 1024 * 1024) {
    private val entries = LinkedHashMap<Long, ByteArray>(16, 0.75f, true)
    private var bytes = 0

    @Synchronized fun read(offset: Long, length: Int): ByteArray? {
        val start = entries.entries.firstOrNull { (start, data) ->
            offset >= start && offset - start <= data.size.toLong() - length
        }?.key ?: return null
        val data = entries.getValue(start)
        val relative = (offset - start).toInt()
        return data.copyOfRange(relative, relative + length)
    }

    @Synchronized fun put(offset: Long, data: ByteArray) {
        if (data.isEmpty() || data.size > budget) return
        entries.remove(offset)?.let { bytes -= it.size }
        entries[offset] = data.copyOf()
        bytes += data.size
        while (bytes > budget || entries.size > 16) {
            val oldest = entries.entries.iterator()
            bytes -= oldest.next().value.size
            oldest.remove()
        }
    }

    @Synchronized fun clear() { entries.clear(); bytes = 0 }
}
