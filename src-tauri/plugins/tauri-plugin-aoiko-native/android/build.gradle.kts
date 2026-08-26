import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    // Java の予約語 native は package 名に使えないので nativeplugin にしてある。
    namespace = "net.lonshaus.aoiko.nativeplugin"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
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
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlin {
        compilerOptions {
            jvmTarget = JvmTarget.JVM_1_8
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    // アプリ内ブラウザ。外部ブラウザへ飛ばすと戻り先が保証されない。
    // 1.10.0 は kotlin-stdlib 2.1.20 を要求し、テンプレの ネイティブ側 1.9.25 では読めない。
    implementation("androidx.browser:browser:1.9.0")
    // 文字認識。同梱版でないと 商店 服務を要求してしまい、離線で使えなくなる。
    implementation("com.google.mlkit:text-recognition-japanese:16.0.1")
    implementation(project(":tauri-android"))
}
