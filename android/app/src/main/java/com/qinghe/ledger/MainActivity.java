package com.qinghe.ledger;

import android.Manifest;
import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ContentValues;
import android.content.ComponentName;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.hardware.biometrics.BiometricPrompt;
import android.hardware.fingerprint.FingerprintManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.ref.WeakReference;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import org.json.JSONObject;

/**
 * 记把好账 Android 壳。
 *
 * 1. 单文件 HTML 直接读入 WebView，用固定的应用内域名作为 base URL，保证 localStorage 有稳定 origin；
 *    页面不发起任何网络请求，APK 也不申请 INTERNET 权限；
 * 2. QHAndroid 桥负责 CSV / Excel / JSON 下载到系统“下载/记把好账”；
 * 3. QHNotify 桥只负责本地提醒所需的系统通知权限；
 * 4. QHQuick 桥负责悬浮球 / 通知栏快捷 / 桌面小组件 / 磁贴入口，统一走本地队列入账。
 */
public class MainActivity extends Activity {

    private static final String APP_HOST = "app.qinghe.local";
    private static final String BASE_URL = "https://" + APP_HOST + "/";
    private static final int REQ_FILE_CHOOSER = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean pageReady = false;
    private static final String TAG = "QHNotify";
    private static WeakReference<MainActivity> sInstance = new WeakReference<MainActivity>(null);
    private String deliveringQuick = "";
    private boolean openAddOnReady = false;
    private volatile boolean biometricInProgress = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        applySystemBars("#4F9D69", false);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#F3F7F2"));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#F3F7F2"));
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        // 彻底关闭 WebView 的网络加载，页面只来自 assets。
        settings.setBlockNetworkLoads(true);
        settings.setBlockNetworkImage(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setTextZoom(100);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // 页面内只允许应用自身域名；外部链接一律拦截，不交给浏览器。
                return !APP_HOST.equals(request.getUrl().getHost());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    Log.e(TAG, "页面加载失败：" + error.getDescription());
                }
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageReady = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageReady = true;
                ui.postDelayed(new Runnable() {
                    @Override public void run() { deliverPendingQuick(); }
                }, 800);
                if (openAddOnReady) {
                    openAddOnReady = false;
                    ui.postDelayed(new Runnable() {
                        @Override public void run() { openQuickPanel(); }
                    }, 30);
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(intent, "选择文件"), REQ_FILE_CHOOSER);
                } catch (Exception e) {
                    filePathCallback = null;
                    callback.onReceiveValue(null);
                    return false;
                }
                return true;
            }
        });

        sInstance = new WeakReference<MainActivity>(this);
        webView.addJavascriptInterface(new Bridge(), "QHAndroid");
        webView.addJavascriptInterface(new NotifyBridge(), "QHNotify");
        webView.addJavascriptInterface(new QuickBridge(), "QHQuick");
        // 悬浮球与通知栏快捷入口：开关打开时在启动阶段就恢复
        FloatingBallService.startIfEnabled(this);
        if (QuickStore.isNotifyQuickEnabled(this)) QuickNotification.post(this);
        openAddOnReady = getIntent() != null && getIntent().getBooleanExtra("quick_add", false);
        // 直接加载 assets 中的单文件页面：不经过网络栈，也不依赖 INTERNET 权限。
        try {
            webView.loadDataWithBaseURL(BASE_URL, readAsset("index.html"), "text/html", "UTF-8", null);
        } catch (IOException e) {
            Log.e(TAG, "读取内置页面失败", e);
            Toast.makeText(this, "页面加载失败，请重新安装", Toast.LENGTH_LONG).show();
        }
    }

    private String readAsset(String name) throws IOException {
        try (InputStream in = getAssets().open(name);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
            return out.toString("UTF-8");
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        ui.postDelayed(new Runnable() {
            @Override public void run() { deliverPendingQuick(); }
        }, 500);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null) {
            if (intent.getBooleanExtra("quick_add", false)) {
                openAddOnReady = true;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE_CHOOSER) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null && data.getData() != null) {
            result = new Uri[]{data.getData()};
        }
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(result);
            filePathCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("QHAndroid");
            webView.removeJavascriptInterface("QHNotify");
            webView.destroy();
            webView = null;
        }
        ui.removeCallbacksAndMessages(null);
        io.shutdownNow();
        super.onDestroy();
    }

    private void applySystemBars(String accent, boolean dark) {
        try {
            Window window = getWindow();
            window.setStatusBarColor(Color.parseColor(accent));
            window.setNavigationBarColor(Color.parseColor(dark ? "#0F1511" : "#F3F7F2"));
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
            if (!dark) flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            window.getDecorView().setSystemUiVisibility(flags);
        } catch (Exception ignored) { }
    }

    private static String safeFileName(String name) {
        String cleaned = name == null ? "" : name.trim();
        cleaned = cleaned.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_");
        if (cleaned.isEmpty()) cleaned = "qinghe-export";
        if (cleaned.length() > 120) cleaned = cleaned.substring(cleaned.length() - 120);
        return cleaned;
    }

    /** JS 桥：保存文件与更新系统栏。 */
    public class Bridge {
        @JavascriptInterface
        public void saveFile(String fileName, String mimeType, String base64) {
            final String name = safeFileName(fileName);
            final String mime = (mimeType == null || mimeType.isEmpty())
                    ? "application/octet-stream" : mimeType;
            final byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (Exception e) {
                toast("文件内容解析失败");
                return;
            }
            io.execute(new Runnable() {
                @Override public void run() { saveBytes(name, mime, bytes); }
            });
        }

        @JavascriptInterface
        public void setTheme(final String accent, final boolean dark) {
            runOnUiThread(new Runnable() {
                @Override public void run() { applySystemBars(accent, dark); }
            });
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public String biometricStatus() {
            return biometricStatusInternal();
        }

        @JavascriptInterface
        public void authenticateBiometric() {
            startBiometricAuth();
        }
    }

    /* ---------------- 指纹解锁（Android 原生 BiometricPrompt） ---------------- */

    private String biometricStatusInternal() {
        if (Build.VERSION.SDK_INT < 28) return "unsupported";
        try {
            FingerprintManager fm = getSystemService(FingerprintManager.class);
            if (fm == null || !fm.isHardwareDetected()) return "no_hardware";
            if (!fm.hasEnrolledFingerprints()) return "not_enrolled";
            return "ok";
        } catch (Exception e) {
            return "unavailable";
        }
    }

    private void startBiometricAuth() {
        if (Build.VERSION.SDK_INT < 28) {
            notifyBiometric(false, "unsupported");
            return;
        }
        if (biometricInProgress) return;
        String status = biometricStatusInternal();
        if (!"ok".equals(status)) {
            notifyBiometric(false, status);
            return;
        }
        biometricInProgress = true;
        runOnUiThread(new Runnable() {
            @Override public void run() {
                if (webView == null || isFinishing()) {
                    biometricInProgress = false;
                    return;
                }
                try {
                    ModernBiometric.authenticate(MainActivity.this, new BiometricCallback() {
                        @Override public void onResult(boolean ok, String message) {
                            biometricInProgress = false;
                            notifyBiometric(ok, message);
                        }

                        @Override public void onFailed() {
                            notifyBiometricFailed();
                        }
                    });
                } catch (Exception e) {
                    biometricInProgress = false;
                    notifyBiometric(false, "unavailable");
                }
            }
        });
    }

    private void notifyBiometric(final boolean ok, final String message) {
        if (webView == null) return;
        final String js = "window.QHSecurity && QHSecurity.onBiometricResult("
                + (ok ? "true" : "false") + ","
                + JSONObject.quote(message == null ? "" : message) + ")";
        runOnUiThread(new Runnable() {
            @Override public void run() {
                if (webView != null) webView.evaluateJavascript(js, null);
            }
        });
    }

    private void notifyBiometricFailed() {
        if (webView == null) return;
        runOnUiThread(new Runnable() {
            @Override public void run() {
                if (webView != null) {
                    webView.evaluateJavascript("window.QHSecurity && QHSecurity.onBiometricFailed()", null);
                }
            }
        });
    }

    private interface BiometricCallback {
        void onResult(boolean ok, String message);
        void onFailed();
    }

    @TargetApi(28)
    private static class ModernBiometric {
        static void authenticate(final Activity activity, final BiometricCallback callback) {
            final AtomicBoolean finished = new AtomicBoolean(false);
            final BiometricPrompt prompt = new BiometricPrompt.Builder(activity)
                    .setTitle("解锁记把好账")
                    .setSubtitle("请验证设备指纹")
                    .setNegativeButton("取消", activity.getMainExecutor(), new DialogInterface.OnClickListener() {
                        @Override public void onClick(DialogInterface dialog, int which) {
                            finish(finished, callback, false, "cancel");
                        }
                    })
                    .setDeviceCredentialAllowed(false)
                    .build();
            CancellationSignal signal = new CancellationSignal();
            prompt.authenticate(signal, activity.getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                    finish(finished, callback, true, "");
                }

                @Override public void onAuthenticationFailed() {
                    if (!finished.get()) callback.onFailed();
                }

                @Override public void onAuthenticationError(int errorCode, CharSequence errString) {
                    finish(finished, callback, false,
                            errString == null ? "error" : errString.toString());
                }
            });
        }

        private static void finish(AtomicBoolean finished, BiometricCallback callback,
                                   boolean ok, String message) {
            if (finished.compareAndSet(false, true)) callback.onResult(ok, message);
        }
    }

    /** JS 桥：本地提醒所需的系统通知权限（不读取任何通知内容）。 */
    public class NotifyBridge {

        @JavascriptInterface
        public void openSettings(String kind) {
            Intent intent;
            try {
                if ("overlay".equals(kind)) {
                    intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + getPackageName()));
                } else if ("battery".equals(kind)) {
                    intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                            Uri.parse("package:" + getPackageName()));
                } else if ("notifications".equals(kind)) {
                    intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    intent.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                } else {
                    intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:" + getPackageName()));
                }
                startActivity(intent);
            } catch (Exception e) {
                toast("无法打开系统设置，请在系统设置中手动开启");
            }
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            if (Build.VERSION.SDK_INT < 33) return;
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
            SharedPreferences sp = getSharedPreferences("qinghe_notify", MODE_PRIVATE);
            if (sp.getBoolean("asked", false)) {
                openSettings("notifications");
                return;
            }
            sp.edit().putBoolean("asked", true).apply();
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 9);
        }

        @JavascriptInterface
        public void notify(String title, String body, String tag) {
            if (Build.VERSION.SDK_INT >= 33 &&
                    checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                return;
            }
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            String channelId = "qinghe_reminders";
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel channel = new NotificationChannel(
                        channelId, "记账提醒", NotificationManager.IMPORTANCE_DEFAULT);
                channel.setDescription("每日记账、消费小结与周期总结");
                nm.createNotificationChannel(channel);
            }
            Intent open = new Intent(MainActivity.this, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pi = PendingIntent.getActivity(
                    MainActivity.this, 0, open,
                    Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
            Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(MainActivity.this, channelId)
                    : new Notification.Builder(MainActivity.this);
            builder.setSmallIcon(android.R.drawable.ic_popup_reminder)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body))
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            int id = (tag == null || tag.isEmpty()) ? 1001 : tag.hashCode();
            nm.notify(id, builder.build());
        }

        @JavascriptInterface
        public boolean notificationGranted() {
            if (Build.VERSION.SDK_INT < 33) return true;
            return checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
    }

    // ---------- 快速记账（悬浮球 / 通知栏 / 桌面小组件）----------

    /** 悬浮球、通知栏快捷按钮、桌面小组件入队后调用：让页面立刻把队列写进账本。 */
    public static void pushQuickToApp() {
        MainActivity activity = sInstance == null ? null : sInstance.get();
        if (activity == null) return;
        final MainActivity target = activity;
        target.ui.post(new Runnable() {
            @Override public void run() { target.deliverPendingQuick(); }
        });
    }

    /** 通知栏「记一笔」入口：打开 App 内的记账面板。 */
    private void openQuickPanel() {
        if (webView == null || !pageReady) return;
        webView.evaluateJavascript(
                "(function(){try{window.QHApp&&window.QHApp.openCatPicker&&window.QHApp.openCatPicker();}catch(e){}})()",
                null);
    }

    private void deliverPendingQuick() {
        if (webView == null || !pageReady) return;
        String json = QuickStore.first(this);
        if (json == null || json.isEmpty()) return;
        if (json.equals(deliveringQuick)) return;
        deliveringQuick = json;
        deliverQuickAttempt(json, 0);
    }

    private void deliverQuickAttempt(final String json, final int attempt) {
        if (webView == null) return;
        webView.evaluateJavascript(
                "(function(){try{return !!(window.QHApp&&window.QHApp.commitQuick&&window.QHApp.commitQuick(" + json + "));}catch(e){return false;}})()",
                new ValueCallback<String>() {
                    @Override public void onReceiveValue(String value) {
                        if (value != null && value.contains("true")) {
                            QuickStore.popFirst(MainActivity.this);
                            deliveringQuick = "";
                            ui.postDelayed(new Runnable() {
                                @Override public void run() { deliverPendingQuick(); }
                            }, 150);
                        } else if (attempt < 2) {
                            ui.postDelayed(new Runnable() {
                                @Override public void run() { deliverQuickAttempt(json, attempt + 1); }
                            }, 700);
                        } else {
                            deliveringQuick = "";
                            Log.w(TAG, "quick commit rejected, keep it in queue");
                        }
                    }
                });
    }

    /** 前端 QHQuick：悬浮球 / 通知栏 / 桌面小组件的开关与权限。 */
    public class QuickBridge {

        @JavascriptInterface
        public boolean isBallEnabled() { return QuickStore.isBallEnabled(MainActivity.this); }

        @JavascriptInterface
        public void setBallEnabled(final boolean enabled) {
            QuickStore.setBallEnabled(MainActivity.this, enabled);
            ui.post(new Runnable() {
                @Override public void run() {
                    if (enabled) FloatingBallService.start(MainActivity.this);
                    else FloatingBallService.stop(MainActivity.this);
                }
            });
        }

        @JavascriptInterface
        public boolean isNotifyQuickEnabled() { return QuickStore.isNotifyQuickEnabled(MainActivity.this); }

        @JavascriptInterface
        public void setNotifyQuickEnabled(boolean enabled) {
            QuickStore.setNotifyQuickEnabled(MainActivity.this, enabled);
            if (enabled) QuickNotification.post(MainActivity.this);
            else QuickNotification.cancel(MainActivity.this);
        }

        @JavascriptInterface
        public boolean overlayGranted() { return QuickStore.canOverlay(MainActivity.this); }

        @JavascriptInterface
        public void openSettings(String kind) {
            String k = kind == null ? "" : kind;
            try {
                Intent intent;
                if ("overlay".equals(k)) {
                    intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + getPackageName()));
                } else if ("notification".equals(k)) {
                    intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    intent.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                } else {
                    intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:" + getPackageName()));
                }
                startActivity(intent);
            } catch (Throwable e) {
                Log.w(TAG, "openSettings failed", e);
            }
        }
    }

    private void saveBytes(String name, String mime, byte[] bytes) {
        String message;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                        Environment.DIRECTORY_DOWNLOADS + "/记把好账");
                values.put(MediaStore.MediaColumns.IS_PENDING, 1);

                Uri uri = getContentResolver()
                        .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) throw new IOException("无法创建下载文件");
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new IOException("无法写入下载文件");
                    out.write(bytes);
                    out.flush();
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                getContentResolver().update(uri, done, null, null);
                message = "已保存到 下载/记把好账/" + name;
            } else {
                File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "记把好账");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("无法创建目录");
                File file = new File(dir, name);
                try (FileOutputStream out = new FileOutputStream(file)) {
                    out.write(bytes);
                    out.flush();
                }
                message = "已保存到 " + file.getAbsolutePath();
            }
        } catch (Exception e) {
            message = "保存失败：" + (e.getMessage() == null ? "未知错误" : e.getMessage());
        }
        final String text = message;
        runOnUiThread(new Runnable() {
            @Override public void run() {
                Toast.makeText(MainActivity.this, text, Toast.LENGTH_LONG).show();
            }
        });
    }

    private void toast(final String message) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
            }
        });
    }
}
