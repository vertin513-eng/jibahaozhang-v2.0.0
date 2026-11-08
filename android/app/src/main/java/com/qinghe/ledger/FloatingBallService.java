package com.qinghe.ledger;

import android.animation.ValueAnimator;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 悬浮球快捷记账。
 *
 * 交互（v1.6.1）：
 * 1. 小球可拖动，松手自动吸附到屏幕左侧或右侧，位置记忆；
 * 2. 收起时只留迷你侧边图标，点一下展开完整记账卡片；
 * 3. 卡片里选分类、按数字键盘、点保存 → 写进本地队列，App 打开时自动入账；
 * 4. 不含任何 OCR / 相册 / 截图逻辑。
 */
public class FloatingBallService extends Service {

    private static final String CHANNEL = "qinghe_ball";
    private static final int NOTIF_ID = 9100;
    private static final int BALL_DP = 54;
    private static final int PANEL_MAX_DP = 320;
    private static final String[][] CATS = {
            {"breakfast", "早餐"}, {"lunch", "午餐"}, {"dinner", "晚餐"},
            {"transport", "交通"}, {"shopping", "购物"}, {"entertainment", "娱乐"},
            {"daily", "日用"}, {"bath", "洗澡"}, {"water", "饮水"},
            {"housing", "住房"}, {"other", "其他"}, {"income", "收入"}
    };

    private WindowManager wm;
    private TextView ball;
    private LinearLayout panel;
    private WindowManager.LayoutParams ballParams;
    private WindowManager.LayoutParams panelParams;

    private int screenW;
    private int screenH;
    private int ballSize;
    private int panelW;

    private boolean panelOpen;
    private boolean dragging;
    private float downRawX;
    private float downRawY;
    private int startX;
    private int startY;

    private String category = "lunch";
    private String amountText = "";
    private TextView amountView;
    private TextView catHint;
    private final List<TextView> chips = new ArrayList<TextView>();

    // ---------------- 生命周期 ----------------

