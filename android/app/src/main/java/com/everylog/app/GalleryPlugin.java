package com.everylog.app;

import android.Manifest;
import android.content.ContentUris;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 相册扫描插件（本项目自带，只做一件事：按时间窗枚举本机照片与截图）。
 *
 * 为什么不用现成的：Capacitor 官方 Camera 插件只能让用户手选照片，
 * @capacitor-community/media 的 getMedias 在 Android 端是 unimplemented，
 * 所以这里直接走 MediaStore 查询。
 *
 * 权限说明：
 *  - Android 13+（API 33）：READ_MEDIA_IMAGES
 *  - Android 12 及以下：READ_EXTERNAL_STORAGE
 * 只读取媒体索引，不复制、不上传；返回的是 file:// 路径与元数据。
 */
@CapacitorPlugin(
        name = "GalleryScan",
        permissions = {
                // v2.13：ACCESS_MEDIA_LOCATION 必需——Android 10+ 无此权限时系统读图会自动
                // 抹掉照片 GPS（澎湃OS 同样），EXIF 里明明有坐标也读成 (0,0)
                @Permission(alias = "images", strings = { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.ACCESS_MEDIA_LOCATION }),
                @Permission(alias = "storage29", strings = { Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.ACCESS_MEDIA_LOCATION }),
                @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
        }
)
public class GalleryPlugin extends Plugin {

    private static final String[] PROJECTION = new String[] {
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DATA,
            MediaStore.Images.Media.DATE_TAKEN,
            MediaStore.Images.Media.DATE_ADDED,
            MediaStore.Images.Media.DATE_MODIFIED,
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.WIDTH,
            MediaStore.Images.Media.HEIGHT
    };

    private String aliasForPermission() {
        if (Build.VERSION.SDK_INT >= 33) return "images";
        if (Build.VERSION.SDK_INT >= 29) return "storage29";
        return "storage";
    }

