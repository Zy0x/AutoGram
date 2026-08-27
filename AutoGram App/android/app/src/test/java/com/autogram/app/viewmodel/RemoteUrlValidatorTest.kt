package com.autogram.app.viewmodel

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RemoteUrlValidatorTest {
    @Test
    fun acceptsHttpAndHttpsAndNormalizesHost() {
        assertEquals("example.com", RemoteUrlValidator.parseHost(" https://EXAMPLE.com/media?id=4 "))
        assertEquals("cdn.example.com", RemoteUrlValidator.parseHost("http://cdn.example.com/file.mp4"))
    }

    @Test
    fun rejectsUnsafeOrIncompleteUrls() {
        assertNull(RemoteUrlValidator.parseHost("javascript:alert(1)"))
        assertNull(RemoteUrlValidator.parseHost("example.com/video"))
        assertNull(RemoteUrlValidator.parseHost("https:///missing-host"))
    }
}
