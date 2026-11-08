package com.qinghe.ledger;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

/**
 * 快速记账广播：通知栏快捷按钮、桌面小组件按钮都往这里送。
 * 收到后只做一件事——把账单写进本地队列，App 打开时自动入账。
 */
public class QuickAddReceiver extends BroadcastReceiver {

    public static final String ACTION_QUICK = "com.qinghe.ledger.action.QUICK";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_QUICK.equals(intent.getAction())) return;
        String category = intent.getStringExtra("category");
        double amount = intent.getDoubleExtra("amount", 0d);
        String note = intent.getStringExtra("note");
        if (category == null || category.isEmpty() || amount <= 0d) return;
        QuickStore.enqueue(context, category, amount, note == null ? "" : note, "quick_entry");
        String msg = "已记 " + FloatingBallService.money(amount) + " " + FloatingBallService.labelOf(category);
        Toast.makeText(context, msg, Toast.LENGTH_SHORT).show();
        QuickNotification.updateIfShown(context, msg);
        MainActivity.pushQuickToApp();
    }
}