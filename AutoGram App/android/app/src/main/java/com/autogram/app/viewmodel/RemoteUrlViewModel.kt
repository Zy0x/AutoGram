package com.autogram.app.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.autogram.app.R
import com.autogram.app.features.localdownload.LocalDownloadError
import com.autogram.app.features.localdownload.LocalDownloadException
import com.autogram.app.features.localdownload.LocalDownloadPolicy
import com.autogram.app.features.localdownload.LocalDownloadRepository
import com.autogram.app.features.localdownload.textResource
import com.autogram.app.ui.remote.CrawledMediaItem
import com.autogram.app.ui.remote.CrawlerKind
import com.autogram.app.ui.remote.WebMediaCrawler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.Locale

enum class RemoteScreenTab { RESOLVER, CRAWLER }
enum class ResolverMode { SINGLE, BATCH }

data class RemoteUrlUiState(
    val tab: RemoteScreenTab = RemoteScreenTab.RESOLVER,
    val mode: ResolverMode = ResolverMode.SINGLE,
    val url: String = "",
    val host: String? = null,
    val platformRes: Int = R.string.remote_platform_generic,
    val isPlatformUrl: Boolean = false,
    val isValidDirectFile: Boolean = false,
    val batchText: String = "",
    val batchUrls: List<String> = emptyList(),
    val stripCaption: Boolean = false,
    val dedupCheck: Boolean = true,
    val crawlerUrl: String = "",
    val crawlerDepth: Int = 1,
    val crawlerMaxResults: Int = 50,
    val crawlerFilterKind: CrawlerKind = CrawlerKind.ALL,
    val isCrawling: Boolean = false,
    val crawledEntries: List<CrawledMediaItem> = emptyList(),
    val selectedEntries: Set<String> = emptySet(),
    val statusMessage: String? = null
)

class RemoteUrlViewModel : ViewModel() {
    private val mutableState = MutableStateFlow(RemoteUrlUiState())
    val uiState: StateFlow<RemoteUrlUiState> = mutableState.asStateFlow()

    private var crawlJob: Job? = null

    fun setTab(tab: RemoteScreenTab) {
        mutableState.update { it.copy(tab = tab) }
    }

    fun setMode(mode: ResolverMode) {
        mutableState.update { it.copy(mode = mode) }
    }

    fun acceptSharedUrl(url: String) = updateUrl(url)

    fun updateUrl(value: String) {
        val bounded = value.take(8192)
        val host = RemoteUrlValidator.parseHost(bounded.trim())
        val isPlatform = isPlatformHost(host)
        val isValidFile = LocalDownloadPolicy.validate(bounded.trim()) != null
        val platformRes = detectPlatformRes(host)
        mutableState.update {
            it.copy(
                url = bounded,
                host = host,
                platformRes = platformRes,
                isPlatformUrl = isPlatform,
                isValidDirectFile = isValidFile
            )
        }
    }

    fun updateBatchText(text: String) {
        val lines = text.lines()
            .map { it.trim() }
            .filter { it.startsWith("https://", ignoreCase = true) || it.startsWith("http://", ignoreCase = true) }
        mutableState.update {
            it.copy(
                batchText = text,
                batchUrls = lines
            )
        }
    }

    fun setStripCaption(strip: Boolean) {
        mutableState.update { it.copy(stripCaption = strip) }
    }

    fun setDedupCheck(dedup: Boolean) {
        mutableState.update { it.copy(dedupCheck = dedup) }
    }

    fun updateCrawlerUrl(url: String) {
        mutableState.update { it.copy(crawlerUrl = url) }
    }

    fun setCrawlerDepth(depth: Int) {
        mutableState.update { it.copy(crawlerDepth = depth.coerceIn(1, 3)) }
    }

    fun setCrawlerMaxResults(max: Int) {
        mutableState.update { it.copy(crawlerMaxResults = max.coerceIn(10, 200)) }
    }

    fun setCrawlerFilterKind(kind: CrawlerKind) {
        mutableState.update { it.copy(crawlerFilterKind = kind) }
    }

    fun startCrawling() {
        val current = mutableState.value
        val target = current.crawlerUrl.trim()
        if (target.isBlank() || !target.startsWith("https://", ignoreCase = true)) return

        crawlJob?.cancel()
        mutableState.update {
            it.copy(
                isCrawling = true,
                crawledEntries = emptyList(),
                selectedEntries = emptySet(),
                statusMessage = null
            )
        }

        crawlJob = viewModelScope.launch {
            try {
                val results = WebMediaCrawler.crawl(
                    seedUrl = target,
                    maxDepth = current.crawlerDepth,
                    maxResults = current.crawlerMaxResults,
                    allowedKind = current.crawlerFilterKind
                )
                mutableState.update {
                    it.copy(
                        isCrawling = false,
                        crawledEntries = results,
                        selectedEntries = results.map { entry -> entry.id }.toSet()
                    )
                }
            } catch (e: Exception) {
                mutableState.update {
                    it.copy(
                        isCrawling = false,
                        statusMessage = e.message ?: "Crawl failed"
                    )
                }
            }
        }
    }

    fun stopCrawling() {
        crawlJob?.cancel()
        crawlJob = null
        mutableState.update { it.copy(isCrawling = false) }
    }