    @PluginMethod
    public void checkAccess(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState(aliasForPermission()) == PermissionState.GRANTED);
        ret.put("sdk", Build.VERSION.SDK_INT);
        // v2.13 诊断：照片位置权限是否已授予（缺失时系统读图会抹掉 GPS）
        if (Build.VERSION.SDK_INT >= 29) {
            ret.put("mediaLocation", getPermissionState("images") == PermissionState.GRANTED
                    || getPermissionState("storage29") == PermissionState.GRANTED);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        String alias = aliasForPermission();
        if (getPermissionState(alias) == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias(alias, call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState(aliasForPermission()) == PermissionState.GRANTED);
        call.resolve(ret);
    }

    /**
     * 枚举 [from, to) 时间窗内的图片。
     * JS 侧参数：from(ms) / to(ms) / limit(默认 300，取每个时段最近的一批)
     */
    /** 图像读取权限（不含位置）：扫描只依赖它，位置权限缺失时仅读不到 GPS */
    private PermissionState imagePermState() {
        return Build.VERSION.SDK_INT >= 33
                ? getPermissionState("images")
                : getPermissionState("storage");
    }

    @PluginMethod
    public void queryImages(PluginCall call) {
        if (imagePermState() != PermissionState.GRANTED) {
            call.reject("没有相册读取权限，请在系统设置里允许 EveryLog 访问照片");
            return;
        }

        long from = call.getLong("from", 0L);
        long to = call.getLong("to", System.currentTimeMillis());
        int limit = call.getInt("limit", 300);

        // 统一成毫秒：DATE_TAKEN 是拍摄时刻（可能为空），DATE_ADDED / DATE_MODIFIED 是秒
        // Android 10+ 的排序表达式也按秒过滤，这里秒级窗口放宽 1 天，精确裁剪留给 JS
        long fromSec = from / 1000L - 86400L;
        long toSec = to / 1000L + 86400L;

        String sort = MediaStore.Images.Media.DATE_ADDED + " DESC";
        String selection = null;
        List<String> args = new ArrayList<>();

        if (Build.VERSION.SDK_INT >= 30) {
            selection = "(" + MediaStore.Images.Media.DATE_TAKEN + " IS NULL OR "
                    + MediaStore.Images.Media.DATE_TAKEN + " >= ?) AND "
                    + MediaStore.Images.Media.DATE_ADDED + " >= ? AND "
                    + MediaStore.Images.Media.DATE_ADDED + " < ?";
            args.add(String.valueOf(from));
            args.add(String.valueOf(fromSec));
            args.add(String.valueOf(toSec));
        } else {
            selection = MediaStore.Images.Media.DATE_ADDED + " >= ? AND "
                    + MediaStore.Images.Media.DATE_ADDED + " < ?";
            args.add(String.valueOf(fromSec));
            args.add(String.valueOf(toSec));
        }

        List<Entry> items = new ArrayList<>();
        Cursor cursor = null;
        try {
            Uri base = Build.VERSION.SDK_INT >= 29
                    ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
                    : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
            cursor = getContext()
                    .getContentResolver()
                    .query(base, PROJECTION, selection, args.toArray(new String[0]), sort);

            if (cursor != null) {
                int iId = cursor.getColumnIndexOrThrow(MediaStore.Images.Media._ID);
                int iData = cursor.getColumnIndex(MediaStore.Images.Media.DATA);
                int iTaken = cursor.getColumnIndex(MediaStore.Images.Media.DATE_TAKEN);
                int iAdded = cursor.getColumnIndex(MediaStore.Images.Media.DATE_ADDED);
                int iMod = cursor.getColumnIndex(MediaStore.Images.Media.DATE_MODIFIED);
                int iName = cursor.getColumnIndex(MediaStore.Images.Media.DISPLAY_NAME);
                int iW = cursor.getColumnIndex(MediaStore.Images.Media.WIDTH);
                int iH = cursor.getColumnIndex(MediaStore.Images.Media.HEIGHT);

                while (cursor.moveToNext() && items.size() < limit) {
                    long id = cursor.getLong(iId);
                    String path = cursor.isNull(iData) ? null : cursor.getString(iData);
                    Uri contentUri = ContentUris.withAppendedId(base, id);

                    long taken = cursor.isNull(iTaken) ? 0L : cursor.getLong(iTaken);
                    long added = cursor.isNull(iAdded) ? 0L : cursor.getLong(iAdded) * 1000L;
                    long modified = cursor.isNull(iMod) ? 0L : cursor.getLong(iMod) * 1000L;

                    if (taken <= 0) taken = added > 0 ? added : modified;
                    if (taken < from || taken >= to) continue;

                    String name = cursor.isNull(iName) ? "" : cursor.getString(iName);
                    int w = cursor.isNull(iW) ? 0 : cursor.getInt(iW);
                    int h = cursor.isNull(iH) ? 0 : cursor.getInt(iH);

                    Entry entry = new Entry();
                    entry.id = id;
                    entry.path = path;
                    entry.uri = contentUri.toString();
                    entry.takenAt = taken;
                    entry.name = name;
                    entry.width = w;
                    entry.height = h;
                    items.add(entry);
                }
            }
        } catch (Exception e) {
            call.reject("读取相册失败：" + e.getMessage());
            return;
        } finally {
            if (cursor != null) cursor.close();
        }

        // 以拍摄时间升序返回（最近的排在后面，方便 JS 端就近取）
        Collections.sort(items, new Comparator<Entry>() {
            @Override
            public int compare(Entry a, Entry b) {
                return Long.compare(a.takenAt, b.takenAt);
            }
        });

        org.json.JSONArray arr = new org.json.JSONArray();
        for (Entry e : items) {
            JSObject o = new JSObject();
            o.put("id", e.id);
            o.put("path", e.path == null ? e.uri : e.path);
            o.put("uri", e.uri);
            o.put("takenAt", e.takenAt);
            o.put("name", e.name == null ? "" : e.name);
            o.put("width", e.width);
            o.put("height", e.height);
            arr.put(o);
        }

        JSObject ret = new JSObject();
        ret.put("images", arr);
        call.resolve(ret);
    }

    /** 中间结构：避免依赖 JSObject 的 optLong(跨版本签名差异) */
    private static class Entry {
        long id;
        String path;
        String uri;
        long takenAt;
        String name;
        int width;
        int height;
    }

    /** 读取图片文件里的 EXIF（只用于小文件，JS 侧只在需要时调用） */
    @PluginMethod
    public void readExif(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("path 不能为空");
            return;
        }
        try {
            android.media.ExifInterface exif = openExif(path);
            if (exif == null) {
                call.reject("无法打开图片");
                return;
            }
            float[] latlng = new float[2];
            JSObject ret = new JSObject();
            if (exif.getLatLong(latlng)) {
                ret.put("latitude", (double) latlng[0]);
                ret.put("longitude", (double) latlng[1]);
            }
            String dt = exif.getAttribute(android.media.ExifInterface.TAG_DATETIME_ORIGINAL);
            if (dt == null) dt = exif.getAttribute(android.media.ExifInterface.TAG_DATETIME);
            ret.put("dateTime", dt);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读取 EXIF 失败：" + e.getMessage());
        }
    }

