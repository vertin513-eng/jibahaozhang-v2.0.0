package com.qinghe.ledger;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * 状态栏快捷磁贴「记一笔」。
 *
 * 只做入口：点击后打开 App 的记账面板（分类选择 → 金额），
 * 不监听通知、不截图、不做任何自动识别。
 */
public class QuickTileService extends TileService {

    private static final int REQ_OPEN = 9401;

    @Override
    public void onStartListening() {
        super.onStartListening();
        updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            intent.putExtra("quick_add", true);
            if (Build.VERSION.SDK_INT >= 34) {
                PendingIntent pi = PendingIntent.getActivity(this, REQ_OPEN, intent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                startActivityAndCollapse(pi);
            } else {
                startActivityAndCollapse(intent);
            }
        } catch (Throwable ignored) {
            // 磁贴被系统限制时静默失败，用户仍可从桌面图标进入
        }
    }

    private void updateTile() {
        try {
            Tile tile = getQsTile();
            if (tile == null) return;
            tile.setLabel(getString(R.string.tile_label));
            tile.setState(Tile.STATE_INACTIVE);
            tile.updateTile();
        } catch (Throwable ignored) { }
    }
}