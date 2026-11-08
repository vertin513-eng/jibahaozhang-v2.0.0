package com.qinghe.ledger;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * 通知栏常驻「记一笔」快捷入口（方案 2）。
 *
 * 常驻通知里带三个按钮：打开记账面板 / 早餐 ¥10 / 午餐 ¥20，点一下即入队。
 * 不需要悬浮窗权限，作为悬浮球的补充；关掉开关就会撤掉这条通知。
 */
public final class QuickNotification {

    private static final int ID = 9200;
    private static final String CHANNEL = "qinghe_quick_shortcut";

    private QuickNotification() { }

    public static void post(Context c) {
        post(c, "");
    }

    public static void updateIfShown(Context c, String message) {
        if (QuickStore.isNotifyQuickEnabled(c)) post(c, message);
    }

    public static void post(Context c, String message) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "快捷记账入口",
                        NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("常驻通知，点一下即可记一笔");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }

            Intent open = new Intent(c, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            open.putExtra("quick_add", true);
            int flag = Build.VERSION.SDK_INT >= 23
                    ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    : PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent openPi = PendingIntent.getActivity(c, 9201, open, flag);

            Notification.Builder b = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(c, CHANNEL) : new Notification.Builder(c);
            b.setSmallIcon(android.R.drawable.ic_menu_edit)
                    .setContentTitle(message == null || message.isEmpty() ? "记把好账 · 快捷记账" : message)
                    .setContentText("点「记一笔」打开记账面板，或直接点常用三餐")
                    .setOngoing(true)
                    .setShowWhen(false)
                    .setContentIntent(openPi)
                    .addAction(android.R.drawable.ic_menu_add, "记一笔", openPi)
                    .addAction(android.R.drawable.ic_menu_today, "早餐 ¥10", quickPi(c, 9202, "breakfast", 10d))
                    .addAction(android.R.drawable.ic_menu_today, "午餐 ¥20", quickPi(c, 9203, "lunch", 20d));
            nm.notify(ID, b.build());
        } catch (Throwable ignored) {
            // 通知不可用时静默失败，不影响其他入口
        }
    }

    public static void cancel(Context c) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(ID);
        } catch (Throwable ignored) { }
    }

    private static PendingIntent quickPi(Context c, int code, String category, double amount) {
        Intent i = new Intent(c, QuickAddReceiver.class);
        i.setAction(QuickAddReceiver.ACTION_QUICK);
        i.putExtra("category", category);
        i.putExtra("amount", amount);
        int flag = Build.VERSION.SDK_INT >= 23
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT;
        return PendingIntent.getBroadcast(c, code, i, flag);
    }
}