    public static void start(Context context) {
        try {
            Intent i = new Intent(context, FloatingBallService.class);
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i);
            else context.startService(i);
        } catch (Throwable ignored) { }
    }

    public static void stop(Context context) {
        try {
            context.stopService(new Intent(context, FloatingBallService.class));
        } catch (Throwable ignored) { }
    }

    public static void startIfEnabled(Context context) {
        if (QuickStore.isBallEnabled(context) && QuickStore.canOverlay(context)) start(context);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        startForegroundNotice();
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        DisplayMetrics dm = getResources().getDisplayMetrics();
        screenW = dm.widthPixels;
        screenH = dm.heightPixels;
        ballSize = dp(BALL_DP);
        panelW = Math.min(screenW - dp(24), dp(PANEL_MAX_DP));
        category = QuickStore.lastCategory(this);
        createBall();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        hidePanel();
        if (ball != null && ball.getParent() != null) {
            try { wm.removeView(ball); } catch (Throwable ignored) { }
        }
        ball = null;
        super.onDestroy();
    }

    private void startForegroundNotice() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm == null) return;
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "悬浮球",
                        NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("常驻一个小球，点一下快速记一笔");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
            Intent open = new Intent(this, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            int flag = Build.VERSION.SDK_INT >= 23
                    ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    : PendingIntent.FLAG_UPDATE_CURRENT;
            PendingIntent pi = PendingIntent.getActivity(this, 9101, open, flag);
            Notification.Builder b = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
            b.setSmallIcon(android.R.drawable.ic_menu_edit)
                    .setContentTitle("记把好账 · 悬浮球已开启")
                    .setContentText("点小球记一笔，可拖动到屏幕边缘")
                    .setOngoing(true)
                    .setShowWhen(false)
                    .setContentIntent(pi);
            startForeground(NOTIF_ID, b.build());
        } catch (Throwable ignored) { }
    }

    // ---------------- 小球 ----------------

    private void createBall() {
        ball = new TextView(this);
        ball.setText("记");
        ball.setTextColor(Color.WHITE);
        ball.setTextSize(17);
        ball.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(Color.parseColor("#4F9D69"));
        bg.setStroke(dp(2), Color.parseColor("#33FFFFFF"));
        ball.setBackground(bg);
        ball.setElevation(dp(6));

        int x = QuickStore.ballX(this);
        if (x < 0) x = screenW - ballSize - dp(6);
        x = clamp(x, 0, screenW - ballSize);
        int y = clamp(QuickStore.ballY(this), dp(40), screenH - ballSize - dp(80));

        ballParams = new WindowManager.LayoutParams(
                ballSize, ballSize,
                Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        ballParams.gravity = Gravity.TOP | Gravity.START;
        ballParams.x = x;
        ballParams.y = y;

        ball.setOnTouchListener(new View.OnTouchListener() {
            @Override
            public boolean onTouch(View v, MotionEvent event) {
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        dragging = false;
                        downRawX = event.getRawX();
                        downRawY = event.getRawY();
                        startX = ballParams.x;
                        startY = ballParams.y;
                        return true;
                    case MotionEvent.ACTION_MOVE: {
                        float dx = event.getRawX() - downRawX;
                        float dy = event.getRawY() - downRawY;
                        if (!dragging && Math.abs(dx) + Math.abs(dy) > dp(6)) {
                            dragging = true;
                            if (panelOpen) hidePanel();
                        }
                        if (dragging) {
                            ballParams.x = clamp((int) (startX + dx), 0, screenW - ballSize);
                            ballParams.y = clamp((int) (startY + dy), dp(24), screenH - ballSize - dp(48));
                            updateBall();
                        }
                        return true;
                    }
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        if (dragging) snapToEdge();
                        else togglePanel();
                        return true;
                }
                return false;
            }
        });

        try {
            wm.addView(ball, ballParams);
        } catch (Throwable ignored) { }
    }

    private void updateBall() {
        try { wm.updateViewLayout(ball, ballParams); } catch (Throwable ignored) { }
    }

    /** 松手吸附：小球停在离哪边近就贴哪边，并记住位置。 */
    private void snapToEdge() {
        final int target = (ballParams.x + ballSize / 2) < screenW / 2 ? dp(2) : screenW - ballSize - dp(2);
        final int from = ballParams.x;
        ValueAnimator anim = ValueAnimator.ofInt(from, target);
        anim.setDuration(180);
        anim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override public void onAnimationUpdate(ValueAnimator a) {
                ballParams.x = (Integer) a.getAnimatedValue();
                updateBall();
            }
        });
        anim.start();
        QuickStore.saveBallPosition(this, target, ballParams.y);
        if (panelOpen) positionPanel();
    }

    private void togglePanel() {
        if (panelOpen) hidePanel();
        else showPanel();
    }

    // ---------------- 记账卡片 ----------------

    private void showPanel() {
        if (panel == null) panel = buildPanel();
        if (panel.getParent() != null) {
            positionPanel();
            panelOpen = true;
            return;
        }
        panelParams = new WindowManager.LayoutParams(
                panelW, ViewGroup.LayoutParams.WRAP_CONTENT,
                Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                        : WindowManager.LayoutParams.TYPE_PHONE,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        panelParams.gravity = Gravity.TOP | Gravity.START;
        positionPanel();
        try {
            wm.addView(panel, panelParams);
            panelOpen = true;
            panel.post(new Runnable() {
                @Override public void run() { positionPanel(); }
            });
        } catch (Throwable e) {
            panel = null;
        }
    }

    private void hidePanel() {
        panelOpen = false;
        if (panel != null && panel.getParent() != null) {
            try { wm.removeView(panel); } catch (Throwable ignored) { }
        }
    }

    /** 卡片贴着小球所在的一侧显示，避免挡住屏幕中间。 */
    private void positionPanel() {
        if (panel == null || panelParams == null) return;
        int h = panel.getHeight();
        if (h <= 0) h = dp(360);
        boolean onLeft = (ballParams.x + ballSize / 2) < screenW / 2;
        panelParams.x = onLeft ? dp(6) : screenW - panelW - dp(6);
        int half = ballSize / 2;
        int y = ballParams.y + half - h / 2;
        panelParams.y = clamp(y, dp(28), Math.max(dp(28), screenH - h - dp(28)));
        try { wm.updateViewLayout(panel, panelParams); } catch (Throwable ignored) { }
    }

    private LinearLayout buildPanel() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(14));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(18));
        bg.setColor(Color.parseColor("#FFFFFF"));
        bg.setStroke(dp(1), Color.parseColor("#E3EBE5"));
        card.setBackground(bg);
        card.setElevation(dp(8));

        LinearLayout head = new LinearLayout(this);
        head.setOrientation(LinearLayout.HORIZONTAL);
        head.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this);
        title.setText("记一笔");
        title.setTextSize(16);
        title.setTextColor(Color.parseColor("#22302A"));
        title.setTypeface(null, android.graphics.Typeface.BOLD);
        head.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView collapse = new TextView(this);
        collapse.setText("收起");
        collapse.setTextSize(12);
        collapse.setTextColor(Color.parseColor("#6B7A70"));
        collapse.setPadding(dp(10), dp(6), dp(4), dp(6));
        collapse.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { hidePanel(); }
        });
        head.addView(collapse);
        card.addView(head);

        catHint = new TextView(this);
        catHint.setTextSize(11);
        catHint.setTextColor(Color.parseColor("#8A958E"));
        catHint.setPadding(0, dp(2), 0, dp(8));
        card.addView(catHint);

        // 分类（横向滚动，12 个胶囊）
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        chips.clear();
        for (int i = 0; i < CATS.length; i++) {
            final String id = CATS[i][0];
            TextView chip = new TextView(this);
            chip.setText(CATS[i][1]);
            chip.setTextSize(12);
            chip.setGravity(Gravity.CENTER);
            chip.setPadding(dp(12), dp(6), dp(12), dp(6));
            chip.setOnClickListener(new View.OnClickListener() {
                @Override public void onClick(View v) {
                    category = id;
                    renderChips();
                }
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.rightMargin = dp(6);
            row.addView(chip, lp);
            chips.add(chip);
        }
        scroll.addView(row);
        card.addView(scroll);

        amountView = new TextView(this);
        amountView.setTextSize(30);
        amountView.setTextColor(Color.parseColor("#2F6B45"));
        amountView.setGravity(Gravity.END);
        amountView.setPadding(0, dp(10), dp(4), dp(6));
        amountView.setText("¥0");
        card.addView(amountView);

        // 数字键盘：3 列
        String[][] keys = {
                {"1", "2", "3"}, {"4", "5", "6"}, {"7", "8", "9"}, {".", "0", "⌫"}
        };
        for (int r = 0; r < keys.length; r++) {
            LinearLayout line = new LinearLayout(this);
            line.setOrientation(LinearLayout.HORIZONTAL);
            for (int c = 0; c < 3; c++) {
                final String key = keys[r][c];
                TextView btn = new TextView(this);
                btn.setText(key);
                btn.setTextSize(19);
                btn.setTextColor(Color.parseColor("#22302A"));
                btn.setGravity(Gravity.CENTER);
                btn.setPadding(0, dp(9), 0, dp(9));
                GradientDrawable kbg = new GradientDrawable();
                kbg.setCornerRadius(dp(10));
                kbg.setColor(Color.parseColor("#F2F6F3"));
                btn.setBackground(kbg);
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                        0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
                lp.setMargins(dp(3), dp(3), dp(3), dp(3));
                line.addView(btn, lp);
                btn.setOnClickListener(new View.OnClickListener() {
                    @Override public void onClick(View v) { pressKey(key); }
                });
            }
            card.addView(line);
        }

        TextView save = new TextView(this);
        save.setText("保存");
        save.setTextSize(15);
        save.setTextColor(Color.WHITE);
        save.setGravity(Gravity.CENTER);
        save.setPadding(0, dp(11), 0, dp(11));
        GradientDrawable sbg = new GradientDrawable();
        sbg.setCornerRadius(dp(12));
        sbg.setColor(Color.parseColor("#4F9D69"));
        save.setBackground(sbg);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        slp.topMargin = dp(8);
        save.setLayoutParams(slp);
        save.setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { saveEntry(); }
        });
        card.addView(save);

        TextView tip = new TextView(this);
        tip.setText("保存后回到 App 自动入账 · 可长按小球拖动");
        tip.setTextSize(10);
        tip.setTextColor(Color.parseColor("#8A958E"));
        tip.setPadding(0, dp(8), 0, 0);
        card.addView(tip);

        renderChips();
        return card;
    }

    private void renderChips() {
        for (int i = 0; i < chips.size(); i++) {
            String id = CATS[i][0];
            TextView chip = chips.get(i);
            boolean on = id.equals(category);
            GradientDrawable bg = new GradientDrawable();
            bg.setCornerRadius(dp(14));
            bg.setColor(Color.parseColor(on ? "#4F9D69" : "#F2F6F3"));
            bg.setStroke(dp(1), Color.parseColor(on ? "#4F9D69" : "#E3EBE5"));
            chip.setBackground(bg);
            chip.setTextColor(Color.parseColor(on ? "#FFFFFF" : "#4A5A52"));
        }
        if (catHint != null) {
            catHint.setText("当前分类：" + labelOf(category) + (isIncome(category) ? "（收入）" : ""));
        }
    }

    private void pressKey(String key) {
        if ("⌫".equals(key)) {
            if (amountText.length() > 0) amountText = amountText.substring(0, amountText.length() - 1);
        } else if (".".equals(key)) {
            if (amountText.indexOf('.') < 0) amountText = amountText.isEmpty() ? "0." : amountText + ".";
        } else {
            if (amountText.indexOf('.') >= 0 && amountText.length() - amountText.indexOf('.') > 2) return;
            if (amountText.replace(".", "").length() >= 7) return;
            amountText = amountText + key;
        }
        if (amountView != null) amountView.setText("¥" + (amountText.isEmpty() ? "0" : amountText));
    }

    private void saveEntry() {
        double value;
        try {
            value = Double.parseDouble(amountText);
        } catch (Throwable e) {
            value = 0d;
        }
        if (value <= 0d) {
            Toast.makeText(this, "请输入金额", Toast.LENGTH_SHORT).show();
            return;
        }
        QuickStore.enqueue(this, category, value, "", "ball");
        QuickStore.setLastCategory(this, category);
        String msg = "已记 " + money(value) + " " + labelOf(category);
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
        QuickNotification.updateIfShown(this, msg);
        MainActivity.pushQuickToApp();
        amountText = "";
        if (amountView != null) amountView.setText("¥0");
        hidePanel();
    }

    // ---------------- 工具 ----------------

    public static String money(double v) {
        return "¥" + String.format(Locale.CHINA, "%.2f", v);
    }

    public static String labelOf(String category) {
        for (int i = 0; i < CATS.length; i++) {
            if (CATS[i][0].equals(category)) return CATS[i][1];
        }
        return "其他";
    }

    private static boolean isIncome(String category) {
        return "income".equals(category);
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private static int clamp(int v, int min, int max) {
        return Math.max(min, Math.min(max, v));
    }
}