package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.preview.*
import org.junit.Assert.*
import org.junit.Test

class PlaybackHistoryTest {
    private class Memory : PlaybackHistoryStorage {
        val records = mutableMapOf<String, Long>()
        override fun long(key: String) = records[key] ?: 0
        override fun save(key: String, position: Long, updated: Long) {
            records["position_$key"] = position; records["time_$key"] = updated
        }
        override fun remove(key: String) { records.remove("position_$key"); records.remove("time_$key") }
    }
    @Test fun historyIsScopedByAccountPeerAndMessage() {
        val storage = Memory()
        val history = PlaybackHistory(storage) { 1000 }
        val scope = PlaybackScope("account-A", "peer", 1)
        history.save(scope, 60000)
        assertEquals(60000L, history.position(scope))
        assertEquals(0L, history.position(scope.copy(account = "account-B")))
        assertEquals(0L, history.position(scope.copy(peer = "other")))
        assertEquals(0L, history.position(scope.copy(message = 2)))
        assertFalse(storage.records.keys.any { it.contains("account") || it.contains("peer") })
    }
    @Test fun expiryAndClockRollbackRemoveOnlyThatPosition() {
        var time = 1000L
        val storage = Memory()
        val history = PlaybackHistory(storage) { time }
        val scope = PlaybackScope("A", "me", 1)
        history.save(scope, 123)
        time += PlaybackHistory.EXPIRY_MS + 1
        assertEquals(0L, history.position(scope)); assertTrue(storage.records.isEmpty())
        history.save(scope, 123); time--
        assertEquals(0L, history.position(scope)); assertTrue(storage.records.isEmpty())
    }
    @Test fun completedOrEmptyPositionDoesNotResume() {
        val history = PlaybackHistory(Memory()) { 1000 }
        val scope = PlaybackScope("A", "me", 1)
        history.save(scope, 10); history.clear(scope)
        assertEquals(0L, history.position(scope))
        history.save(scope, 10); history.save(scope, 0)
        assertEquals(0L, history.position(scope))
    }
}
