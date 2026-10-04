package com.autogram.app.ui.remote

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.URI
import java.net.URL
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.HttpsURLConnection

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
    private const val MAX_HTML_BYTES = 512 * 1024 // 512 KB payload ceiling
    private const val MAX_ROBOTS_BYTES = 64 * 1024 // 64 KB robots.txt ceiling

    private val IMAGE_EXTENSIONS = setOf("jpg", "jpeg", "png", "webp", "gif", "svg", "bmp", "ico", "avif")
    private val VIDEO_EXTENSIONS = setOf("mp4", "mkv", "webm", "avi", "mov", "flv", "m4v", "ts")
    private val AUDIO_EXTENSIONS = setOf("mp3", "m4a", "aac", "flac", "ogg", "wav", "opus")
    private val DOC_EXTENSIONS = setOf("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "rar", "7z", "tar", "gz", "txt", "csv", "json")

    private val SRC_REGEX = Regex("""(?i)\b(?:src|href|data-src)=["']([^"']+)["']""")

    // Cache of disallowed paths per host
    private val robotsDisallowedCache = ConcurrentHashMap<String, List<String>>()

    /**
     * Strictly verifies that the URL uses HTTPS and resolves to public addresses,
     * protecting against SSRF attacks on local loopback, private subnets, and cloud metadata.
     */
    fun isSafePublicHttpsUrl(targetUrl: String): Boolean = runCatching {
        val uri = URI(targetUrl.trim())
        if (!uri.scheme.equals("https", ignoreCase = true)) return false
        val host = uri.host?.trim()?.lowercase(Locale.ROOT) ?: return false
        if (host.isBlank() || host == "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
            return false
        }

        // Resolve DNS and verify all IP addresses
        val addresses = InetAddress.getAllByName(host)
        if (addresses.isEmpty()) return false

        for (addr in addresses) {
            if (addr.isLoopbackAddress || addr.isSiteLocalAddress || addr.isLinkLocalAddress ||
                addr.isAnyLocalAddress || addr.isMulticastAddress) {
                return false
            }
            // Check IPv4 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10)
            val octets = addr.address
            if (octets.size == 4) {
                val b0 = octets[0].toInt() and 0xFF
                val b1 = octets[1].toInt() and 0xFF
                if (b0 == 10) return false
                if (b0 == 127) return false
                if (b0 == 169 && b1 == 254) return false
                if (b0 == 172 && b1 in 16..31) return false
                if (b0 == 192 && b1 == 168) return false
                if (b0 == 100 && b1 in 64..127) return false
                if (b0 == 0) return false
            }
        }
        true
    }.getOrDefault(false)

    /**
     * Checks if a target URL path is permitted by the host's robots.txt policy.
     */
    private fun isAllowedByRobots(uri: URI): Boolean {
        val host = uri.host?.lowercase(Locale.ROOT) ?: return true
        val path = uri.path.ifBlank { "/" }

        val disallowed = robotsDisallowedCache.getOrPut(host) {
            fetchRobotsDisallowedRules(host)
        }

        for (rule in disallowed) {
            if (rule == "/" || (rule.isNotBlank() && path.startsWith(rule, ignoreCase = false))) {
                return false
            }
        }
        return true
    }

    private fun fetchRobotsDisallowedRules(host: String): List<String> = runCatching {
        val robotsUrl = "https://$host/robots.txt"
        if (!isSafePublicHttpsUrl(robotsUrl)) return emptyList()

        val conn = URL(robotsUrl).openConnection() as HttpsURLConnection
        conn.connectTimeout = 4000
        conn.readTimeout = 4000
        conn.instanceFollowRedirects = false
        conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10; Mobile) AutoGramCrawler/1.0")

        if (conn.responseCode != 200) {
            conn.disconnect()
            return emptyList()
        }

        val rules = mutableListOf<String>()
        val reader = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8))
        var bytesRead = 0
        var appliesToUs = true

        reader.useLines { lines ->
            for (line in lines) {
                bytesRead += line.length + 1
                if (bytesRead > MAX_ROBOTS_BYTES) break

                val clean = line.substringBefore('#').trim()
                if (clean.isBlank()) continue

                val lower = clean.lowercase(Locale.ROOT)
                if (lower.startsWith("user-agent:")) {
                    val ua = clean.substringAfter(':').trim().lowercase(Locale.ROOT)
                    appliesToUs = (ua == "*" || ua.contains("autogram") || ua.contains("autogramcrawler"))
                } else if (appliesToUs && lower.startsWith("disallow:")) {
                    val rule = clean.substringAfter(':').trim()
                    if (rule.isNotBlank()) {
                        rules.add(rule)
                    }
                }
            }
        }
        conn.disconnect()
        rules
    }.getOrDefault(emptyList())

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
        if (normalizedSeed.isBlank() || !isSafePublicHttpsUrl(normalizedSeed)) return@withContext emptyList()
        val seedUri = try { URI(normalizedSeed) } catch (_: Exception) { return@withContext emptyList() }

        if (!isAllowedByRobots(seedUri)) return@withContext emptyList()
        queue.add(normalizedSeed to 1)

        while (queue.isNotEmpty() && results.size < maxResults) {
            val (currentUrl, depth) = queue.removeFirst()
            if (currentUrl in visitedPages) continue
            visitedPages.add(currentUrl)

            try {
                if (!isSafePublicHttpsUrl(currentUrl)) continue
                val currentUri = try { URI(currentUrl) } catch (_: Exception) { continue }
                if (!isAllowedByRobots(currentUri)) continue

                val conn = URL(currentUrl).openConnection() as HttpsURLConnection
                conn.connectTimeout = 6000
                conn.readTimeout = 6000
                conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10; Mobile) AutoGramCrawler/1.0")
                conn.instanceFollowRedirects = true

                val contentType = conn.contentType?.lowercase(Locale.ROOT).orEmpty()
                if (!contentType.contains("text/html") && !contentType.contains("application/xhtml")) {
                    // Directly media link
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
                var readBytes = 0
                while (readBytes < MAX_HTML_BYTES) {
                    val line = reader.readLine() ?: break
                    sb.append(line).append('\n')
                    readBytes += line.length + 1
                }
                reader.close()
                conn.disconnect()

                val html = sb.toString()

                SRC_REGEX.findAll(html).forEach { match ->
                    if (results.size >= maxResults) return@forEach
                    val rawLink = match.groupValues[1].trim()
                    if (rawLink.isBlank() || rawLink.startsWith("javascript:", ignoreCase = true) ||
                        rawLink.startsWith("data:", ignoreCase = true) || rawLink.startsWith("#")
                    ) return@forEach

                    val resolvedUrl = try {
                        val res = currentUri.resolve(rawLink).toString()
                        if (res.startsWith("https://", ignoreCase = true) && isSafePublicHttpsUrl(res)) res else null
                    } catch (_: Exception) { null } ?: return@forEach

                    val resolvedUri = try { URI(resolvedUrl) } catch (_: Exception) { null } ?: return@forEach
                    if (!isAllowedByRobots(resolvedUri)) return@forEach

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
        val ext = url.substringBefore('?').substringAfterLast('.', "").lowercase(Locale.ROOT)
        return ext in DOC_EXTENSIONS
    }

    fun detectKind(url: String, mime: String): CrawlerKind {
        val ext = url.substringBefore('?').substringAfterLast('.', "").lowercase(Locale.ROOT)
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
        val sanitized = lastSegment.replace(Regex("[^a-zA-Z0-9._-]"), "_")
        return if (sanitized.isNotBlank() && sanitized.contains('.')) {
            sanitized
        } else {
            "media_${System.currentTimeMillis() % 100000}.bin"
        }
    }
}
