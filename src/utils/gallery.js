// 相册访问桥：
//  - 本地 APK（原生壳）：调用项目自带的 GalleryScan 插件（MediaStore 查询 + EXIF）
//  - 浏览器演示：用 File System Access API 选一个相册文件夹，读文件名里的时间 + 内嵌 EXIF
// 对外只有三个方法：hasAccess / requestAccess / scanWindow
import { registerPlugin, Capacitor } from '@capacitor/core'
import { isShell } from './shell.js'
import { parseExif, parseXmpGps } from './exif.js'

const GalleryScan = registerPlugin('GalleryScan')

export function isNativeGallery() {
	return isShell() && Capacitor.getPlatform() === 'android'
}

/** @returns {Promise<{granted:boolean, sdk?:number}>} */
export async function hasAccess() {
	if (isNativeGallery()) {
		try {
			return await GalleryScan.checkAccess()
		} catch (e) {
			return { granted: false }
		}
	}
	// 浏览器：由用户手动选文件夹，这里无法预判
	return { granted: false, browser: true }
}

export async function requestAccess() {
	if (isNativeGallery()) {
		try {
			return await GalleryScan.requestAccess()
		} catch (e) {
			return { granted: false }
		}
	}
	return { granted: false, browser: true }
}

/**
 * 扫描一个时间窗内的图片。
 * @param {number} from 起始毫秒
 * @param {number} to 结束毫秒（不含）
 * @param {number} limit 上限
 * @returns {Promise<Array<{id,path,uri,takenAt,name,width,height}>>}
 */
export async function scanWindow(from, to, limit = 200) {
	if (!isNativeGallery()) return []
	const res = await GalleryScan.queryImages({ from, to, limit })
	return (res && res.images) || []
}

/** 原生端读单张照片的 EXIF（自带解析兜底） */
export async function readExifNative(path) {
	if (!isNativeGallery()) return null
	if (!path) return null
	try {
		return await GalleryScan.readExif({ path })
	} catch (e) {
		return null
	}
}

/**
 * v2.8 诊断链：native readExif → 失败则取原图头部字节 JS parseExif 兜底，
 * 全程记录每一步结果，返回 { ex, dbg } —— dbg 会写进照片记录，界面上直接可见。
 */
