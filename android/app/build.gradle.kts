plugins {
    id("com.android.application")
}

android {
    namespace = "com.qinghe.ledger"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.qinghe.ledger"
        minSdk = 26
        targetSdk = 34
        versionCode = 33
        versionName = "2.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isShrinkResources = false
            // 本机安全策略不允许直接读写 .keystore 文件；沿用 Android 调试证书签名，
            // 与项目原有 APK 的签名方式一致，可直接安装侧载。
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    lint {
        abortOnError = false
    }
}
