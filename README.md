# 牛马本纪 EveryLog

用手机相册里的照片 + GPS 轨迹，自动生成当日日记与杂志版 PDF 的 Android 应用。

- 前端：uni-app（Vue 3）+ Vite
- 原生壳：Capacitor 6 + Android（相册扫描、EXIF/XMP 定位解析、PDF 排版插件 `GalleryPlugin` / `MagazinePdf`）
- 文本生成：接入 OpenAI 兼容接口的大模型（DeepSeek 等），可配置风格（抒情 / 小资 / 正式）
- 天气：Open-Meteo 免 Key 接口

## 功能

- 扫描当天相册照片，读取拍摄时间与 GPS 位置（支持小米 HyperOS 的 XMP 坐标与 `ACCESS_MEDIA_LOCATION` 权限）
- 按 上午 / 中午 / 下午 / 晚上 分段生成日记，每段首行缩进两字
- 导出杂志版 PDF：页首双细线 + 日期 + 天气小字，图片页每页上下两个图文块
- 同时导出 TXT 到 `Documents/牛马本纪/`

## 开发

```bash
npm install
npm run dev:h5          # 浏览器预览
npm run build:h5        # 构建 H5
npx cap sync android    # 同步到 Android 工程
cd android && ./gradlew assembleDebug
```

Windows 下一键打包见 `build-apk.bat`。

## 目录

```
src/                     uni-app 源码（页面、工具函数）
src/utils/llm.js         大模型调用与提示词（分段、文风）
src/utils/gallery.js     相册扫描与 EXIF 读取（含原生插件桥接）
src/utils/pdf.js         导出 TXT / PDF 参数组装 / H5 打印版式
android/app/src/main/java/com/everylog/app/
  GalleryPlugin.java     Capacitor 插件：权限、扫描、导出
  MagazinePdf.java       原生 PDF 排版
```
