package com.autogram.app.features.cloud.topics

import com.autogram.app.features.cloud.CloudLocation

/** Recent-location records are navigation hints, never authoritative capabilities. */
fun resolveDriveLocation(requested: CloudLocation, live: List<CloudLocation>): CloudLocation =
    live.firstOrNull { it.id == requested.id } ?: requested

fun currentDriveLocation(peerId: String, live: List<CloudLocation>): CloudLocation? =
    live.firstOrNull { it.id == peerId }
