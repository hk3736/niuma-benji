package com.everylog.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.Scanner;

/**
 * 整点位置采集：9 / 12 / 15 / 18 点由 AlarmManager 唤醒，
 * 取一次最近定位 → 逆地理成中文地名 → 追加写入私有文件 slot-locations.json。
 * App 打开扫描当天时，把这些点位并入当天的「各时间点位置」。
 *
 * 说明：
 *  - 用 getLastKnownLocation，瞬时返回，不做等待式定位（省电、不卡广播窗口）
 *  - 逆地理在广播里起线程做（goAsync 给 10s 窗口），失败只记坐标
 *  - 广播里重新调度下一天，重启后由 BootReceiver 再调度
 */
public class SlotLocationReceiver extends BroadcastReceiver {

    public static final int[] SLOTS = {9, 12, 15, 18};
    public static final String STORE_FILE = "slot-locations.json";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        final PendingResult result = goAsync();
        final int hour = intent.getIntExtra("hour", -1);
        new Thread(() -> {
            try {
                capture(ctx, hour);
            } catch (Throwable t) {
                // 采集失败静默，不影响系统
            } finally {
                scheduleNext(ctx);
                result.finish();
            }
        }).start();
    }

    private void capture(Context ctx, int hour) {
        double[] ll = lastKnown(ctx);
        if (ll == null) return;

        JSONObject entry = new JSONObject();
        try {
            entry.put("day", new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date()));
            entry.put("hour", hour);
            entry.put("ts", System.currentTimeMillis());
            entry.put("latitude", ll[0]);
            entry.put("longitude", ll[1]);
            String place = reverseGeocode(ll[0], ll[1]);
            if (place != null && place.length() > 0) entry.put("place", place);
        } catch (Throwable t) {
            return;
        }
        append(ctx, entry);
    }

    private double[] lastKnown(Context ctx) {
        try {
            LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return null;
            Location best = null;
            for (String p : new String[]{"gps", "network", "passive"}) {
                try {
                    Location l = lm.getLastKnownLocation(p);
                    if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
                } catch (SecurityException ignored) {
                }
            }
            if (best == null) return null;
            return new double[]{best.getLatitude(), best.getLongitude()};
        } catch (Throwable t) {
            return null;
        }
    }

    /** Nominatim 中文逆地理（限速宽松、免 key），失败返回空串。坐标直接用 WGS84。 */
    private String reverseGeocode(double lat, double lng) {
        HttpURLConnection conn = null;
        try {
            URL u = new URL("https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=" + lat
                    + "&lon=" + lng + "&accept-language=zh-CN,zh&zoom=18&addressdetails=1");
            conn = (HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(6000);
            conn.setRequestProperty("User-Agent", "NiuMaRiJi/2.0 (local diary app)");
            Scanner sc = new Scanner(conn.getInputStream(), "UTF-8").useDelimiter("\\A");
            String body = sc.hasNext() ? sc.next() : "";
            JSONObject d = new JSONObject(body);
            JSONObject a = d.optJSONObject("address");
            String name = d.optString("name", "");
            if (name.length() == 0 && a != null) {
                name = firstOf(a, "tourism", "attraction", "shop", "amenity", "building", "leisure", "road", "suburb", "neighbourhood", "city_district", "town", "city");
            }
            String city = a != null ? a.optString("city", a.optString("town", "")) : "";
            if (name.length() > 0) {
                return city.length() > 0 && !city.equals(name) ? name + " · " + city : name;
            }
            if (city.length() > 0) return city;
            return "";
        } catch (Throwable t) {
            return "";
        } finally {
            if (conn != null) try { conn.disconnect(); } catch (Throwable ignored) {}
        }
    }

    private static String firstOf(JSONObject a, String... keys) {
        for (String k : keys) {
            String v = a.optString(k, "");
            if (v.length() > 0) return v;
        }
        return "";
    }

    /* ---------------- 存储 ---------------- */

    private static File store(Context ctx) {
        return new File(ctx.getFilesDir(), STORE_FILE);
    }

    private static synchronized void append(Context ctx, JSONObject entry) {
        try {
            JSONArray arr = readAll(ctx);
            arr.put(entry);
            // 只保留最近 8 天
            JSONArray keep = new JSONArray();
            long cutoff = System.currentTimeMillis() - 8L * 24 * 3600 * 1000;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o != null && o.optLong("ts") > cutoff) keep.put(o);
            }
            OutputStream os = new FileOutputStream(store(ctx));
            os.write(keep.toString().getBytes("UTF-8"));
            os.close();
        } catch (Throwable ignored) {
        }
    }

    /** 读取全部采集点（给 JS 用）。 */
    public static synchronized JSONArray readAll(Context ctx) {
        try {
            File f = store(ctx);
            if (!f.exists()) return new JSONArray();
            Scanner sc = new Scanner(new FileInputStream(f), "UTF-8").useDelimiter("\\A");
            String body = sc.hasNext() ? sc.next() : "[]";
            return new JSONArray(body);
        } catch (Throwable t) {
            return new JSONArray();
        }
    }

    /* ---------------- 调度 ---------------- */

    /** 注册未来 24 小时内还没过的整点（含明天的 9 点），已注册的会被相同 requestCode 覆盖。 */
    public static void scheduleAll(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Calendar now = Calendar.getInstance();
        for (int dayOffset = 0; dayOffset <= 1; dayOffset++) {
            for (int hour : SLOTS) {
                Calendar c = Calendar.getInstance();
                c.set(Calendar.HOUR_OF_DAY, hour);
                c.set(Calendar.MINUTE, 0);
                c.set(Calendar.SECOND, 0);
                c.add(Calendar.DAY_OF_YEAR, dayOffset);
                if (c.getTimeInMillis() <= now.getTimeInMillis() + 60_000) continue;
                scheduleOne(ctx, am, c, hour, dayOffset);
            }
        }
    }

    private static void scheduleOne(Context ctx, AlarmManager am, Calendar c, int hour, int dayOffset) {
        int reqCode = 1000 + dayOffset * 100 + hour;
        Intent it = new Intent(ctx, SlotLocationReceiver.class);
        it.putExtra("hour", hour);
        PendingIntent pi = PendingIntent.getBroadcast(ctx, reqCode, it,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        long at = c.getTimeInMillis();
        try {
            if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (Throwable t) {
            try {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } catch (Throwable ignored) {
            }
        }
    }

    /** 广播尾部滚动调度：保证「明天 9 点」始终有闹钟。 */
    private void scheduleNext(Context ctx) {
        scheduleAll(ctx);
    }
}
