plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val nativeAbis = listOf("arm64-v8a", "armeabi-v7a", "x86_64", "x86")
val nativeLibraries = nativeAbis.map { abi ->
    abi to layout.projectDirectory.file("src/main/jniLibs/$abi/libautogram_android_bridge.so").asFile
}

// Kotlin-only compilation is useful, but a distributable APK must contain the engine.
val verifyNativeEngine by tasks.registering {
    group = "verification"
    description = "Reject missing or wrong-architecture AutoGram native libraries before APK packaging"
    val libraries = nativeLibraries
    inputs.files(libraries.map { it.second })
    doLast {
        val machines = mapOf("arm64-v8a" to 183, "armeabi-v7a" to 40, "x86_64" to 62, "x86" to 3)
        libraries.forEach { (abi, library) ->
            check(library.isFile) {
                "Missing AutoGram engine for $abi. Run android/build_android.ps1 before packaging."
            }
            val header = library.inputStream().use { it.readNBytes(20) }
            check(header.size == 20 && header.take(4) == listOf<Byte>(127, 69, 76, 70)) {
                "Invalid ELF engine for $abi: ${library.name}"
            }
            val expectedClass = if (abi in listOf("arm64-v8a", "x86_64")) 2 else 1
            val machine = (header[18].toInt() and 255) or ((header[19].toInt() and 255) shl 8)
            check(header[4].toInt() == expectedClass && header[5].toInt() == 1 && machine == machines[abi]) {
                "AutoGram engine architecture does not match $abi"
            }
        }
    }
}
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("NativeLibs") }.configureEach {
    dependsOn(verifyNativeEngine)
}

android {
    namespace = "com.autogram.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.autogram.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 3850
        versionName = "3.8.50"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }

        ndk {
            abiFilters.addAll(nativeAbis)
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
    splits {
        abi {
            isEnable = true
            reset()
            include(*nativeAbis.toTypedArray())
            isUniversalApk = true
        }
    }
}

dependencies {
    // AndroidX & Compose Core
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")
    implementation("androidx.activity:activity-compose:1.9.1")

    // Jetpack Compose & Material 3
    implementation(platform("androidx.compose:compose-bom:2024.08.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.7.7")
    implementation("io.coil-kt:coil-compose:2.7.0")

    // Kotlin Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // Mozilla UniFFI JNA Backend
    implementation("net.java.dev.jna:jna:5.14.0@aar")

    // Testing
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation(platform("androidx.compose:compose-bom:2024.08.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
