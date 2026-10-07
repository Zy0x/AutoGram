package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.topics.currentDriveLocation
import com.autogram.app.features.cloud.topics.resolveDriveLocation
import org.junit.Assert.*
import org.junit.Test

class DriveLocationMetadataTest {
    @Test fun cachedGroupCannotHideServerForumCapability() {
        val old = CloudLocation("group-1", "Old title", "group")
        val live = old.copy(title = "Server title", kind = "forum")
        assertEquals(live, resolveDriveLocation(old, listOf(live)))
    }
    @Test fun cachedForumCannotInventCapabilityOnCurrentChannel() {
        val old = CloudLocation("group-1", "Old title", "forum")
        val live = old.copy(kind = "channel")
        assertEquals(live, resolveDriveLocation(old, listOf(live)))
    }
    @Test fun pagingDoesNotGuessCapabilityFromNameOrOtherPeer() {
        val channel = CloudLocation("channel", "Forum Topics", "channel")
        assertEquals(channel, resolveDriveLocation(channel, emptyList()))
        assertNull(currentDriveLocation("different", listOf(channel)))
    }
}
