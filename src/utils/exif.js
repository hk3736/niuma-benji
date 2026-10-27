// 极简 EXIF 解析：只取「拍摄时间」与「GPS 经纬度」两件事。
// 用途：① App 端拿不到 Camera 插件返回的 EXIF 时兜底；② 单元测试里用同一套逻辑对齐 Java 实现。
// 只解析 JPEG（APP1/Segment 0xE1），其它格式返回 null，由调用方回退到文件时间。

const TAG_EXIF_IFD = 0x8769
const TAG_GPS_IFD = 0x8825
const TAG_DATETIME_ORIGINAL = 0x9003
const TAG_DATETIME = 0x0132
const TAG_GPS_LAT_REF = 0x0001
const TAG_GPS_LAT = 0x0002
const TAG_GPS_LNG_REF = 0x0003
const TAG_GPS_LNG = 0x0004

function readIfd(view, tiffStart, ifdOffset, little) {
	const out = {}
	const count = view.getUint16(tiffStart + ifdOffset, little)
	const base = tiffStart + ifdOffset + 2
	for (let i = 0; i < count; i++) {
		const entry = base + i * 12
		if (entry + 12 > view.byteLength) break
		const tag = view.getUint16(entry, little)
		const type = view.getUint16(entry + 2, little)
		const num = view.getUint32(entry + 4, little)
		out[tag] = { type, num, valueOffset: entry + 8 }
	}
	return out
}

function asciiAt(view, tiffStart, entry, little) {
	const size = entry.num
	const start = size <= 4 ? entry.valueOffset : tiffStart + view.getUint32(entry.valueOffset, little)
	if (start + size > view.byteLength) return ''
	let s = ''
	for (let i = 0; i < size; i++) s += String.fromCharCode(view.getUint8(start + i))
	return s.replace(/\0.*$/, '').trim()
}

// 3 个 rational（度/分/秒）→ 十进制度
function rational3At(view, tiffStart, entry, little) {
	const start = tiffStart + view.getUint32(entry.valueOffset, little)
	if (start + 24 > view.byteLength) return null
	const vals = []
	for (let i = 0; i < 3; i++) {
		const n = view.getUint32(start + i * 8, little)
		const d = view.getUint32(start + i * 8 + 4, little)
		vals.push(d === 0 ? 0 : n / d)
	}
	return vals[0] + vals[1] / 60 + vals[2] / 3600
}

/**
 * @param {ArrayBuffer} buf
 * @returns {{takenAt:number|null, latitude:number|null, longitude:number|null}|null}
 */
export function parseExif(buf) {
	try {
		const view = new DataView(buf)
		if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null // 不是 JPEG

		// 找 APP1(Exif)
		let pos = 2
		let tiffStart = -1
		while (pos + 4 < view.byteLength) {
			if (view.getUint8(pos) !== 0xff) break
			const marker = view.getUint8(pos + 1)
			const size = view.getUint16(pos + 2)
			if (marker === 0xe1) {
				const head = pos + 4
				const isExif =
					view.getUint8(head) === 0x45 && view.getUint8(head + 1) === 0x78 &&
					view.getUint8(head + 2) === 0x69 && view.getUint8(head + 3) === 0x66
				if (isExif) tiffStart = head + 6
				break
			}
			if (size < 2) break
			pos += 2 + size
		}
		if (tiffStart < 0 || tiffStart + 8 > view.byteLength) return null

		const b0 = view.getUint8(tiffStart)
		const b1 = view.getUint8(tiffStart + 1)
		const little = b0 === 0x49 && b1 === 0x49
		const ifd0Offset = view.getUint32(tiffStart + 4, little)
		const ifd0 = readIfd(view, tiffStart, ifd0Offset, little)

		let takenAt = null
		let latitude = null
		let longitude = null

		if (ifd0[TAG_DATETIME]) {
			const s = asciiAt(view, tiffStart, ifd0[TAG_DATETIME], little)
			const t = parseExifDate(s)
			if (t) takenAt = t
		}

		// IFD 指针是 LONG 类型，值直接内联在 entry 的 4 字节里（不能当偏移量去解引用）
		const readPointer = entry => (entry && entry.type === 4 && entry.num >= 1 ? view.getUint32(entry.valueOffset, little) : -1)

		const exifPtr = readPointer(ifd0[TAG_EXIF_IFD])
		if (exifPtr >= 0) {
			const exifIfd = readIfd(view, tiffStart, exifPtr, little)
			if (exifIfd[TAG_DATETIME_ORIGINAL]) {
				const t = parseExifDate(asciiAt(view, tiffStart, exifIfd[TAG_DATETIME_ORIGINAL], little))
				if (t) takenAt = t
			}
		}

		const gpsPtr = readPointer(ifd0[TAG_GPS_IFD])
		if (gpsPtr >= 0) {
			const gps = readIfd(view, tiffStart, gpsPtr, little)
			const latRef = gps[TAG_GPS_LAT_REF] ? asciiAt(view, tiffStart, gps[TAG_GPS_LAT_REF], little) : 'N'
			const lngRef = gps[TAG_GPS_LNG_REF] ? asciiAt(view, tiffStart, gps[TAG_GPS_LNG_REF], little) : 'E'
			if (gps[TAG_GPS_LAT] && gps[TAG_GPS_LNG]) {
				const la = rational3At(view, tiffStart, gps[TAG_GPS_LAT], little)
				const lo = rational3At(view, tiffStart, gps[TAG_GPS_LNG], little)
				if (la != null && lo != null && !(la === 0 && lo === 0)) {
					latitude = latRef.toUpperCase().startsWith('S') ? -la : la
					longitude = lngRef.toUpperCase().startsWith('W') ? -lo : lo
				}
			}
		}

		return { takenAt, latitude, longitude }
	} catch (e) {
		return null
	}
}

