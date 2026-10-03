package com.autogram.app.features.cloudtransfer.storage

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import org.junit.Assert.*
import org.junit.Test

class VerifiedStreamCopyTest {
    private val bytes = ByteArray(VerifiedStreamCopy.BUFFER_BYTES * 3 + 17) { (it * 31).toByte() }

    @Test fun exactCopyAndIndependentFullReadBack() {
        val written = ByteArrayOutputStream()
        var writerClosed = false
        var sourceClosed = false
        var readerClosed = false
        val progress = PublicationProgress()
        val result = VerifiedStreamCopy.publish(expected(bytes), {
            object : ByteArrayInputStream(bytes) { override fun close() { sourceClosed = true } }
        }, {
            object : OutputStream() {
                override fun write(value: Int) = written.write(value)
                override fun write(buffer: ByteArray, offset: Int, length: Int) = written.write(buffer, offset, length)
                override fun close() { writerClosed = true }
            }
        }, {
            assertTrue(writerClosed)
            object : ByteArrayInputStream(written.toByteArray()) { override fun close() { readerClosed = true } }
        }, {}, progress)
        assertArrayEquals(bytes, written.toByteArray())
        assertEquals(bytes.size.toLong(), result.bytesCopied)
        assertEquals(bytes.size.toLong(), result.bytesVerified)
        assertEquals(expected(bytes).sha256, result.sha256)
        assertTrue(sourceClosed && writerClosed && readerClosed)
        assertEquals(OutputPhase.COMPLETE, progress.phase)
    }

    @Test fun emptyFileStillRequiresReadBackAndHash() {
        val empty = byteArrayOf()
        var readBack = false
        val result = VerifiedStreamCopy.publish(expected(empty), { ByteArrayInputStream(empty) },
            { ByteArrayOutputStream() }, { readBack = true; ByteArrayInputStream(empty) }, {}, PublicationProgress())
        assertTrue(readBack)
        assertEquals(0, result.bytesVerified)
    }

    @Test fun earlyEofAndSourceGrowthAreRejected() {
        assertFault(OutputError.SOURCE_SIZE_MISMATCH, bytes.copyOf(bytes.size - 1), bytes)
        assertFault(OutputError.SOURCE_SIZE_MISMATCH, bytes + byteArrayOf(1), bytes)
    }

    @Test fun sourceHashMismatchNeverOpensVerification() {
        val different = bytes.clone().apply { this[4] = (this[4].toInt() xor 1).toByte() }
        assertFault(OutputError.SOURCE_HASH_MISMATCH, different, bytes)
    }

    @Test fun silentShortWriteIsDetectedByReadBack() {
        val output = ByteArrayOutputStream()
        val progress = PublicationProgress()
        val error = assertThrows(OutputFault::class.java) {
            VerifiedStreamCopy.publish(expected(bytes), { ByteArrayInputStream(bytes) }, {
                object : OutputStream() {
                    override fun write(value: Int) = Unit
                    override fun write(buffer: ByteArray, offset: Int, length: Int) {
                        output.write(buffer, offset, length - 1)
                    }
                }
            }, { ByteArrayInputStream(output.toByteArray()) }, {}, progress)
        }
        assertEquals(OutputError.OUTPUT_SIZE_MISMATCH, error.error)
        assertEquals(bytes.size.toLong(), progress.copied)
        assertTrue(progress.mayHaveWritten)
    }

    @Test fun sameLengthCorruptionIsDetected() {
        val corrupted = bytes.clone().apply { this[99] = (this[99].toInt() xor 1).toByte() }
        assertOutputFault(OutputError.OUTPUT_HASH_MISMATCH, corrupted)
    }

    @Test fun outputTruncationAndExtraBytesAreDetected() {
        assertOutputFault(OutputError.OUTPUT_SIZE_MISMATCH, bytes.copyOf(bytes.size - 1))
        assertOutputFault(OutputError.OUTPUT_SIZE_MISMATCH, bytes + byteArrayOf(1))
    }

    @Test fun providerCannotReportNoProgressForever() {
        var closed = false
        val error = assertThrows(OutputFault::class.java) {
            VerifiedStreamCopy.publish(expected(bytes), {
                object : InputStream() {
                    override fun read(): Int = 0
                    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = 0
                    override fun close() { closed = true }
                }
            }, { ByteArrayOutputStream() }, { fail("must not verify"); ByteArrayInputStream(bytes) }, {}, PublicationProgress())
        }
        assertEquals(OutputError.IO_FAILURE, error.error)
        assertTrue(closed)
    }

    @Test fun spaceFailureClosesBothStreamsAndTracksPossiblePartialChunk() {
        var inputClosed = false
        var outputClosed = false
        val progress = PublicationProgress()
        assertThrows(IOException::class.java) {
            VerifiedStreamCopy.publish(expected(bytes), {
                object : ByteArrayInputStream(bytes) { override fun close() { inputClosed = true } }
            }, {
                object : OutputStream() {
                    override fun write(value: Int) { throw IOException("test-owned failure") }
                    override fun close() { outputClosed = true }
                }
            }, { fail("must not verify"); ByteArrayInputStream(bytes) }, {}, progress)
        }
        assertTrue(inputClosed && outputClosed && progress.mayHaveWritten)
        assertEquals(0L, progress.copied)
    }

    @Test fun closeFailureCannotBecomeSuccess() {
        for (failWriter in listOf(true, false)) {
            assertThrows(IOException::class.java) {
                VerifiedStreamCopy.publish(expected(bytes), { ByteArrayInputStream(bytes) }, {
                    object : ByteArrayOutputStream() {
                        override fun close() { if (failWriter) throw IOException("writer close") }
                    }
                }, {
                    object : ByteArrayInputStream(bytes) { override fun close() { throw IOException("reader close") } }
                }, {}, PublicationProgress())
            }
        }
    }

