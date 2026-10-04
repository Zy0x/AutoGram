package com.autogram.app.ui.remote

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.UUID

enum class CrawlerKind { ALL, IMAGE, VIDEO, AUDIO, DOCUMENT }

data class CrawledMediaItem(
    val id: String = UUID.randomUUID().toString(),
    val url: String,
    val name: String,
    val kind: CrawlerKind,
    val sizeBytes: Long = 0L,
    val sourceUrl: String = ""
)

object WebMediaCrawler {
    private val IMAGE_EXTENSIONS = setOf("jpg", "jpeg", "png", "webp", "gif", "svg", "bmp", "ico", "avif")
    private val VIDEO_EXTENSIONS = setOf("mp4", "mkv", "webm", "avi", "mov", "flv", "m4v", "ts")
    private val AUDIO_EXTENSIONS = setOf("mp3", "m4a", "aac", "flac", "ogg", "wav", "opus")
    private val DOC_EXTENSIONS = setOf("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "rar", "7z", "tar", "gz", "txt", "csv", "json")

    private val SRC_REGEX = Regex("""(?i)\b(?:src|href|data-src)=["']([^"']+)["']""")

    suspend fun crawl(
        seedUrl: String,
        maxDepth: Int = 1,
        maxResults: Int = 50,
        allowedKind: CrawlerKind = CrawlerKind.ALL
    ): List<CrawledMediaItem> = withContext(Dispatchers.IO) {
        val results = mutableListOf<CrawledMediaItem>()
        val visitedPages = mutableSetOf<String>()
        val queue = ArrayDeque<Pair<String, Int>>()

        val normalizedSeed = seedUrl.trim()
        if (normalizedSeed.isBlank()) return@withContext emptyList()
        val seedUri = try { URI(normalizedSeed) } catch (_: Exception) { return@withContext emptyList() }
        queue.add(normalizedSeed to 1)

        while (queue.isNotEmpty() && results.size < maxResults) {
            val (currentUrl, depth) = queue.removeFirst()
            if (currentUrl in visitedPages) continue
            visitedPages.add(currentUrl)

            try {
                val conn = URL(currentUrl).openConnection() as HttpURLConnection
                conn.connectTimeout = 7000
                conn.readTimeout = 7000
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10; Mobile) AutoGramCrawler/1.0")
                conn.instanceFollowRedirects = true

                val contentType = conn.contentType?.lowercase().orEmpty()
                if (!contentType.contains("text/html") && !contentType.contains("application/xhtml")) {
                    // It's directly a media link
                    val kind = detectKind(currentUrl, contentType)
                    if (allowedKind == CrawlerKind.ALL || allowedKind == kind) {
                        val name = extractFilename(currentUrl)
                        val length = conn.contentLengthLong.coerceAtLeast(0L)
                        results.add(CrawledMediaItem(url = currentUrl, name = name, kind = kind, sizeBytes = length, sourceUrl = currentUrl))
                    }
                    conn.disconnect()
                    continue
                }

                val reader = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8))
                val sb = StringBuilder()
                var readLines = 0
                while (readLines < 1500) {
                    val line = reader.readLine() ?: break
                    sb.append(line).append('\n')
                    readLines++
                }
                reader.close()
                conn.disconnect()

                val html = sb.toString()
                val currentUri = try { URI(currentUrl) } catch (_: Exception) { seedUri }

                SRC_REGEX.findAll(html).forEach { match ->
                    if (results.size >= maxResults) return@forEach
                    val rawLink = match.groupValues[1].trim()
                    if (rawLink.isBlank() || rawLink.startsWith("javascript:") || rawLink.startsWith("data:") || rawLink.startsWith("#")) return@forEach

                    val resolvedUrl = try {
                        val res = currentUri.resolve(rawLink).toString()
                        if (res.startsWith("http://") || res.startsWith("https://")) res else null
                    } catch (_: Exception) { null } ?: return@forEach

                    val kind = detectKind(resolvedUrl, "")
                    if (kind != CrawlerKind.DOCUMENT || isLikelyMediaDoc(resolvedUrl)) {
                        if (allowedKind == CrawlerKind.ALL || allowedKind == kind) {
                            if (results.none { it.url == resolvedUrl }) {
                                val filename = extractFilename(resolvedUrl)
                                results.add(CrawledMediaItem(
                                    url = resolvedUrl,
                                    name = filename,
                                    kind = kind,
                                    sourceUrl = currentUrl
                                ))
                            }
                        }
                    } else if (depth < maxDepth && queue.size < 100 && sameHost(seedUri, resolvedUrl)) {
                        if (resolvedUrl !in visitedPages && queue.none { it.first == resolvedUrl }) {
                            queue.add(resolvedUrl to depth + 1)
                        }
                    }
                }
            } catch (_: Exception) {
                // Ignore transient network errors on single crawl pages
            }
        }
        results
    }

    private fun sameHost(base: URI, otherUrl: String): Boolean = try {
        val o = URI(otherUrl)
        base.host?.equals(o.host, ignoreCase = true) == true
    } catch (_: Exception) { false }

    private fun isLikelyMediaDoc(url: String): Boolean {
        val ext = url.substringBefore('?').substringAfterLast('.', "").lowercase()
        return ext in DOC_EXTENSIONS
    }

    fun detectKind(url: String, mime: String): CrawlerKind {
        val ext = url.substringBefore('?').substringAfterLast('.', "").lowercase()
        return when {
            ext in IMAGE_EXTENSIONS || mime.startsWith("image/") -> CrawlerKind.IMAGE
            ext in VIDEO_EXTENSIONS || mime.startsWith("video/") -> CrawlerKind.VIDEO
            ext in AUDIO_EXTENSIONS || mime.startsWith("audio/") -> CrawlerKind.AUDIO
            ext in DOC_EXTENSIONS || mime.startsWith("application/") -> CrawlerKind.DOCUMENT
            else -> CrawlerKind.IMAGE
        }
    }

    fun extractFilename(url: String): String {
        val path = url.substringBefore('?').substringBefore('#')
        val lastSegment = path.substringAfterLast('/').trim()
        return if (lastSegment.isNotBlank() && lastSegment.contains('.')) {
            lastSegment
        } else {
            "media_${System.currentTimeMillis() % 100000}.bin"
        }
    }
}
