# 牛马本纪 EveryLog

用手机相册里的照片 + GPS 轨迹，自动生成当日日记与杂志版 PDF 的 Android 应用。

- 前端：uni-app（Vue 3）+ Vite
- 原生壳：Capacitor 6 + Android（相册扫描、EXIF/XMP 定位解析、PDF 排版插件 `GalleryPlugin` / `MagazinePdf`）
- 文本生成：接入 OpenAI 兼容接口的大模型（DeepSeek / 通义 / 智谱 / Kimi / OpenAI 等，或本地 Ollama），可配置风格（抒情 / 小资 / 正式）
- 天气：Open-Meteo（免费、免 Key）
- 逆地理编码：OSM Nominatim / Photon，可选高德

## 功能

- 扫描当天相册照片，读取拍摄时间与 GPS 位置（支持小米 HyperOS 的 XMP 坐标与 `ACCESS_MEDIA_LOCATION` 权限）
- 按 上午 / 中午 / 下午 / 晚上 分段生成日记，每段首行缩进两字
- 导出杂志版 PDF：页首双细线 + 日期 + 天气小字，图片页每页上下两个图文块
- 同时导出 TXT 到 `Documents/牛马本纪/`

## 快速开始

需要 Node.js 18+、JDK 17、Android SDK。

```bash
npm install
npm run dev:h5          # 浏览器预览
npm run build:h5        # 构建 H5
npx cap sync android    # 同步到 Android 工程
cd android && ./gradlew assembleDebug
```

Windows 下双击 `build-apk.bat` 可一键构建并复制 APK。

### 打包环境变量

`build-apk.bat` 会自动探测常见的 JDK / Android SDK 安装位置。如果没探测到，在项目根目录新建 `build-apk.local.bat`（已被 git 忽略）写入自己的路径：

```bat
set JAVA_HOME=D:\dev\jdk-17
set ANDROID_HOME=D:\dev\android-sdk
```

## 配置

App 内的「设置」页填写大模型 API Key、接口地址与模型名，以及可选的：

- **高德 Key**：用于更准确的国内地名解析（逆地理编码）
- **文本生成风格**：抒情 / 小资 / 正式

所有配置与 Key 仅保存在本机（uni storage），不会上传到任何服务器。

## 目录

```
src/                       uni-app 源码
src/pages/index/           首页：扫描、生成日志
src/pages/preview/         预览：阅读、导出 PDF
src/pages/settings/        设置：模型、Key、文风
src/pages/logs/            历史日志
src/utils/llm.js           大模型调用与提示词（分段、文风）
src/utils/gallery.js       相册扫描与 EXIF 读取（含原生插件桥接）
src/utils/exif.js          JPEG EXIF / XMP 坐标解析
src/utils/geo.js           逆地理编码（Nominatim / Photon / 高德）
src/utils/pdf.js           导出 TXT / PDF 参数组装 / H5 打印版式
src/utils/weather.js       Open-Meteo 天气查询
android/app/src/main/java/com/everylog/app/
  GalleryPlugin.java       Capacitor 插件：权限、扫描、导出
  MagazinePdf.java         原生 PDF 排版
```

## 发布

见 [Releases](https://github.com/hk3736/niuma-benji/releases)。

## 许可

MIT License，详见 [LICENSE](LICENSE)。
