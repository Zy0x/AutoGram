package com.autogram.app.ui.drive.preview

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.ZoomIn
import androidx.compose.material.icons.filled.ZoomOut
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.autogram.app.R
import com.autogram.app.features.cloud.preview.CloudRangeSource
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/**
 * Native Android PDF Viewer using PdfRenderer.
 * Renders vector PDF pages to crisp high-DPI bitmaps with zoom, pan, and page navigation.
 */
@Composable
fun DrivePdfViewer(
    source: CloudRangeSource,
    fileName: String,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var pageCount by remember { mutableIntStateOf(0) }
    var currentPageIndex by remember { mutableIntStateOf(0) }
    var currentBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var renderer by remember { mutableStateOf<PdfRenderer?>(null) }
    var pfd by remember { mutableStateOf<ParcelFileDescriptor?>(null) }
    var tempFile by remember { mutableStateOf<File?>(null) }

    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    var offsetY by remember { mutableFloatStateOf(0f) }

    // Load PDF bytes into a temporary file and initialize PdfRenderer
    LaunchedEffect(source) {
        withContext(Dispatchers.IO) {
            try {
                loading = true
                val cacheDir = File(context.cacheDir, "pdf_preview").apply { mkdirs() }
                val temp = File(cacheDir, "pdf_${UUID.randomUUID().toString().take(8)}.pdf")
                tempFile = temp

                val outputStream = FileOutputStream(temp)
                val readLimit = minOf(source.size, MAX_PDF_PREVIEW_BYTES)
                var offset = 0L

                while (offset < readLimit) {
                    val chunk = minOf(256 * 1024L, readLimit - offset).toInt()
                    val bytes = source.read(offset, chunk)
                    if (bytes.isEmpty()) break
                    outputStream.write(bytes)
                    offset += bytes.size
                }
                outputStream.flush()
                outputStream.close()

                val descriptor = ParcelFileDescriptor.open(temp, ParcelFileDescriptor.MODE_READ_ONLY)
                pfd = descriptor
                val pdfRenderer = PdfRenderer(descriptor)
                renderer = pdfRenderer
                pageCount = pdfRenderer.pageCount
                currentPageIndex = 0
                loading = false
            } catch (e: Exception) {
                error = e.message ?: "Failed to open PDF"
                loading = false
            }
        }
    }

    // Render current page to bitmap whenever currentPageIndex or renderer changes
    LaunchedEffect(currentPageIndex, renderer) {
        val r = renderer ?: return@LaunchedEffect
        if (pageCount <= 0) return@LaunchedEffect

        withContext(Dispatchers.Default) {
            try {
                val page = r.openPage(currentPageIndex)
                // Render at 2x density for crisp text
                val targetWidth = (page.width * 2).coerceAtMost(2400)
                val targetHeight = (page.height * 2).coerceAtMost(3200)

                val bitmap = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
                bitmap.eraseColor(Color.WHITE)
                page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                page.close()

                currentBitmap = bitmap
                scale = 1f
                offsetX = 0f
                offsetY = 0f
            } catch (e: Exception) {
                error = e.message
            }
        }
    }

    // Clean up temporary file and renderer on dispose
    DisposableEffect(Unit) {
        onDispose {
            try {
                renderer?.close()
                pfd?.close()
                tempFile?.delete()
            } catch (_: Exception) {}
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .testTag("drive-pdf-viewer"),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // PDF Canvas with Zoom & Pan
        Box(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f))
                .pointerInput(Unit) {
                    detectTransformGestures { _, pan, zoom, _ ->
                        scale = (scale * zoom).coerceIn(1f, 4f)
                        if (scale > 1f) {
                            offsetX += pan.x
                            offsetY += pan.y
                        } else {
                            offsetX = 0f
                            offsetY = 0f
                        }
                    }
                },
            contentAlignment = Alignment.Center
        ) {
            when {
                loading -> {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator()
                        Spacer(Modifier.height(8.dp))
                        Text(stringResource(R.string.cloud_preview_loading), style = MaterialTheme.typography.bodyMedium)
                    }
                }
                error != null -> {
                    Text(
                        stringResource(R.string.preview_pdf_load_failed),
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                currentBitmap != null -> {
                    Image(
                        bitmap = currentBitmap!!.asImageBitmap(),
                        contentDescription = stringResource(R.string.preview_pdf_page, currentPageIndex + 1, pageCount),
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(12.dp)
                            .graphicsLayer(
                                scaleX = scale,
                                scaleY = scale,
                                translationX = offsetX,
                                translationY = offsetY
                            )
                            .clip(RoundedCornerShape(8.dp)),
                        contentScale = ContentScale.Fit
                    )
                }
            }
        }

        // Bottom Controls: Page Navigation & Zoom Controls
        if (pageCount > 0) {
            Surface(
                modifier = Modifier.fillMaxWidth(),
                tonalElevation = 3.dp
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 8.dp)
                ) {
                    // Page Jump Slider
                    if (pageCount > 1) {
                        Slider(
                            value = currentPageIndex.toFloat(),
                            onValueChange = { currentPageIndex = it.toInt() },
                            valueRange = 0f..(pageCount - 1).toFloat(),
                            modifier = Modifier.fillMaxWidth().height(32.dp)
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(
                                onClick = { if (currentPageIndex > 0) currentPageIndex-- },
                                enabled = currentPageIndex > 0,
                                modifier = Modifier.size(48.dp)
                            ) {
                                Icon(Icons.Default.ChevronLeft, stringResource(R.string.preview_pdf_prev_page))
                            }

                            Text(
                                stringResource(R.string.preview_pdf_page, currentPageIndex + 1, pageCount),
                                style = MaterialTheme.typography.bodyMedium
                            )

                            IconButton(
                                onClick = { if (currentPageIndex < pageCount - 1) currentPageIndex++ },
                                enabled = currentPageIndex < pageCount - 1,
                                modifier = Modifier.size(48.dp)
                            ) {
                                Icon(Icons.Default.ChevronRight, stringResource(R.string.preview_pdf_next_page))
                            }
                        }

                        // Zoom Reset & Controls
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(
                                onClick = { scale = (scale - 0.5f).coerceAtLeast(1f); if (scale == 1f) { offsetX = 0f; offsetY = 0f } },
                                enabled = scale > 1f,
                                modifier = Modifier.size(48.dp)
                            ) {
                                Icon(Icons.Default.ZoomOut, stringResource(R.string.preview_pdf_zoom_out))
                            }

                            IconButton(
                                onClick = { scale = (scale + 0.5f).coerceAtMost(4f) },
                                enabled = scale < 4f,
                                modifier = Modifier.size(48.dp)
                            ) {
                                Icon(Icons.Default.ZoomIn, stringResource(R.string.preview_pdf_zoom_in))
                            }
                        }
                    }
                }
            }
        }
    }
}

private const val MAX_PDF_PREVIEW_BYTES = 50 * 1024 * 1024L // 50 MB ceiling for PDF preview
