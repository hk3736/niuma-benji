package com.everylog.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * 杂志风格的日记 PDF 生成器（纯 Android API，无第三方依赖）。
 *
 * 版式：
 *   [刊头] 牛马本纪 · 小字刊名 / 大字日期 / 细分隔线
 *   [正文] 日记散文（首行缩进、1.3 倍行距）
 *   [行程] 当日行程（时间 + 地点）
 *   [图片] 每张图：整幅排版（原图解码后按页宽缩放）+ 时间地点 + 一句话含义
 *   [页脚] 页码 + 生成署名
 *
 * 落盘：API 29+ 写入公共 Documents/牛马本纪/（文件管理器可见）；低版本退回应用私有目录。
 * 图片来源：优先 content:// 原图（相册原图），失败退用应用私有目录里的副本。
 */
public class MagazinePdf {

    private static final int PAGE_W = 595;  // A4 72dpi
    private static final int PAGE_H = 842;
    private static final int MARGIN = 52;
    private static final int CONTENT_W = PAGE_W - MARGIN * 2;

    private static final int INK = Color.rgb(31, 41, 55);        // 深墨
    private static final int SOFT = Color.rgb(107, 114, 128);    // 灰
    private static final int ACCENT = Color.rgb(176, 139, 79);   // 金棕
    private static final int RULE = Color.rgb(229, 224, 213);    // 米色分隔线

    private final PdfDocument doc = new PdfDocument();
    private PdfDocument.Page page;
    private boolean pageOpen = false;
    private Canvas canvas;
    private int pageNo = 0;
    private int y = 0;
    // v2.15：图片页固定上下两个半版槽位，每页 2 个图文块
    private static final int PHOTO_BOTTOM = PAGE_H - MARGIN - 36; // 页脚之上
    private int photosOnPage = 0;
    private float slotTop = 0;
    private float slotH = 0;

    /**
     * 生成 PDF 并落盘，返回可分享的 uri（content:// 或 file://）。
     * @param srcs photos 里每张图的原图地址（content:// 优先）
     * @param weather 当天天气简述（如「多云 · 14~23℃」），空串则不显示
     */
    public static String build(Context ctx, String outName, String dateCN, String diary,
                               JSONArray nodes, JSONArray photos, String weather) throws Exception {
        MagazinePdf p = new MagazinePdf();
        try {
            p.render(ctx, dateCN, diary, nodes, photos, weather);
        } finally {
            p.finishOpenPage(); // 任何路径都不把未完成页留给 writeTo
        }
        return save(ctx, outName, p.doc);
    }

