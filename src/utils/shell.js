// 本地 APK（Capacitor 原生壳）能力桥。
// 只有在原生壳里才生效；H5 / 小程序 / uni-app 云打包环境自动走原有分支，互不影响。
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { Camera } from '@capacitor/camera'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { wgs84ToGcj02 } from './coord.js'

export function isShell() {
	try {
		return Capacitor.isNativePlatform()
	} catch (e) {
		return false
	}
}

/* ---------------- 定位 ---------------- */

export async function currentPosition() {
	const p = await Geolocation.getCurrentPosition({
		enableHighAccuracy: true,
		timeout: 20000,
		maximumAge: 30000
	})
	const c = wgs84ToGcj02(p.coords.latitude, p.coords.longitude)
	return { latitude: c.latitude, longitude: c.longitude, accuracy: p.coords.accuracy }
}

/* ---------------- 照片 ---------------- */

function loadImage(src) {
	return new Promise((resolve, reject) => {
		const img = new Image()
		img.onload = () => resolve(img)
		img.onerror = () => reject(new Error('图片读取失败'))
		img.src = src
	})
}

// 压到指定最长边，返回 dataURL（jpeg）
export async function compressToDataUrl(src, maxEdge = 1280, quality = 0.72) {
	if (!src || src.startsWith('data:')) return src
	const img = await loadImage(src)
	const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
	const w = Math.max(1, Math.round(img.width * scale))
	const h = Math.max(1, Math.round(img.height * scale))
	const canvas = document.createElement('canvas')
	canvas.width = w
	canvas.height = h
	canvas.getContext('2d').drawImage(img, 0, 0, w, h)
	return canvas.toDataURL('image/jpeg', quality)
}

// 系统相册选择器（Android Photo Picker，无需存储权限）
export async function pickImages(max = 9) {
	const { photos } = await Camera.pickImages({ limit: max, quality: 85 })
	return (photos || []).map(p => p.webPath)
}

// 压缩后落到 App 私有目录，返回 WebView 可直接渲染的地址
export async function savePhotoToData(src) {
	const dataUrl = await compressToDataUrl(src, 1600, 0.82)
	const base64 = dataUrl.split(',')[1]
	const name = `photos/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`
	const res = await Filesystem.writeFile({
		path: name,
		data: base64,
		directory: Directory.Data,
		recursive: true
	})
	// convertFileSrc 是同步的：file:///... → https://localhost/_capacitor_file_/...
	return Capacitor.convertFileSrc(res.uri)
}

export async function dataUrlFrom(src) {
	if (!src) throw new Error('图片路径为空')
	if (src.startsWith('data:')) return src
	const r = await fetch(src)
	if (!r.ok) throw new Error('读取图片失败 ' + r.status)
	const blob = await r.blob()
	return new Promise((resolve, reject) => {
		const fr = new FileReader()
		fr.onload = () => resolve(fr.result)
		fr.onerror = () => reject(new Error('图片转码失败'))
		fr.readAsDataURL(blob)
	})
}

/* ---------------- 相册原图 ---------------- */

// MediaStore 给的路径先试原始路径，失败再试补 file:// / content://（Android 10+ 分区存储）
async function firstReadable(candidates, maxEdge, quality) {
	let lastErr = null
	for (const c of candidates) {
		if (!c) continue
		const src = /^(file|content|https?|data):/.test(c) ? c : 'file://' + c
		try {
			return await compressToDataUrl(src, maxEdge, quality)
		} catch (e) {
			lastErr = e
		}
	}
	throw lastErr || new Error('图片读取失败')
}

// 从相册路径/URI 读出压缩后的 dataURL（给模型看图用）
export function galleryImageToDataUrl(pathOrUri, maxEdge = 1024, quality = 0.62) {
	if (!pathOrUri) return Promise.reject(new Error('图片路径为空'))
	const list = pathOrUri.startsWith('content://')
		? [pathOrUri]
		: [pathOrUri, 'file://' + pathOrUri, 'content://' + pathOrUri]
	return firstReadable(list, maxEdge, quality)
}

// 存一份进 App 私有目录，返回 WebView 能直接渲染的地址。
// 原生端优先走 GalleryScan.importImage（ContentResolver 解码 → 重编码 → 私有目录），
// 这是唯一可靠的路径：content:// 在 WebView 里是空白，/storage 路径在 Android 10+ 也读不到。
// 都失败才退回原始 URI（至少在系统看图器里还能打开）。
export async function persistGalleryImage(pathOrUri) {
	// 1) 原生插件优先
	try {
		const { importImageNative } = await import('./gallery.js')
		const fileUri = await importImageNative({ uri: pathOrUri, path: pathOrUri }, 1600, 82)
		if (fileUri) return Capacitor.convertFileSrc(fileUri)
	} catch (e) {
		// 继续尝试下面的 WebView 方案
	}

	// 2) WebView + Filesystem 兜底（H5、或插件不可用时）
	try {
		const dataUrl = await galleryImageToDataUrl(pathOrUri, 1600, 0.82)
		const base64 = dataUrl.split(',')[1]
		const name = `photos/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`
		const res = await Filesystem.writeFile({
			path: name,
			data: base64,
			directory: Directory.Data,
			recursive: true
		})
		if (res && res.uri) return Capacitor.convertFileSrc(res.uri)
	} catch (e) {
		// 落到 3)
	}

	// 3) 原样返回
	return pathOrUri
}

/* ---------------- 导出 ---------------- */

// 优先写公共 Documents/EveryLog/（用户能直接看到），失败则落 App 私有目录
export async function writeDocText(name, text) {
	try {
		const res = await Filesystem.writeFile({
			path: name,
			data: text,
			directory: Directory.Documents,
			recursive: true,
			encoding: 'utf8'
		})
		return res.uri
	} catch (e) {
		const res = await Filesystem.writeFile({
			path: name.replace(/^EveryLog\//, 'exports/'),
			data: text,
			directory: Directory.Data,
			recursive: true,
			encoding: 'utf8'
		})
		return res.uri
	}
}

// 分享导出的文件。优先走自研 GalleryScan.shareFile：
//   - @capacitor/share 只接受 file://（content:// 直接 reject），而导出的
//     TXT/PDF 都是 MediaStore 的 content://（Documents/牛马本纪/）
//   - 官方插件带 EXTRA_TEXT 时微信等应用只显示文字、丢掉文件
// 自研实现不带正文，只带 EXTRA_STREAM + 正确 MIME，PDF/TXT 都能原样发出
export async function shareFile(uri, title = '导出日志') {
	if (isShell()) {
		try {
			const { registerPlugin } = await import('@capacitor/core')
			const GalleryScan = registerPlugin('GalleryScan')
			await GalleryScan.shareFile({ path: uri, title })
			return
		} catch (e) {
			// 插件不可用时退回官方 Share（只对 file:// 有效）
		}
	}
	await Share.share({ title, files: [uri], dialogTitle: title })
}
