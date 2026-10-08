package com.autogram.app.features.cloud

import com.autogram.app.features.cloud.preview.controls.*
import org.junit.Assert.*
import org.junit.Test

class PreviewToolsRegistryTest {
    @Test fun obsoleteViewerCleanupCannotClearItsSuccessor() {
        val registry = PreviewToolsRegistry()
        val oldOwner = Any()
        val currentOwner = Any()
        val tools = listOf(PreviewTool("current", "fixture"))
        registry.publish(oldOwner, listOf(PreviewTool("old", "fixture")), true)
        registry.publish(currentOwner, tools, false)
        registry.clear(oldOwner)
        assertSame(tools, registry.tools)
        assertFalse(registry.navigationLocked)
    }
    @Test fun currentOwnerDisposalClearsToolsAndNavigationLock() {
        val registry = PreviewToolsRegistry()
        val owner = Any()
        registry.publish(owner, listOf(PreviewTool("lock", "fixture")), true)
        assertTrue(registry.navigationLocked)
        registry.clear(owner)
        assertTrue(registry.tools.isEmpty())
        assertFalse(registry.navigationLocked)
    }
    @Test fun repeatedPublicationPreservesTheSameRememberedList() {
        val registry = PreviewToolsRegistry()
        val owner = Any()
        val tools = listOf(PreviewTool("fixture", "fixture"))
        registry.publish(owner, tools, false)
        registry.publish(owner, tools, false)
        assertSame(tools, registry.tools)
    }
}