    private static String save(Context ctx, String outName, PdfDocument doc) throws Exception {
        // 1) API 29+：写公共 Documents/牛马本纪/，文件管理器直接可见
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                // 同名旧文件先删掉，保证「重新生成覆盖」
                deletePublic(ctx, outName);
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.MediaColumns.DISPLAY_NAME, outName);
                cv.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
                cv.put(MediaStore.MediaColumns.RELATIVE_PATH,
                        Environment.DIRECTORY_DOCUMENTS + "/牛马本纪");
                ContentResolver cr = ctx.getContentResolver();
                Uri uri = cr.insert(MediaStore.Files.getContentUri("external"), cv);
                if (uri != null) {
                    OutputStream os = cr.openOutputStream(uri);
                    doc.writeTo(os);
                    os.close();
                    return uri.toString();
                }
            } catch (Throwable t) {
                // 落到私有目录方案
            }
        }
        // 2) 退回应用私有目录
        File out = new File(new File(ctx.getFilesDir(), "exports"), outName);
        File dir = out.getParentFile();
        if (!dir.exists()) dir.mkdirs();
        OutputStream os = new FileOutputStream(out);
        doc.writeTo(os);
        os.close();
        return Uri.fromFile(out).toString();
    }

    private static void deletePublic(Context ctx, String outName) {
        try {
            ContentResolver cr = ctx.getContentResolver();
            String sel = MediaStore.MediaColumns.RELATIVE_PATH + "=? AND " + MediaStore.MediaColumns.DISPLAY_NAME + "=?";
            String[] args = new String[]{Environment.DIRECTORY_DOCUMENTS + "/牛马本纪/", outName};
            cr.delete(MediaStore.Files.getContentUri("external"), sel, args);
        } catch (Throwable ignored) {
        }
    }

    /* ---------------- 页面生命周期 ---------------- */

    private void newPage() {
        finishOpenPage();
        page = doc.startPage(new PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, ++pageNo).create());
        canvas = page.getCanvas();
        canvas.drawColor(Color.rgb(253, 251, 246)); // 米白纸色
        drawFooter(canvas); // 页脚位置固定，开页就画
        y = MARGIN + 14;
        photosOnPage = 0;
        pageOpen = true;
    }

    private void finishOpenPage() {
        if (pageOpen && page != null) {
            try {
                doc.finishPage(page);
            } catch (Throwable ignored) {
            }
            pageOpen = false;
        }
    }

    private void ensureSpace(int need) {
        if (y + need > PAGE_H - MARGIN - 26) newPage();
    }

    private void drawFooter(Canvas c) {
        TextPaint fp = paint(9f, SOFT, Typeface.DEFAULT);
        String num = "— " + pageNo + " —";
        float w = fp.measureText(num);
        c.drawText(num, (PAGE_W - w) / 2f, PAGE_H - 28, fp);
        String sig = "牛马本纪 · 本机生成";
        c.drawText(sig, PAGE_W - MARGIN - fp.measureText(sig), PAGE_H - 28, fp);
    }

    /* ---------------- 内容 ---------------- */

    private void render(Context ctx, String dateCN, String diary, JSONArray nodes, JSONArray photos, String weather) {
        newPage();

        // ---- 页首双细线（v2.14：放在页面最顶端，不再和日期文字重叠） ----
        int ruleY = MARGIN + 2;
        canvas.drawLine(MARGIN, ruleY, PAGE_W - MARGIN, ruleY, linePaint(RULE, 1.4f));
        canvas.drawLine(MARGIN, ruleY + 5, PAGE_W - MARGIN, ruleY + 5, linePaint(RULE, 0.7f));
        y = ruleY + 24;

        // ---- 刊头 ----
        TextPaint small = paint(11, ACCENT, Typeface.DEFAULT_BOLD);
        drawCentered("NIU MA BEN JI · 牛马本纪", small);
        y += 18;

        // ---- 日子与星期（大字） ----
        TextPaint big = paint(30, INK, Typeface.DEFAULT_BOLD);
        drawCentered(dateCN == null ? "" : dateCN, big);
        y += 34;

        // ---- 天气小字（题头与星期之后） ----
        if (weather != null && weather.length() > 0) {
            TextPaint wp = paint(10, SOFT, Typeface.DEFAULT);
            drawCentered(weather, wp);
            y += 18;
        }

        // ---- 日记正文（按时段分段，每段首行缩进两字） ----
        if (diary != null && diary.length() > 0) {
            TextPaint body = paint(12.5f, INK, Typeface.DEFAULT);
            body.setLetterSpacing(0.02f);
            String norm = diary.replace("\r\n", "\n").replace("\r", "\n");
            for (String para : norm.split("\n+")) {
                String t = para.trim();
                if (t.length() == 0) continue;
                ensureSpace(40);
                y += drawWrapped("　　" + t, body, 0) + 12; // 段间留白
            }
            y += 14;
        }

        // ---- 当日行程 ----
        if (nodes != null && nodes.length() > 0) {
            ensureSpace(60);
            sectionTitle("当日行程");
            TextPaint tpTime = paint(10.5f, ACCENT, Typeface.DEFAULT_BOLD);
            TextPaint tpBody = paint(11.5f, INK, Typeface.DEFAULT);
            for (int i = 0; i < nodes.length() && i < 10; i++) {
                JSONObject n = nodes.optJSONObject(i);
                if (n == null) continue;
                String time = n.optString("time", "");
                String place = n.optString("place", "");
                String doing = n.optString("doing", "");
                ensureSpace(34);
                StaticLayout sl = time(place + (doing.length() > 0 ? "　" + doing : ""), tpBody);
                canvas.drawText(time, MARGIN, y + tpTime.getTextSize() * 0.9f, tpTime);
                drawIndented(sl, MARGIN + 56);
                y += sl.getHeight() + 8;
            }
            y += 14;
        }

        // ---- 图片：独占整页，上下两个半版各放一个图文块 ----
        if (photos != null && photos.length() > 0) {
            startPhotoPage();
            for (int i = 0; i < photos.length(); i++) {
                JSONObject ph = photos.optJSONObject(i);
                if (ph == null) continue;
                drawPhotoBlock(ctx, ph);
            }
        }
    }

    /** 图片页开页：新起一页，画小节标题，把剩余版面均分为上下两个槽位。 */
    private void startPhotoPage() {
        newPage();
        sectionTitle("图片里的今天");
        slotTop = y;
        slotH = (PHOTO_BOTTOM - slotTop) / 2f;
        photosOnPage = 0;
    }

    /**
     * 左图右文：每个图块占满上下两个半版槽位之一，图片与文字各自在槽位内垂直居中，
     * 两个槽位之间画一条细分隔线。一页固定 2 个图块，第 3 个起换新页。
     */
    private void drawPhotoBlock(Context ctx, JSONObject ph) {
        if (photosOnPage >= 2) startPhotoPage();
        float top = slotTop + photosOnPage * slotH;
        photosOnPage++;

        String src = ph.optString("src", "");
        if (src.length() == 0) src = ph.optString("path", "");
        Bitmap bmp = decodeFit(ctx, src, 1200);
        String time = ph.optString("time", "");
        String kind = ph.optString("kind", "照片");
        String place = ph.optString("place", "");
        String meaning = ph.optString("meaning", "");

        float imgW = CONTENT_W * 0.52f;
        float gap = 14;
        float txtX = MARGIN + imgW + gap;
        float txtW = CONTENT_W - imgW - gap;
        float imgMaxH = slotH - 8;

        // 右侧文字
        TextPaint capT = paint(10.5f, INK, Typeface.DEFAULT_BOLD);      // 时间 · 类型
        TextPaint capP = paint(10.5f, ACCENT, Typeface.DEFAULT_BOLD);   // 地点
        TextPaint capM = paint(10.5f, INK, Typeface.DEFAULT);           // 含义
        boolean hasPlace = place.length() > 0;
        StaticLayout slFirst = hasPlace
                ? new StaticLayout(place, capP, (int) txtW, Layout.Alignment.ALIGN_NORMAL, 1.25f, 0f, false)
                : new StaticLayout(time + " · " + kind, capT, (int) txtW, Layout.Alignment.ALIGN_NORMAL, 1.25f, 0f, false);
        StaticLayout slSecond = hasPlace
                ? new StaticLayout(time + " · " + kind, capT, (int) txtW, Layout.Alignment.ALIGN_NORMAL, 1.25f, 0f, false)
                : null;
        StaticLayout slM = meaning.length() > 0
                ? new StaticLayout(meaning, capM, (int) txtW, Layout.Alignment.ALIGN_NORMAL, 1.3f, 0f, false)
                : null;
        float txtH = slFirst.getHeight() + (slSecond != null ? slSecond.getHeight() + 4 : 0) + (slM != null ? slM.getHeight() + 6 : 0);

        // 左：图片（限宽限高后在槽位内垂直居中）
        if (bmp != null) {
            float drawW = imgW;
            float drawH = drawW * bmp.getHeight() / bmp.getWidth();
            if (drawH > imgMaxH) {
                drawH = imgMaxH;
                drawW = drawH * bmp.getWidth() / bmp.getHeight();
            }
            float iy = top + (slotH - drawH) / 2f;
            RectF dst = new RectF(MARGIN, iy, MARGIN + drawW, iy + drawH);
            canvas.drawBitmap(bmp, null, dst, new Paint(Paint.FILTER_BITMAP_FLAG));
            bmp.recycle();
        }

        // 右：文字（在槽位内垂直居中）
        float ty = top + Math.max(0, (slotH - txtH) / 2f);
        drawAt(canvas, slFirst, txtX, ty);
        ty += slFirst.getHeight() + 4;
        if (slSecond != null) {
            drawAt(canvas, slSecond, txtX, ty);
            ty += slSecond.getHeight() + 6;
        }
        if (slM != null) {
            drawAt(canvas, slM, txtX, ty);
        }

        // 上下槽位之间的细分隔线（只在上块之后画）
        if (photosOnPage == 1) {
            float midY = top + slotH;
            canvas.drawLine(MARGIN, midY, PAGE_W - MARGIN, midY, linePaint(RULE, 0.8f));
        }
    }

    private void drawCentered(String t, TextPaint tp) {
        float w = tp.measureText(t);
        canvas.drawText(t, (PAGE_W - w) / 2f, y + tp.getTextSize() * 0.9f, tp);
    }

    private void sectionTitle(String t) {
        TextPaint tp = paint(16f, INK, Typeface.DEFAULT_BOLD);
        canvas.drawText(t, MARGIN, y + tp.getTextSize() * 0.95f, tp);
        y += tp.getTextSize() + 6;
        canvas.drawLine(MARGIN, y, MARGIN + 64, y, linePaint(ACCENT, 2.2f));
        y += 20;
    }

    // ---------- 绘制工具 ----------

    private static TextPaint paint(float sp, int color, Typeface face) {
        TextPaint tp = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        tp.setTextSize(sp);
        tp.setColor(color);
        tp.setTypeface(face);
        return tp;
    }

    private static Paint linePaint(int color, float width) {
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        p.setStrokeWidth(width);
        return p;
    }

    private static void drawAt(Canvas c, StaticLayout sl, float x, float top) {
        c.save();
        c.translate(x, top);
        sl.draw(c);
        c.restore();
    }

    private int drawWrapped(String text, TextPaint tp, float extraIndent) {
        StaticLayout sl = new StaticLayout(text, tp, (int) (CONTENT_W - extraIndent),
                Layout.Alignment.ALIGN_NORMAL, 1.3f, 0f, false);
        drawAt(canvas, sl, MARGIN + extraIndent, y);
        y += sl.getHeight();
        return sl.getHeight();
    }

    private StaticLayout time(String text, TextPaint tp) {
        return new StaticLayout(text, tp, CONTENT_W - 56,
                Layout.Alignment.ALIGN_NORMAL, 1.25f, 0f, false);
    }

    private void drawIndented(StaticLayout sl, float x) {
        drawAt(canvas, sl, x, y);
    }

    /* ---------------- 图片解码（原图优先） ---------------- */

    /**
     * 解码图片，最长边压到 maxPx，失败返回 null。
     * 支持 content://（相册原图，走 ContentResolver）与文件路径 / file:// / _capacitor_file_ 地址。
     */
    static Bitmap decodeFit(Context ctx, String raw, int maxPx) {
        String s = raw == null ? "" : raw.trim();
        if (s.length() == 0) return null;
        try {
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            InputStream bin = openStream(ctx, s);
            if (bin != null) {
                BitmapFactory.decodeStream(bin, null, o);
                try { bin.close(); } catch (Throwable ignored) {}
            } else {
                BitmapFactory.decodeFile(normalizePath(s), o);
            }
            if (o.outWidth <= 0) return null;

            BitmapFactory.Options o2 = new BitmapFactory.Options();
            int sample = 1;
            while (Math.max(o.outWidth, o.outHeight) / sample > maxPx) sample *= 2;
            o2.inSampleSize = sample;

            InputStream din = openStream(ctx, s);
            if (din != null) {
                Bitmap bmp = BitmapFactory.decodeStream(din, null, o2);
                try { din.close(); } catch (Throwable ignored) {}
                return bmp;
            }
            return BitmapFactory.decodeFile(normalizePath(s), o2);
        } catch (Throwable t) {
            return null;
        }
    }

    private static InputStream openStream(Context ctx, String s) {
        try {
            ContentResolver cr = ctx.getContentResolver();
            if (s.startsWith("content://")) {
                return cr.openInputStream(Uri.parse(s));
            }
            int m = s.indexOf("_capacitor_file_");
            if (m >= 0) return null; // 私有副本，走文件路径
            if (s.startsWith("file://")) return cr.openInputStream(Uri.parse(s));
            return null;
        } catch (Throwable t) {
            return null;
        }
    }

    static String normalizePath(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.length() == 0) return null;
        int m = s.indexOf("_capacitor_file_");
        if (m >= 0) return s.substring(m + "_capacitor_file_".length());
        if (s.startsWith("file://")) return s.substring(7);
        if (s.startsWith("http") || s.startsWith("content:") || s.startsWith("data:")) return null;
        if (s.startsWith("/")) return s;
        return null;
    }
}