    /**
     * 读原图头部的原始字节（base64），给 JS 端 parseExif 做兜底解析用。
     * EXIF 全部位于 JPEG 头部（APP1 段，一般 < 64KB），取前 256KB 绰绰有余。
     * v2.6 新增：部分机型上 ExifInterface.getLatLong 静默失败，JS 端解析器实测可靠。
     */
    @PluginMethod
    public void readExifHead(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("path 不能为空");
            return;
        }
        java.io.InputStream in = null;
        try {
            if (path.startsWith("content://")) {
                in = getContext().getContentResolver().openInputStream(Uri.parse(path));
            } else if (path.startsWith("file://")) {
                in = new java.io.FileInputStream(Uri.parse(path).getPath());
            } else {
                in = new java.io.FileInputStream(path);
            }
            if (in == null) {
                call.reject("无法打开图片");
                return;
            }
            byte[] head = new byte[262144];
            int total = 0, n;
            while (total < head.length && (n = in.read(head, total, head.length - total)) > 0) total += n;
            JSObject ret = new JSObject();
            ret.put("base64", android.util.Base64.encodeToString(head, 0, total, android.util.Base64.NO_WRAP));
            ret.put("length", total);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读取图片头部失败：" + e.getMessage());
        } finally {
            try { if (in != null) in.close(); } catch (Exception ignore) {}
        }
    }

    /**
     * 直接按 Uri 打开 ExifInterface。
     * 关键：WebView 里 content:// 根本渲染不了，而 Android 10+ 分区存储下
     * 用 new ExifInterface("/storage/...jpg") 也可能读不到，必须走文件描述符。
     */
    private android.media.ExifInterface openExif(String path) throws Exception {
        try {
            return new android.media.ExifInterface(path);
        } catch (Exception ignore) {
            // 落到 Uri 分支
        }
        if (path.startsWith("content://")) {
            android.content.ContentResolver cr = getContext().getContentResolver();
            return new android.media.ExifInterface(cr.openFileDescriptor(Uri.parse(path), "r").getFileDescriptor());
        }
        return null;
    }

    /**
     * 把相册里的一张图「重编码」写入 App 私有目录，返回可用 file:// 地址。
     * 为什么要重编码而不是 copy：
     *   1. 顺带把 4000x3000 的原图缩到 1600，省空间也省后续读图带宽
     *   2. 重编码后的 jpg 没有旋转信息，统一按 EXIF 方向摆正，界面不会歪
     *   3. 私有目录里的 file:// 是 WebView 能直接渲染的，不依赖 content:// 支持
     * JS 再用 Capacitor.convertFileSrc() 换成 https://localhost/_capacitor_file_/…
     */
    @PluginMethod
    public void importImage(PluginCall call) {
        String uri = call.getString("uri");
        String path = call.getString("path");
        int maxEdge = call.getInt("maxEdge", 1600);
        int quality = call.getInt("quality", 85);
        if (quality < 30) quality = 30;
        if (quality > 100) quality = 100;

        android.graphics.Bitmap bitmap = null;
        android.graphics.Bitmap scaled = null;
        try {
            android.content.ContentResolver cr = getContext().getContentResolver();

            // 1) 解码边界，按 maxEdge 做 inSampleSize 粗缩放（避免 OOM）
            android.graphics.BitmapFactory.Options opts = new android.graphics.BitmapFactory.Options();
            opts.inJustDecodeBounds = true;
            android.os.ParcelFileDescriptor pfd = null;
            java.io.FileInputStream fis = null;
            try {
                if (uri != null && uri.startsWith("content://")) {
                    pfd = cr.openFileDescriptor(Uri.parse(uri), "r");
                    android.graphics.BitmapFactory.decodeFileDescriptor(pfd.getFileDescriptor(), null, opts);
                } else {
                    fis = new java.io.FileInputStream(stripScheme(path != null ? path : uri));
                    android.graphics.BitmapFactory.decodeStream(fis, null, opts);
                }
            } finally {
                if (fis != null) try { fis.close(); } catch (Exception ignore) {}
                if (pfd != null) try { pfd.close(); } catch (Exception ignore) {}
            }

            if (opts.outWidth <= 0 || opts.outHeight <= 0) {
                call.reject("图片无法解码");
                return;
            }

            int sample = 1;
            int longEdge = Math.max(opts.outWidth, opts.outHeight);
            while (longEdge / sample > maxEdge * 2) sample *= 2;

            android.graphics.BitmapFactory.Options dec = new android.graphics.BitmapFactory.Options();
            dec.inSampleSize = sample;
            dec.inPreferredConfig = android.graphics.Bitmap.Config.ARGB_8888;

            int orientation = android.media.ExifInterface.ORIENTATION_NORMAL;
            try {
                android.media.ExifInterface exif = openExif(uri != null ? uri : path);
                if (exif != null) {
                    orientation = exif.getAttributeInt(
                            android.media.ExifInterface.TAG_ORIENTATION,
                            android.media.ExifInterface.ORIENTATION_NORMAL);
                }
            } catch (Exception ignore) {}

            if (uri != null && uri.startsWith("content://")) {
                pfd = cr.openFileDescriptor(Uri.parse(uri), "r");
                try {
                    bitmap = android.graphics.BitmapFactory.decodeFileDescriptor(pfd.getFileDescriptor(), null, dec);
                } finally {
                    if (pfd != null) try { pfd.close(); } catch (Exception ignore) {}
                }
            } else {
                fis = new java.io.FileInputStream(stripScheme(path != null ? path : uri));
                try {
                    bitmap = android.graphics.BitmapFactory.decodeStream(fis, null, dec);
                } finally {
                    if (fis != null) try { fis.close(); } catch (Exception ignore) {}
                }
            }

            if (bitmap == null) {
                call.reject("图片解码失败");
                return;
            }

            // 2) 精确缩放到 maxEdge
            int w = bitmap.getWidth();
            int h = bitmap.getHeight();
            int le = Math.max(w, h);
            if (le > maxEdge) {
                float k = (float) maxEdge / (float) le;
                scaled = android.graphics.Bitmap.createScaledBitmap(
                        bitmap, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)), true);
                bitmap.recycle();
                bitmap = scaled;
                scaled = null;
            }

            // 3) 按 EXIF 方向摆正
            android.graphics.Matrix m = new android.graphics.Matrix();
            switch (orientation) {
                case android.media.ExifInterface.ORIENTATION_ROTATE_90:  m.postRotate(90); break;
                case android.media.ExifInterface.ORIENTATION_ROTATE_180: m.postRotate(180); break;
                case android.media.ExifInterface.ORIENTATION_ROTATE_270: m.postRotate(270); break;
                case android.media.ExifInterface.ORIENTATION_FLIP_HORIZONTAL: m.postScale(-1, 1); break;
                case android.media.ExifInterface.ORIENTATION_FLIP_VERTICAL:   m.postScale(1, -1); break;
                case android.media.ExifInterface.ORIENTATION_TRANSPOSE:      m.postRotate(90); m.postScale(-1, 1); break;
                case android.media.ExifInterface.ORIENTATION_TRANSVERSE:     m.postRotate(270); m.postScale(-1, 1); break;
                default: break;
            }
            if (!m.isIdentity()) {
                android.graphics.Bitmap rotated = android.graphics.Bitmap.createBitmap(
                        bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), m, true);
                if (rotated != bitmap) {
                    bitmap.recycle();
                    bitmap = rotated;
                }
            }

            // 4) 写进 files/photos/
            java.io.File dir = new java.io.File(getContext().getFilesDir(), "photos");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("无法创建图片目录");
                return;
            }
            String name = (call.getString("name") != null ? "src-" : "src-")
                    + System.currentTimeMillis() + "-" + (int) (Math.random() * 100000) + ".jpg";
            java.io.File out = new java.io.File(dir, name);
            java.io.FileOutputStream fos = new java.io.FileOutputStream(out);
            boolean ok;
            try {
                ok = bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, quality, fos);
                fos.flush();
            } finally {
                try { fos.close(); } catch (Exception ignore) {}
            }

            if (!ok) {
                call.reject("图片写入失败");
                return;
            }

            JSObject ret = new JSObject();
            ret.put("fileUri", "file://" + out.getAbsolutePath());
            ret.put("absolutePath", out.getAbsolutePath());
            ret.put("width", bitmap.getWidth());
            ret.put("height", bitmap.getHeight());
            ret.put("bytes", out.length());
            ret.put("orientation", orientation);
            call.resolve(ret);
        } catch (OutOfMemoryError oom) {
            call.reject("图片太大，内存不足");
        } catch (Exception e) {
            call.reject("导入图片失败：" + e.getMessage());
        } finally {
            if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
            if (scaled != null && !scaled.isRecycled()) scaled.recycle();
        }
    }

    private static String stripScheme(String p) {
        if (p == null) return null;
        if (p.startsWith("file://")) return Uri.parse(p).getPath();
        return p;
    }

    /* ---------------- 手动添加：系统相册选择器 ---------------- */

    private static final int REQ_PICK_IMAGES = 0x5E01;
    private PluginCall pendingPick;
    private int pendingLimit = 20;
    // v2.12：小米 HyperOS 的相册选择器（com.android.photopicker.hyper.PickerFileProvider）
    // 通过 ACTION_PICK_IMAGES 返回的 content:// 不附带读授权，openFileDescriptor 直接
    // 抛 "Permission Denial ... not exported"。对策：先验证每个 Uri 可读，
    // 不可读就整体降级到 ACTION_OPEN_DOCUMENT（DocumentsUI，授权可靠）再选一次。
    private boolean pendingUseOpenDoc = false;

    /**
     * 打开系统图片选择器（Android 13+ 走 Photo Picker，更低版本走 ACTION_OPEN_DOCUMENT），
     * 让用户手选若干张，返回各自的 Uri + 从 EXIF 读到的拍摄时间与尺寸。
     * 不申请存储权限：选择器给的是临时授权的 content:// ，本轮会话内可读。
     */
    @PluginMethod
    public void pickImages(PluginCall call) {
        if (pendingPick != null) {
            call.reject("已经有一个选择器打开了");
            return;
        }
        int limit = call.getInt("limit", 20);
        if (limit <= 0) limit = 20;
        pendingLimit = limit;
        pendingPick = call;
        pendingUseOpenDoc = false;

        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= 33 && !pendingUseOpenDoc) {
                // Photo Picker：无需任何存储权限（小米 HyperOS 可能不给授权，回调里降级）
                intent = new Intent(android.provider.MediaStore.ACTION_PICK_IMAGES);
                intent.putExtra(android.provider.MediaStore.EXTRA_PICK_IMAGES_MAX, limit);
                intent.setType("image/*");
            } else {
                intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            startActivityForResult(call, intent, "pickImagesResult");
        } catch (Exception e) {
            pendingPick = null;
            call.reject("无法打开相册选择器：" + e.getMessage());
        }
    }

    @com.getcapacitor.annotation.ActivityCallback
    private void pickImagesResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        PluginCall pc = call != null ? call : pendingPick;
        pendingPick = null;
        if (pc == null) return;

        org.json.JSONArray arr = new org.json.JSONArray();
        try {
            if (result == null || result.getResultCode() != android.app.Activity.RESULT_OK) {
                JSObject ret = new JSObject();
                ret.put("images", arr);
                pc.resolve(ret);
                return;
            }
            Intent data = result.getData();
            java.util.List<Uri> uris = new ArrayList<>();
            if (data != null) {
                android.content.ClipData clip = data.getClipData();
                if (clip != null) {
                    for (int i = 0; i < clip.getItemCount() && uris.size() < pendingLimit; i++) {
                        Uri u = clip.getItemAt(i).getUri();
                        if (u != null) uris.add(u);
                    }
                } else if (data.getData() != null) {
                    uris.add(data.getData());
                }
            }

            android.content.ContentResolver cr = getContext().getContentResolver();

            // v2.12：先验证所有 Uri 真的能读（小米 Photo Picker 常见不带授权）。
            // 只要有读不了的，且本轮走的是 Photo Picker，就整体降级到 ACTION_OPEN_DOCUMENT 再选一次。
            if (!pendingUseOpenDoc) {
                boolean anyDenied = false;
                for (Uri u : uris) {
                    try {
                        android.os.ParcelFileDescriptor test = cr.openFileDescriptor(u, "r");
                        if (test != null) test.close(); else anyDenied = true;
                    } catch (Exception denied) {
                        anyDenied = true;
                    }
                    if (anyDenied) break;
                }
                if (anyDenied) {
                    pendingUseOpenDoc = true;
                    pendingPick = pc;
                    Intent doc = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    doc.addCategory(Intent.CATEGORY_OPENABLE);
                    doc.setType("image/*");
                    doc.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    startActivityForResult(pc, doc, "pickImagesResult");
                    return;
                }
            }

            for (Uri u : uris) {
                // v2.12：DocumentsUI 给的授权是可持久化的，立刻固化，之后重扫也能读
                if (pendingUseOpenDoc) {
                    try {
                        cr.takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    } catch (Exception ignore) {}
                }
                JSObject o = new JSObject();
                o.put("uri", u.toString());
                String name = "";
                long taken = 0L;
                int w = 0;
                int h = 0;
                try {
                    android.database.Cursor c = cr.query(u, new String[]{
                            android.provider.OpenableColumns.DISPLAY_NAME,
                            android.provider.MediaStore.Images.Media.DATE_TAKEN,
                            android.provider.MediaStore.Images.Media.WIDTH,
                            android.provider.MediaStore.Images.Media.HEIGHT
                    }, null, null, null);
                    if (c != null) {
                        if (c.moveToFirst()) {
                            int iName = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME);
                            int iTaken = c.getColumnIndex(android.provider.MediaStore.Images.Media.DATE_TAKEN);
                            int iW = c.getColumnIndex(android.provider.MediaStore.Images.Media.WIDTH);
                            int iH = c.getColumnIndex(android.provider.MediaStore.Images.Media.HEIGHT);
                            if (iName >= 0 && !c.isNull(iName)) name = c.getString(iName);
                            if (iTaken >= 0 && !c.isNull(iTaken)) taken = c.getLong(iTaken);
                            if (iW >= 0 && !c.isNull(iW)) w = c.getInt(iW);
                            if (iH >= 0 && !c.isNull(iH)) h = c.getInt(iH);
                        }
                        c.close();
                    }
                } catch (Exception ignore) {}

                // 拿不到 DATE_TAKEN 就读 EXIF（Photo Picker 给的是没有 _id 的 Uri，MediaStore 可能查不到）
                // v2.12：顺带把 GPS 坐标也读出来带回 JS（选图会话内授权一定有效，过后可能失效）
                try {
                    android.media.ExifInterface exif =
                            new android.media.ExifInterface(cr.openFileDescriptor(u, "r").getFileDescriptor());
                    if (taken <= 0) {
                        String dt = exif.getAttribute(android.media.ExifInterface.TAG_DATETIME_ORIGINAL);
                        if (dt == null) dt = exif.getAttribute(android.media.ExifInterface.TAG_DATETIME);
                        long parsed = parseExifDateTime(dt);
                        if (parsed > 0) taken = parsed;
                    }
                    float[] latlng = new float[2];
                    if (exif.getLatLong(latlng) && !(latlng[0] == 0f && latlng[1] == 0f)) {
                        o.put("exifLat", (double) latlng[0]);
                        o.put("exifLng", (double) latlng[1]);
                    }
                } catch (Exception ignore) {}

                o.put("name", name);
                o.put("path", u.toString());
                o.put("takenAt", taken);
                o.put("width", w);
                o.put("height", h);
                arr.put(o);
            }
        } catch (Exception e) {
            pc.reject("读取所选图片失败：" + e.getMessage());
            return;
        }

        JSObject ret = new JSObject();
        ret.put("images", arr);
        pc.resolve(ret);
    }

    /** "2026:10:19 09:11:32" → 毫秒（本地时区），失败返回 0 */
    private static long parseExifDateTime(String s) {
        if (s == null || s.length() < 19) return 0L;
        try {
            int y = Integer.parseInt(s.substring(0, 4));
            int mo = Integer.parseInt(s.substring(5, 7));
            int d = Integer.parseInt(s.substring(8, 10));
            int hh = Integer.parseInt(s.substring(11, 13));
            int mm = Integer.parseInt(s.substring(14, 16));
            int ss = Integer.parseInt(s.substring(17, 19));
            java.util.Calendar c = java.util.Calendar.getInstance();
            c.set(y, mo - 1, d, hh, mm, ss);
            c.set(java.util.Calendar.MILLISECOND, 0);
            return c.getTimeInMillis();
        } catch (Exception e) {
            return 0L;
        }
    }

    /**
     * 生成杂志风格的当日 PDF（含图片、行程、图注）。
     * 参数：day / dateCN / diary / nodes:[{time,place,doing}] / photos:[{path,time,kind,place,meaning}] / outName
     * 返回：{ fileUri, absolutePath }
     */
    @PluginMethod
    public void exportPdf(PluginCall call) {
        try {
            String day = call.getString("day", "");
            String outName = call.getString("outName", "");
            if (outName.length() == 0) {
                outName = "牛马本纪-" + (day.length() > 0 ? day : String.valueOf(System.currentTimeMillis())) + ".pdf";
            }
            if (!outName.endsWith(".pdf")) outName += ".pdf";

            String uri = MagazinePdf.build(
                    getContext(),
                    outName,
                    call.getString("dateCN", ""),
                    call.getString("diary", ""),
                    call.getArray("nodes"),
                    call.getArray("photos"),
                    call.getString("weather", ""));

            JSObject ret = new JSObject();
            ret.put("fileUri", uri);
            ret.put("absolutePath", uri.startsWith("file://") ? uri.substring(7) : "");
            ret.put("location", uri.startsWith("content://") ? "Documents/牛马本纪/" + outName : "");
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("PDF 生成失败：" + (t.getMessage() == null ? t.toString() : t.getMessage()));
        }
    }

    /**
     * 用系统分享面板发送一个文件（PDF / TXT 等）。
     * 为什么不用 @capacitor/share：它只接受 file://（content:// 直接 reject），
     * 而导出的文件是 MediaStore 的 content://（Documents/牛马本纪/）；
     * 且带上 EXTRA_TEXT 时微信等应用只显示文字、丢掉文件。
     * 这里不带正文，只带 EXTRA_STREAM + 正确 MIME，文件才能原样发出去。
     * 参数：path（content:// 或 file:// 或绝对路径）、title
     */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String path = call.getString("path", "");
        String title = call.getString("title", "牛马本纪 日志");
        if (path.length() == 0) {
            call.reject("缺少要分享的文件地址");
            return;
        }
        try {
            Uri uri;
            if (path.startsWith("content://")) {
                uri = Uri.parse(path);
            } else {
                String p = path.startsWith("file://") ? Uri.parse(path).getPath() : path;
                uri = androidx.core.content.FileProvider.getUriForFile(
                        getContext(),
                        getContext().getPackageName() + ".fileprovider",
                        new java.io.File(p));
            }

            Intent intent = new Intent(Intent.ACTION_SEND);
            intent.setType(guessMime(path));
            intent.putExtra(Intent.EXTRA_STREAM, uri);
            intent.putExtra(Intent.EXTRA_SUBJECT, title);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (Build.VERSION.SDK_INT >= 29) {
                intent.setClipData(android.content.ClipData.newRawUri("", uri));
            }

            Intent chooser = Intent.createChooser(intent, title);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("分享失败：" + (t.getMessage() == null ? t.toString() : t.getMessage()));
        }
    }

    private static String guessMime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".pdf")) return "application/pdf";
        if (p.endsWith(".txt")) return "text/plain";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".zip")) return "application/zip";
        return "*/*";
    }

    /** 读取整点定位采集记录（slot-locations.json），可按 day 过滤。 */
    @PluginMethod
    public void readSlotLocations(PluginCall call) {        try {
            String day = call.getString("day", "");
            JSONArray all = SlotLocationReceiver.readAll(getContext());
            JSONArray out = new JSONArray();
            for (int i = 0; i < all.length(); i++) {
                JSONObject o = all.optJSONObject(i);
                if (o == null) continue;
                if (day.length() > 0 && !day.equals(o.optString("day", ""))) continue;
                out.put(o);
            }
            JSObject ret = new JSObject();
            ret.put("entries", out);
            call.resolve(ret);
        } catch (Throwable t) {
            call.reject("读取定位记录失败：" + (t.getMessage() == null ? t.toString() : t.getMessage()));
        }
    }

    /** 读取一张图的原图字节，返回 dataURL（不重编码；超大图自动降采样到 4096 再编码）。 */
    @PluginMethod
    public void readImageOriginal(PluginCall call) {
        final String src = call.getString("src", "");
        if (src.length() == 0) {
            call.reject("缺少图片地址");
            return;
        }
        final int maxEdge = call.getInt("maxEdge", 4096);
        new Thread(() -> {
            try {
                android.graphics.Bitmap bmp = MagazinePdf.decodeFit(getContext(), src, maxEdge);
                if (bmp == null) {
                    // 退回私有副本路径再试一次
                    String alt = MagazinePdf.normalizePath(src);
                    if (alt != null) bmp = MagazinePdf.decodeFit(getContext(), alt, maxEdge);
                }
                if (bmp == null) {
                    postSafeReject(call, "图片读取失败");
                    return;
                }                android.graphics.Bitmap.CompressFormat fmt =
                        src.toLowerCase().contains("png") ? android.graphics.Bitmap.CompressFormat.PNG
                                : android.graphics.Bitmap.CompressFormat.JPEG;
                java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
                bmp.compress(fmt, 92, bo);
                bmp.recycle();
                String b64 = android.util.Base64.encodeToString(bo.toByteArray(), android.util.Base64.NO_WRAP);
                JSObject ret = new JSObject();
                ret.put("dataUrl", "data:image/" + (fmt == android.graphics.Bitmap.CompressFormat.PNG ? "png" : "jpeg")
                        + ";base64," + b64);
                call.resolve(ret);
            } catch (Throwable t) {
                postSafeReject(call, "原图读取失败：" + (t.getMessage() == null ? t.toString() : t.getMessage()));
            }
        }).start();
    }

    private void postSafeReject(PluginCall call, String msg) {
        // Capacitor 的 resolve/reject 内部会切换回桥线程，可直接调用
        call.reject(msg);
    }

    @Override
    public void load() {
        // App 启动即恢复整点定位闹钟（幂等，重复注册会覆盖）
        try {
            SlotLocationReceiver.scheduleAll(getContext());
        } catch (Throwable ignored) {
        }
    }
}