function fmtExifDate(ms) {
	const d = new Date(ms)
	const p = n => String(n).padStart(2, '0')
	return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function errMsg(e) {
	return (e && (e.message || e.errMsg)) || String(e || 'reject')
}

export async function readExifChain(path) {
	if (!isNativeGallery()) return { ex: null, dbg: 'not-native' }
	if (!path) return { ex: null, dbg: 'no-path' }

	const f5 = v => (typeof v === 'number' ? v.toFixed(4) : String(v))

	let ex = null
	let nativeErr = ''
	try {
		ex = await GalleryScan.readExif({ path })
	} catch (e) {
		nativeErr = errMsg(e)
	}
	// v2.12：native 返回 (0,0) 不再当有效坐标提前返回（小米把 GPS 写进 XMP 或
	// GPS rational 分母异常时 native 会报 0,0），继续走头部 JS 解析 + XMP 兜底
	const nativeZero = ex && ex.latitude === 0 && ex.longitude === 0
	if (ex && typeof ex.latitude === 'number' && typeof ex.longitude === 'number' && !nativeZero) {
		return { ex, dbg: `native(${f5(ex.latitude)},${f5(ex.longitude)})` }
	}

	let headErr = ''
	let headLen = 0
	try {
		const head = await GalleryScan.readExifHead({ path })
		headLen = (head && head.length) || 0
		if (!head || !head.base64) {
			headErr = 'empty'
		} else {
			const bin = atob(head.base64)
			const bytes = new Uint8Array(bin.length)
			for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
			let js = parseExif(bytes.buffer)
			let src = 'head'
			// v2.12：EXIF GPS 缺失或为 0 时，再试 XMP（小米照片坐标常在 XMP 里）
			if (!js || js.latitude == null || (js.latitude === 0 && js.longitude === 0)) {
				const x = parseXmpGps(bytes.buffer)
				if (x) {
					if (!js) js = { takenAt: null }
					js.latitude = x.latitude
					js.longitude = x.longitude
					src = 'xmp'
				}
			}
			if (!js) {
				headErr = `noexif(len=${headLen})`
			} else {
				const merged = {
					latitude: js.latitude,
					longitude: js.longitude,
					dateTime: js.takenAt ? fmtExifDate(js.takenAt) : (ex && ex.dateTime) || null
				}
				return {
					ex: merged,
					dbg: js.latitude != null ? `${src}(${f5(js.latitude)},${f5(js.longitude)})` : (merged.dateTime ? 'head-timeonly' : 'head-noexif')
				}
			}
		}
	} catch (e) {
		headErr = errMsg(e)
	}
	const nInfo = nativeErr || (ex ? `obj(${f5(ex.latitude)},${f5(ex.longitude)})` : 'null')
	return { ex, dbg: `none(n=${nInfo},h=${headErr || headLen})` }
}



/**
 * 原生端把相册图导入 App 私有目录（重编码 + 摆正 + 缩放），返回 file:// 绝对路径。
 * 必须在原生端做：WebView 无法渲染 content://，也读不到分区存储里的 /storage 路径。
 * @param {{uri?:string, path?:string}} item scanWindow 返回的条目
 * @returns {Promise<string|null>} file:// 地址，失败返回 null
 */
export async function importImageNative(item, maxEdge = 1600, quality = 85) {
	if (!isNativeGallery() || !item) return null
	for (const args of [{ uri: item.uri, path: item.path }, { path: item.path }, { uri: item.uri }]) {
		if (!args.uri && !args.path) continue
		try {
			const r = await GalleryScan.importImage({ ...args, maxEdge, quality })
			if (r && r.fileUri) return r.fileUri
		} catch (e) {
			// 换下一种定位方式再试
		}
	}
	return null
}

// 一次手动上传最多几张（系统选择器本身允许更多，这里限一下避免内存压力）
export const MANUAL_PICK_LIMIT = 20

/**
 * 原生端生成杂志风 PDF（含图片）。返回 { fileUri, absolutePath }，失败抛错。
 * @param {{day:string, dateCN:string, diary:string, nodes:Array, photos:Array, outName?:string}} payload
 */
export async function exportPdfNative(payload) {
	if (!isNativeGallery()) throw new Error('仅原生壳支持')
	const r = await GalleryScan.exportPdf(payload)
	if (!r || !r.fileUri) throw new Error('PDF 生成返回为空')
	return r
}

/** 把 WebView 的图片地址还原成绝对文件路径（给原生 Bitmap 解码用） */
export function toAbsFilePath(urlOrPath) {
	if (!urlOrPath) return ''
	const s = String(urlOrPath)
	if (s.indexOf('file://') === 0) return decodeURIComponent(s.slice(7))
	const mark = '_capacitor_file_'
	const i = s.indexOf(mark)
	if (i >= 0) return decodeURIComponent(s.slice(i + mark.length))
	if (/^(https?|data|content):/.test(s)) return ''
	return s.startsWith('/') ? s : ''
}

/**
 * 读取整点定位采集记录（原生后台在 9/12/15/18 点写的）。
 * @param {string} day 'yyyy-MM-dd'，空串取全部
 * @returns {Promise<Array<{day,hour,ts,latitude,longitude,place?}>>}
 */
export async function readSlotLocations(day = '') {
	if (!isNativeGallery()) return []
	try {
		const r = await GalleryScan.readSlotLocations({ day })
		return (r && r.entries) || []
	} catch (e) {
		return []
	}
}

/**
 * 读一张图的原图 dataURL（原生端解码，不经过 WebView；超大会降采样到 maxEdge）。
 * 用于提交 AI 与导出：src 优先给相册原图的 content:// 地址。
 */
export async function readImageOriginal(src, maxEdge = 4096) {
	if (!isNativeGallery() || !src) return ''
	try {
		const r = await GalleryScan.readImageOriginal({ src, maxEdge })
		return (r && r.dataUrl) || ''
	} catch (e) {
		return ''
	}
}

/**
 * 让用户从系统相册手选图片（Android Photo Picker，无需存储权限）。
 * 返回 [{ name, uri, path, takenAt, width, height }]，用户取消返回 []。
 * 注意：这里只负责「拿到选中项」，落盘请再调 importImageNative。
 */
export async function pickImagesNative(limit = MANUAL_PICK_LIMIT) {
	if (!isNativeGallery()) return []
	try {
		const r = await GalleryScan.pickImages({ limit, includeExif: true })
		const list = (r && r.images) || []
		return list.map(x => ({
			name: x.name || '',
			uri: x.uri || '',
			path: x.path || '',
			takenAt: typeof x.takenAt === 'number' ? x.takenAt : 0,
			width: x.width || 0,
			height: x.height || 0,
			// v2.12：原生选图回调里顺带读出的 EXIF 坐标（授权会话内一定可读）
			exifLat: typeof x.exifLat === 'number' ? x.exifLat : null,
			exifLng: typeof x.exifLng === 'number' ? x.exifLng : null
		}))
	} catch (e) {
		return []
	}
}

/* ---------------- 浏览器演示：选择一个本地相册文件夹 ---------------- */

const FILE_KEY = 'el:browserGallery'

function supportsFsApi() {
	return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

export function browserGallerySupported() {
	return !isNativeGallery() && supportsFsApi()
}

export function browserGalleryName() {
	return uni.getStorageSync(FILE_KEY) || ''
}

/** 让用户选一个文件夹，把句柄存进内存（刷新后需重选，这是浏览器的限制） */
let dirHandle = null

export async function pickBrowserFolder() {
	if (!supportsFsApi()) return { ok: false, reason: 'unsupported' }
	try {
		dirHandle = await window.showDirectoryPicker({ mode: 'read' })
		uni.setStorageSync(FILE_KEY, dirHandle.name)
		return { ok: true, name: dirHandle.name }
	} catch (e) {
		return { ok: false, reason: 'cancel' }
	}
}

function parseNameTime(name) {
	// Screenshot_20261020-150405 / IMG_20261020_150405 / 20261020_150405
	const m = String(name).match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})[-_T ]?(\d{2})[-:_.]?(\d{2})[-:_.]?(\d{2})?/)
	if (!m) return null
	const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0, +m[6] || 0)
	const t = d.getTime()
	return isNaN(t) ? null : t
}

