package com.autogram.app.features.workspace.execution

import androidx.annotation.StringRes
import com.autogram.app.R

/** A registered route is not proof that it owns an executable native service. */
enum class PendingExecutionDomain(
    @StringRes val title: Int,
    @StringRes val missingExecution: Int
) {
    FORWARDER(R.string.forwarder_title, R.string.execution_forwarder_boundary),
    AUTOMATION(R.string.automation_title, R.string.execution_automation_boundary),
    SYNC(R.string.sync_title, R.string.execution_sync_boundary),
    PROFILES(R.string.profiles_title, R.string.execution_profiles_boundary),
    JOBS(R.string.jobs_title, R.string.execution_jobs_boundary)
}

/** No queued/running/completed records may be manufactured for an absent executor. */
data class ExecutionBoundary(val domain: PendingExecutionDomain) {
    val mayDispatch: Boolean = false
    val mayPublishSuccess: Boolean = false
}
