package com.autogram.app.runtime

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeRuntimeAuthTest {
    @Test fun accountInvalidationSurvivesWithoutAnEventSubscriber() {
        val before = NativeRuntime.accountRevision.value
        NativeRuntime.invalidate("authorized_account_changed")
        assertEquals(before + 1, NativeRuntime.accountRevision.value)
    }

    @Test fun unrelatedEventsCannotManufactureAnAccountSwitch() {
        val before = NativeRuntime.accountRevision.value
        NativeRuntime.invalidate("transfer_task_changed")
        NativeRuntime.invalidate("drive_items_changed")
        NativeRuntime.invalidate("unknown_event")
        assertEquals(before, NativeRuntime.accountRevision.value)
    }
}