// "2026:10:20 15:04:05" → 时间戳（本地时区）
export function parseExifDate(s) {
	if (!s) return null
	const m = String(s).match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
	if (!m) return null
	const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
	const t = d.getTime()
	return isNaN(t) ? null : t
}

// v2.12：XMP 兜底解析 GPS（小米等机型 EXIF GPS 异常/为 0 时，坐标常写在 XMP 里）。
// 支持格式："39,54.5000N"（度,分+方向）/ "39,54,32.4" / "+39.9042"，
// 方向字母可内嵌在值末尾，也可能在独立的 GPSLatitudeRef/GPSLongitudeRef 属性里。
function xmpValToDeg(raw, ref) {
	let s = String(raw).trim()
	let sign = 1
	const tail = s.slice(-1).toUpperCase()
	if (tail === 'S' || tail === 'W') sign = -1
	if (tail === 'N' || tail === 'S' || tail === 'E' || tail === 'W') s = s.slice(0, -1).trim()
	if (ref) {
		const r = String(ref).trim().toUpperCase()
		if (r === 'S' || r === 'W') sign = -1
	}
	let deg = null
	if (/^[+-]?\d+(\.\d+)?$/.test(s)) {
		deg = parseFloat(s)
	} else {
		const parts = s.split(',').map(x => parseFloat(String(x).trim()))
		if (parts.length >= 1 && parts.every(x => !isNaN(x))) {
			deg = parts[0] + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600
		}
	}
	if (deg == null || isNaN(deg)) return null
	return sign * deg
}

/**
 * @param {ArrayBuffer} buf 图片头部字节（需包含 XMP 包，通常在前 256KB 内）
 * @returns {{latitude:number, longitude:number}|null}
 */
export function parseXmpGps(buf) {
	try {
		const bytes = new Uint8Array(buf)
		let s = ''
		const step = 8192
		for (let i = 0; i < bytes.length; i += step) {
			s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + step, bytes.length)))
		}
		if (s.indexOf('GPSLatitude') < 0 || s.indexOf('GPSLongitude') < 0) return null
		const attr = name => {
			const m = s.match(new RegExp(name + '\\s*=\\s*"([^"]*)"'))
			return m ? m[1] : ''
		}
		const laRaw = attr('GPSLatitude')
		const loRaw = attr('GPSLongitude')
		if (!laRaw || !loRaw) return null
		// GPSLongitude 的 Ref 要单独匹配，避免截到 LatitudeRef
		const laRef = (s.match(/GPSLatitudeRef\s*=\s*"([NS])"/) || [])[1] || ''
		const loRef = (s.match(/GPSLongitudeRef\s*=\s*"([EW])"/) || [])[1] || ''
		const la = xmpValToDeg(laRaw, laRef)
		const lo = xmpValToDeg(loRaw, loRef)
		if (la == null || lo == null || (la === 0 && lo === 0)) return null
		return { latitude: la, longitude: lo }
	} catch (e) {
		return null
	}
}
