# 记把好账 Android 壳（v2.0.0）

WebView 壳 + 本地单文件页面。账目全部写入 WebView 的 localStorage，原生层只提供文件保存、通知、悬浮球、快捷入口和本地指纹验证。

## 目录

```text
android/
├── settings.gradle.kts
├── build.gradle.kts
├── gradle.properties
└── app/
    ├── build.gradle.kts
    └── src/main/
        ├── AndroidManifest.xml
        ├── assets/index.html        # tools/build_single.py 生成后复制进来
        ├── java/com/qinghe/ledger/
        │   ├── MainActivity.java    # WebView、assets 加载、BiometricPrompt、文件桥
        │   ├── QuickStore.java
        │   ├── QuickAddReceiver.java
        │   ├── QuickNotification.java
        │   ├── QuickTileService.java
        │   └── FloatingBallService.java
        └── res/
```

## 构建

```powershell
# 在仓库根目录
python tools/build_single.py
Copy-Item dist/记把好账.html android/app/src/main/assets/index.html -Force

$env:JAVA_HOME = "C:\path\to\jdk-17"
$env:ANDROID_HOME = "C:\path\to\android-sdk"
$env:ANDROID_USER_HOME = "C:\path\to\.android-home"
$env:GRADLE_USER_HOME = "C:\path\to\.gradle-home"
& "C:\path\to\gradle-8.13\bin\gradle.bat" -p android :app:assembleRelease --offline
```

输出：`android/app/build/outputs/apk/release/app-release.apk`。

## 关键实现

- 页面 `loadDataWithBaseURL("https://app.qinghe.local/", html, ...)`，保持 localStorage origin，不走网络。
- `setBlockNetworkLoads(true)`、`setBlockNetworkImage(true)`，外部链接拦截。
- `QHAndroid` 桥：保存 CSV / Excel / JSON、系统栏主题。
- `QHNotify` 桥：通知权限、系统设置入口。
- `QHQuick` 桥：悬浮球 / 通知栏 / 磁贴队列。
- `QHAndroid.biometricStatus()` / `authenticateBiometric()`：Android 9+ `BiometricPrompt`，只允许指纹，结果通过 `QHSecurity.onBiometricResult` 回传。
- 不申请 `INTERNET`，不读通知内容，不申请无障碍 / 录屏 / 相册权限。

## 签名

当前 release 使用本机 Android 调试证书（`signingConfig = debug`），可直接侧载，但不是应用商店签名。正式发布请替换为自己的 signingConfig，且不要提交 keystore。
