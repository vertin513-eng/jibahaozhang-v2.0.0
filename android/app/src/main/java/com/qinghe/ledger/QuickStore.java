package com.qinghe.ledger;

import android.content.Context;
import android.content.SharedPreferences;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 快速记账（悬浮球 / 通知栏快捷 / 桌面小组件）的开关、悬浮球位置与待入账队列。
 *
 * 三种入口都只把账单写进本地队列，App 打开或回到前台时由 MainActivity 取走并
 * 交给 QHApp.commitQuick() 入账；核心账本（localStorage qinghe.ledger.v1）不改结构。
 */
public final class QuickStore {

    public static final String PREFS = "qinghe_quick";
    private static final String BALL = "ball_enabled";
    private static final String NOTIFY_QUICK = "notify_quick_enabled";
    private static final String BALL_X = "ball_x";
    private static final String BALL_Y = "ball_y";
    private static final String QUEUE = "queue";
    private static final String LAST_CAT = "last_cat";
    private static final String QUICK_DATE = "quick_date";
    private static final String QUICK_COUNT = "quick_count";
    private static final int QUEUE_MAX = 50;

    private QuickStore() { }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static boolean isBallEnabled(Context c) {
        return prefs(c).getBoolean(BALL, false);
    }

    public static void setBallEnabled(Context c, boolean v) {
        prefs(c).edit().putBoolean(BALL, v).apply();
    }

    /** 通知栏常驻「记一笔」快捷入口开关。 */
    public static boolean isNotifyQuickEnabled(Context c) {
        return prefs(c).getBoolean(NOTIFY_QUICK, false);
    }

    public static void setNotifyQuickEnabled(Context c, boolean v) {
        prefs(c).edit().putBoolean(NOTIFY_QUICK, v).apply();
    }

    public static boolean canOverlay(Context c) {
        try {
            return Settings.canDrawOverlays(c);
        } catch (Throwable e) {
            return false;
        }
    }

    public static int ballX(Context c) { return prefs(c).getInt(BALL_X, -1); }

    public static int ballY(Context c) { return prefs(c).getInt(BALL_Y, 320); }

    public static void saveBallPosition(Context c, int x, int y) {
        prefs(c).edit().putInt(BALL_X, x).putInt(BALL_Y, y).apply();
    }

    public static String lastCategory(Context c) {
        return prefs(c).getString(LAST_CAT, "lunch");
    }

    public static void setLastCategory(Context c, String cat) {
        prefs(c).edit().putString(LAST_CAT, cat == null ? "other" : cat).apply();
    }

    /** 快速记一笔：写进本地队列（App 下次打开/回到前台自动入账）。 */
    public static void enqueue(Context c, String category, double amount, String note, String source) {
        if (amount <= 0d) return;
        try {
            JSONObject o = new JSONObject();
            String cat = (category == null || category.isEmpty()) ? "other" : category;
            o.put("category", cat);
            o.put("amount", Math.round(amount * 100d) / 100d);
            o.put("note", note == null ? "" : note);
            o.put("type", "income".equals(cat) ? "income" : "expense");
            Date now = new Date();
            o.put("date", new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(now));
            o.put("time", new SimpleDateFormat("HH:mm", Locale.CHINA).format(now));
            o.put("source", source == null ? "quick" : source);
            JSONArray arr = queue(c);
            arr.put(o);
            while (arr.length() > QUEUE_MAX) arr.remove(0);
            prefs(c).edit().putString(QUEUE, arr.toString()).apply();
        } catch (Throwable ignored) {
            // 入队失败不影响用户继续操作，App 内仍可手动记账
        }
    }

    public static JSONArray queue(Context c) {
        try {
            return new JSONArray(prefs(c).getString(QUEUE, "[]"));
        } catch (Throwable e) {
            return new JSONArray();
        }
    }

    public static int queueSize(Context c) {
        return queue(c).length();
    }

    public static String first(Context c) {
        JSONObject o = queue(c).optJSONObject(0);
        return o == null ? "" : o.toString();
    }

    public static void popFirst(Context c) {
        JSONArray arr = queue(c);
        if (arr.length() == 0) return;
        JSONArray out = new JSONArray();
        for (int i = 1; i < arr.length(); i++) out.put(arr.opt(i));
        prefs(c).edit().putString(QUEUE, out.toString()).apply();
    }
}