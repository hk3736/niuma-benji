package com.everylog.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 开机后恢复整点定位采集的闹钟。 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        if (action == null) return;
        if (action.equals(Intent.ACTION_BOOT_COMPLETED)
                || action.equals(Intent.ACTION_TIME_CHANGED)
                || action.equals("android.intent.action.QUICKBOOT_POWERON")) {
            SlotLocationReceiver.scheduleAll(ctx);
        }
    }
}
