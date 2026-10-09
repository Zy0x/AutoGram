package com.autogram.app.features.workspace

import com.autogram.app.features.workspace.execution.ExecutionBoundary
import com.autogram.app.features.workspace.execution.PendingExecutionDomain
import org.junit.Assert.*
import org.junit.Test

class ExecutionBoundaryTest {
    @Test fun missingExecutorsNeverDispatchOrPublishSuccess() {
        PendingExecutionDomain.entries.forEach { domain ->
            val boundary = ExecutionBoundary(domain)
            assertFalse(domain.name, boundary.mayDispatch)
            assertFalse(domain.name, boundary.mayPublishSuccess)
        }
    }

    @Test fun eachPendingDomainOwnsAnExplicitDescription() {
        assertEquals(5, PendingExecutionDomain.entries.size)
        assertEquals(5, PendingExecutionDomain.entries.map { it.missingExecution }.distinct().size)
        assertTrue(PendingExecutionDomain.entries.all { it.title != 0 && it.missingExecution != 0 })
    }
}