    @Test fun flushFailureNeverVerifies() {
        assertThrows(IOException::class.java) {
            VerifiedStreamCopy.publish(expected(bytes), { ByteArrayInputStream(bytes) }, {
                object : ByteArrayOutputStream() { override fun flush() { throw IOException("flush") } }
            }, { fail("must not verify"); ByteArrayInputStream(bytes) }, {}, PublicationProgress())
        }
    }

    @Test fun nonReadableProviderFailsAfterCopy() {
        val progress = PublicationProgress()
        assertThrows(IOException::class.java) {
            VerifiedStreamCopy.publish(expected(bytes), { ByteArrayInputStream(bytes) },
                { ByteArrayOutputStream() }, { throw IOException("unreadable") }, {}, progress)
        }
        assertEquals(OutputPhase.VERIFY, progress.phase)
        assertEquals(bytes.size.toLong(), progress.copied)
    }

    @Test fun cancellationDuringCopyClosesResourcesAndNeverVerifies() {
        val cancellation = PublicationCancellation()
        var outputClosed = false
        val progress = PublicationProgress()
        assertThrows(CancellationException::class.java) {
            VerifiedStreamCopy.publish(expected(bytes), { cancellation.track(ByteArrayInputStream(bytes)) }, {
                cancellation.track(object : OutputStream() {
                    override fun write(value: Int) = Unit
                    override fun write(buffer: ByteArray, offset: Int, length: Int) { cancellation.cancel() }
                    override fun close() { outputClosed = true }
                })
            }, { fail("must not verify"); ByteArrayInputStream(bytes) }, cancellation::check, progress)
        }
        assertTrue(outputClosed)
        assertTrue(progress.copied <= VerifiedStreamCopy.BUFFER_BYTES)
    }

    @Test fun cancellationDuringReadBackPreventsSuccess() {
        val cancellation = PublicationCancellation()
        var closed = false
        assertThrows(CancellationException::class.java) {
            VerifiedStreamCopy.publish(expected(bytes), { ByteArrayInputStream(bytes) }, { ByteArrayOutputStream() }, {
                cancellation.track(object : ByteArrayInputStream(bytes) {
                    override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
                        super.read(buffer, offset, length).also { cancellation.cancel() }
                    override fun close() { closed = true }
                })
            }, cancellation::check, PublicationProgress())
        }
        assertTrue(closed)
    }

    @Test fun expectedIntegrityRejectsInvalidAndCopiesHashValue() {
        assertNull(ExpectedOutput.parse(-1, "0".repeat(64)))
        assertNull(ExpectedOutput.parse(1, "x".repeat(64)))
        assertNull(ExpectedOutput.parse(1, "0".repeat(63)))
        assertNull(ExpectedOutput.parse(1, " " + "0".repeat(64)))
        assertEquals("a".repeat(64), ExpectedOutput.parse(Long.MAX_VALUE, "A".repeat(64))!!.sha256)
    }

    @Test fun multiMegabyteStreamUsesBoundedReadAndWriteChunks() {
        val size = 16L * 1024 * 1024 + 17
        var largestRead = 0
        var largestWrite = 0
        fun generated() = object : InputStream() {
            var remaining = size
            override fun read(): Int = error("buffered read required")
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
                largestRead = maxOf(largestRead, length)
                if (remaining == 0L) return -1
                val count = minOf(remaining, length.toLong()).toInt()
                java.util.Arrays.fill(buffer, offset, offset + count, 7.toByte())
                remaining -= count
                return count
            }
        }
        val digest = MessageDigest.getInstance("SHA-256")
        generated().use { source ->
            val buffer = ByteArray(8192)
            while (true) { val n = source.read(buffer); if (n == -1) break; digest.update(buffer, 0, n) }
        }
        val expected = ExpectedOutput.parse(size, digest.digest().joinToString("") { "%02x".format(it) })!!
        val result = VerifiedStreamCopy.publish(expected, ::generated, {
            object : OutputStream() {
                override fun write(value: Int) = Unit
                override fun write(buffer: ByteArray, offset: Int, length: Int) { largestWrite = maxOf(largestWrite, length) }
            }
        }, ::generated, {}, PublicationProgress())
        assertEquals(size, result.bytesVerified)
        assertTrue(largestRead <= VerifiedStreamCopy.BUFFER_BYTES)
        assertTrue(largestWrite <= VerifiedStreamCopy.BUFFER_BYTES)
    }

    private fun assertFault(error: OutputError, source: ByteArray, original: ByteArray) {
        val fault = assertThrows(OutputFault::class.java) {
            VerifiedStreamCopy.publish(expected(original), { ByteArrayInputStream(source) }, { ByteArrayOutputStream() },
                { fail("must not verify"); ByteArrayInputStream(original) }, {}, PublicationProgress())
        }
        assertEquals(error, fault.error)
    }

    private fun assertOutputFault(error: OutputError, actual: ByteArray) {
        val fault = assertThrows(OutputFault::class.java) {
            VerifiedStreamCopy.publish(expected(bytes), { ByteArrayInputStream(bytes) }, { ByteArrayOutputStream() },
                { ByteArrayInputStream(actual) }, {}, PublicationProgress())
        }
        assertEquals(error, fault.error)
    }

    private fun expected(content: ByteArray) = ExpectedOutput.parse(content.size.toLong(),
        MessageDigest.getInstance("SHA-256").digest(content).joinToString("") { "%02x".format(it) })!!
}