    fun toggleEntrySelection(id: String) {
        mutableState.update {
            val next = it.selectedEntries.toMutableSet()
            if (next.contains(id)) next.remove(id) else next.add(id)
            it.copy(selectedEntries = next)
        }
    }

    fun selectAllEntries() {
        mutableState.update {
            it.copy(selectedEntries = it.crawledEntries.map { entry -> entry.id }.toSet())
        }
    }

    fun deselectAllEntries() {
        mutableState.update { it.copy(selectedEntries = emptySet()) }
    }

    fun enqueueSingleDownload(context: Context, onResult: (Boolean, String) -> Unit) {
        val targetUrl = mutableState.value.url.trim()
        val directFile = LocalDownloadPolicy.validate(targetUrl)
        if (directFile == null) {
            val host = RemoteUrlValidator.parseHost(targetUrl)
            val msg = if (isPlatformHost(host)) {
                context.getString(R.string.remote_url_platform_blocked)
            } else {
                context.getString(R.string.remote_invalid_direct_url)
            }
            onResult(false, msg)
            return
        }

        viewModelScope.launch(Dispatchers.IO) {
            try {
                val repository = LocalDownloadRepository(context)
                repository.enqueue(directFile)
                withContext(Dispatchers.Main) {
                    onResult(true, directFile.basename)
                }
            } catch (e: LocalDownloadException) {
                val errorMsg = context.getString(e.error.textResource())
                withContext(Dispatchers.Main) {
                    onResult(false, errorMsg)
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    onResult(false, e.message ?: context.getString(R.string.local_download_error_start))
                }
            }
        }
    }

    fun enqueueSingleUpload(context: Context, onResult: (Boolean, String) -> Unit) {
        // Honest notification: remote URL upload to Telegram Cloud is only supported via desktop Grammers engine
        onResult(false, context.getString(R.string.remote_upload_cloud_disabled_notice))
    }

    fun enqueueBatchDownload(context: Context, onResult: (Int, Int) -> Unit) {
        val urls = mutableState.value.batchUrls
        if (urls.isEmpty()) {
            onResult(0, 0)
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            val repository = LocalDownloadRepository(context)
            var queued = 0
            var skipped = 0
            urls.forEach { u ->
                val direct = LocalDownloadPolicy.validate(u)
                if (direct != null) {
                    try {
                        repository.enqueue(direct)
                        queued++
                    } catch (_: Exception) {
                        skipped++
                    }
                } else {
                    skipped++
                }
            }
            withContext(Dispatchers.Main) {
                onResult(queued, skipped)
            }
        }
    }

    fun enqueueBatchUpload(context: Context, onResult: (Int, String) -> Unit) {
        // Honest notification: batch URL upload to cloud requires desktop runtime
        onResult(0, context.getString(R.string.remote_upload_cloud_disabled_notice))
    }

    fun downloadSelectedCrawled(context: Context, onResult: (Int, Int) -> Unit) {
        val state = mutableState.value
        val items = state.crawledEntries.filter { it.id in state.selectedEntries }
        if (items.isEmpty()) {
            onResult(0, 0)
            return
        }
        viewModelScope.launch(Dispatchers.IO) {
            val repository = LocalDownloadRepository(context)
            var queued = 0
            var skipped = 0
            items.forEach { item ->
                val direct = LocalDownloadPolicy.validate(item.url)
                if (direct != null) {
                    try {
                        repository.enqueue(direct)
                        queued++
                    } catch (_: Exception) {
                        skipped++
                    }
                } else {
                    skipped++
                }
            }
            withContext(Dispatchers.Main) {
                onResult(queued, skipped)
            }
        }
    }

    fun uploadSelectedCrawled(context: Context, onResult: (Int, String) -> Unit) {
        // Honest notification: crawled media cloud upload requires desktop runtime
        onResult(0, context.getString(R.string.remote_upload_cloud_disabled_notice))
    }

    private fun isPlatformHost(host: String?): Boolean {
        if (host == null) return false
        val h = host.lowercase(Locale.ROOT)
        return h.contains("youtube.com") || h.contains("youtu.be") ||
                h.contains("tiktok.com") || h.contains("instagram.com") ||
                h.contains("twitter.com") || h.contains("x.com") ||
                h.contains("facebook.com") || h.contains("fb.watch") ||
                h.contains("vimeo.com") || h.contains("dailymotion.com") ||
                h.contains("pinterest.com") || h.contains("pin.it") ||
                h.contains("pixiv.net") || h.contains("twitch.tv")
    }

    private fun detectPlatformRes(host: String?): Int {
        if (host == null) return R.string.remote_platform_generic
        val h = host.lowercase(Locale.ROOT)
        return when {
            h.contains("youtube.com") || h.contains("youtu.be") -> R.string.remote_platform_youtube
            h.contains("tiktok.com") -> R.string.remote_platform_tiktok
            h.contains("instagram.com") -> R.string.remote_platform_instagram
            h.contains("twitter.com") || h.contains("x.com") -> R.string.remote_platform_twitter
            h.contains("pinterest.com") || h.contains("pin.it") -> R.string.remote_platform_pinterest
            h.contains("pixiv.net") -> R.string.remote_platform_pixiv
            else -> R.string.remote_platform_generic
        }
    }
}