async function fileToBuf(file) {
	const ab = await file.arrayBuffer()
	return ab
}

/**
 * 浏览器端扫描：读取所选文件夹（含一级子目录）里的 jpg/png，
 * 用「文件名时间 > 内嵌 EXIF 时间」判定拍摄时刻。
 */
export async function scanBrowserFolder(from, to, limit = 200) {
	if (!dirHandle) return []
	const out = []
	const walk = async (dir, depth) => {
		for await (const entry of dir.values()) {
			if (out.length >= limit) return
			if (entry.kind === 'file') {
				const name = entry.name
				if (!/\.(jpe?g|png|webp)$/i.test(name)) continue
				const file = await entry.getFile()
				let takenAt = parseNameTime(name)
				let exif = null
				if (/\.jpe?g$/i.test(name)) {
					try {
						exif = parseExif(await fileToBuf(file))
					} catch (e) {
						exif = null
					}
				}
				if (exif && exif.takenAt) takenAt = exif.takenAt
				if (takenAt == null) takenAt = file.lastModified
				if (takenAt < from || takenAt >= to) continue
				out.push({
					id: name,
					path: URL.createObjectURL(file),
					name,
					takenAt,
					exifLat: exif ? exif.latitude : null,
					exifLng: exif ? exif.longitude : null
				})
			} else if (entry.kind === 'directory' && depth < 1) {
				await walk(entry, depth + 1)
			}
		}
	}
	try {
		await walk(dirHandle, 0)
	} catch (e) {
		return out
	}
	return out.sort((a, b) => a.takenAt - b.takenAt)
}
