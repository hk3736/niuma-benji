// 一天素材同步（本产品的主流程）：
//   1. 扫描相册当天全部图片（App 走 MediaStore，浏览器演示走所选文件夹）
//   2. 4 个时间点（09/12/15/18）各取「离该时刻最近」的一张：照片一组、截图一组
//   3. 读 EXIF 的原始拍摄时间与 GPS：时间纠正 takenAt 与归属整点；GPS → GCJ02 → 逆地理匹配最近的地标；截图没有 GPS 时借用同段最邻近照片的位置
//   3.5 相邻时间点补位：某整点的图都没有地址时，借用时间上最近的相邻整点的 EXIF 地址（扫描完成即可落位，不依赖 AI）
//   4. 每张入选图让视觉模型说一句话「它记录了什么」
//   5. 汇总成 { photos, track, slots } 写入当天数据
// 隐私：扫描与 EXIF 解析全在本机；只把入选的 4~8 张压缩图 + 文本发给你配置的模型。
import { loadDay, saveDay } from './db.js'
import { dayKey, fmtTime } from './day.js'
import { DAY_SLOTS, SLOT_WINDOW_MIN, dayStartTs, pickNearestPerSlot, looksLikeScreenshot } from './slots.js'
import { scanWindow, scanBrowserFolder, isNativeGallery, readExifChain, readSlotLocations } from './gallery.js'
import { reverseGeocode } from './geo.js'
import { toGcj02, distMeters } from './coord.js'
import { persistGalleryImage, galleryImageToDataUrl, isShell, currentPosition } from './shell.js'
import { parseExifDate } from './exif.js'
import { understandImage } from './llm.js'

// 同步窗口：今天截止到当前，历史日期取整天
export function windowFor(day) {
	const start = dayStartTs(day)
	const isToday = day === dayKey()
	const end = isToday ? Math.max(Date.now(), start + 3600e3) : start + 24 * 3600e3
	return { start, end }
}

function toItem(r) {
	const name = r.name || ''
	return {
		id: r.id,
		path: r.path,
		uri: r.uri || r.path,
		name,
		takenAt: r.takenAt,
		width: r.width || 0,
		height: r.height || 0,
		kind: looksLikeScreenshot(name) ? 'screenshot' : 'photo',
		exifLat: typeof r.exifLat === 'number' ? r.exifLat : null,
		exifLng: typeof r.exifLng === 'number' ? r.exifLng : null,
		latitude: null,
		longitude: null,
		place: '',
		meaning: ''
	}
}

/**
 * 只扫描 + 选点，不做网络请求（界面先给预览用）
 */
export async function scanDay(day, onStep) {
	const step = (m, p) => onStep && onStep(m, p)
	const { start, end } = windowFor(day)

	step('正在扫描相册…', 8)
	const raw = isNativeGallery()
		? await scanWindow(start, end, 400)
		: await scanBrowserFolder(start, end, 400)

	const all = raw
		.map(toItem)
		.filter(x => typeof x.takenAt === 'number' && x.takenAt > 0)
		.sort((a, b) => a.takenAt - b.takenAt)

	step(`扫到 ${all.length} 张，正在按 ${DAY_SLOTS.join('/')} 点挑选…`, 25)

	const photoPicks = pickNearestPerSlot(all.filter(x => x.kind === 'photo'), start, end)
	const shotPicks = pickNearestPerSlot(all.filter(x => x.kind === 'screenshot'), start, end)
	return { all, photoPicks, shotPicks, start, end }
}

// 读一张图的原始 EXIF（拍摄时间 + GPS，一次原生调用拿全）。
// 注意用**原始** sourceUri：落盘后的副本是重编码过的，已不带 EXIF。
// GPS：原始经纬度（WGS84，调用方再转 GCJ02）；takenAt：EXIF DateTimeOriginal 解析出的毫秒，可能为 null

async function readExifInfo(item) {
	if (!isNativeGallery()) {
		return item.exifLat != null && item.exifLng != null
			? { lat: item.exifLat, lng: item.exifLng, takenAt: null, dbg: 'scan' }
			: null
	}
	const target = item.sourceUri || item.uri || item.path
	// v2.8：native → JS 头部兜底，全程诊断（dbg 会写进照片记录显示在缩略图上）
	const { ex, dbg } = await readExifChain(target)
	if (!ex) return { lat: null, lng: null, takenAt: null, dbg }
	const out = { lat: null, lng: null, takenAt: null, dbg }
	if (typeof ex.latitude === 'number' && typeof ex.longitude === 'number' && !(ex.latitude === 0 && ex.longitude === 0)) {
		out.lat = ex.latitude
		out.lng = ex.longitude
	}
	const t = parseExifDate(ex.dateTime)
	if (t && t > 0) out.takenAt = t
	if (out.lat == null && out.takenAt == null) out.dbg = dbg + '|dead'
	return out
}

/**
 * 完整同步：扫描 → 选图 → 落盘 → 定位转地标 → 读图 → 写库
 *
 * 关键顺序：**先落盘再读图/读 EXIF**。
 *   content:// 在 WebView 里既渲染不了、fetch 也拿不到，
 *   所以第一步就用原生插件把它重编码进 files/photos/，之后全链路都用 file:// 地址。
 *
 * @param {string} day
 * @param {{onStep?:(m:string,p:number)=>void, understand?:boolean}} opts
 */
export async function syncDay(day, opts = {}) {
	const step = (m, p) => opts.onStep && opts.onStep(m, p)
	const doUnderstand = opts.understand !== false

	const { all, photoPicks, shotPicks, start, end } = await scanDay(day, step)

	// 候选点（去重后最多 8 张）
	const candidates = []
	const seen = new Set()
	const slots = []
	for (const [list, kind] of [[photoPicks, 'photo'], [shotPicks, 'screenshot']]) {
		for (const s of list) {
			if (s.future) {
				slots.push({ hour: s.hour, kind, state: 'future' })
				continue
			}
			if (!s.item) {
				slots.push({ hour: s.hour, kind, state: 'empty' })
				continue
			}
			const key = String(s.item.id)
			if (seen.has(key)) {
				slots.push({ hour: s.hour, kind, state: 'dup' })
				continue
			}
			seen.add(key)
			const item = { ...s.item, slotHour: s.hour }
			candidates.push(item)
			slots.push({ hour: s.hour, kind, state: 'ok', id: item.id, deltaMin: s.deltaMin })
		}
	}

	if (!candidates.length) {
		throw new Error(
			all.length
				? `${DAY_SLOTS.join('/')} 点前后 ${SLOT_WINDOW_MIN} 分钟内没有照片，换一天试试`
				: '这一天相册里没有照片'
		)
	}

	// 0) 先把图落进 App 私有目录，拿到 WebView 能用的地址（content:// 不可渲染）
	step('正在保存图片…', 30)
	let saved = 0
	for (const it of candidates) {
		it.sourceUri = it.uri || it.path
		if (isShell()) {
			const local = await persistGalleryImage(it.sourceUri)
			it.path = local
			it.renderable = !!local && local.indexOf('content://') !== 0
		} else {
			it.path = it.path || it.uri
			it.renderable = true
		}
		saved++
		step(`正在保存图片 ${saved}/${candidates.length}…`, 30 + Math.round((saved / candidates.length) * 12))
	}

	// 1) 读原始 EXIF（拍摄时间 + GPS）。先把有坐标的收集起来，截图才能借。
	//    EXIF 时间是权威时间：MediaStore 拿不到 DATE_TAKEN 时会退回「加入相册的时间」，
	//    转发/下载/截屏的图会错位到错误整点 —— 这里用 EXIF 时间纠正 takenAt，
	//    并把归属整点（slotHour）一并重算，后面的轨迹与点位就都落在正确的时间点上。
	step('正在读取照片的原始时间与位置…', 44)
	const refPool = []
	for (const it of candidates) {
		const ex = await readExifInfo(it)
		it.exifDbg = (ex && ex.dbg) || 'null'
		if (!ex) continue
		if (ex.takenAt && Math.abs(ex.takenAt - it.takenAt) > 60e3) {
			it.takenAt = ex.takenAt
			it.slotHour = nearestHour(it.takenAt)
		}
		if (ex.lat != null && ex.lng != null) {
			it.exifLat = ex.lat
			it.exifLng = ex.lng
			refPool.push({ takenAt: it.takenAt, latitude: ex.lat, longitude: ex.lng, kind: it.kind })
		}
	}

	// 2) 逐个定坐标 + 逆地理
	step('正在匹配最近的地标…', 52)
	let ai = 0
	for (const it of candidates) {
		let lat = it.exifLat
		let lng = it.exifLng
		let coordSource = 'exif'
		if (lat == null || lng == null) {
			// 借用时间上最近、且有坐标的一张（8 小时内算同一活动范围）
			let best = null
			let bestDelta = Infinity
			for (const r of refPool) {
				const d = Math.abs(r.takenAt - it.takenAt)
				if (d < bestDelta) {
					bestDelta = d
					best = r
				}
			}
			if (best && bestDelta < 8 * 3600 * 1000) {
				lat = best.latitude
				lng = best.longitude
				coordSource = 'nearby'
			} else {
				coordSource = 'none'
			}
		}
		if (lat != null && lng != null) {
			const g = toGcj02(lat, lng)
			it.latitude = g.latitude
			it.longitude = g.longitude
			it.coordSource = coordSource
			it.place = (await reverseGeocode(lat, lng)).label || ''
		} else {
			it.coordSource = 'none'
		}
		ai++
		step(`正在匹配地标 ${ai}/${candidates.length}…`, 52 + Math.round((ai / candidates.length) * 18))
	}

	// 2.1) 相邻时间点补位：某时间点的图都没有地址时，用「时间上离该整点最近的一张有地址照片」的位置。
	//      地址来自照片原始 EXIF GPS 的逆地理结果（扫描阶段就拿到，不依赖 AI 读图）。
	step('正在补齐相邻时间点的位置…', 68)
	const anchors = candidates
		.filter(it => it.kind !== 'checkin' && it.place && it.latitude != null)
		.sort((a, b) => a.takenAt - b.takenAt)
	for (const h of DAY_SLOTS) {
		const inSlot = candidates.filter(it => it.kind !== 'checkin' && it.slotHour === h)
		if (!inSlot.length || inSlot.some(it => it.place)) continue
		// 该整点的代表时刻 = 当天 h 点整；找时间上离它最近的、有地址的照片
		const rep = dayStartTs(day) + h * 3600e3
		let best = null
		let bestD = Infinity
		for (const a of anchors) {
			const d = Math.abs(a.takenAt - rep)
			if (d < bestD) {
				bestD = d
				best = a
			}
		}
		if (!best) continue
		for (const it of inSlot) {
			if (it.latitude == null) {
				it.latitude = best.latitude
				it.longitude = best.longitude
				it.place = best.place
				it.coordSource = 'nearby'
			}
		}
	}

	// 2.5) 全都没坐标时，用「当前定位」兜底 —— 只给当前时间点用，绝不覆盖 4 个整点
	if (!refPool.length && day === dayKey() && isShell()) {
		try {
			const here = await currentPosition()
			if (here && typeof here.latitude === 'number') {
				const curSlot = nearestHour(Date.now())
				const label = (await reverseGeocode(here.latitude, here.longitude)).label || '当前位置'
				for (const it of candidates) {
					// 只填「当前这个时间点」的图
					if (it.latitude == null && it.slotHour === curSlot) {
						it.latitude = here.latitude
						it.longitude = here.longitude
						it.place = label
						it.coordSource = 'gps'
					}
				}
			}
		} catch (e) {
			// 没有定位权限就保持空，不影响其他流程
		}
	}

	// 2.6) 并入原生后台在整点采集的位置（9/12/15/18 点各一条，彼此独立）
	//      只补「这个时间点还没有坐标」的空位，不覆盖照片自带的定位
	if (isShell()) {
		try {
			const slotsRec = await readSlotLocations(day)
			for (const rec of slotsRec) {
				const h = Number(rec.hour)
				if (!DAY_SLOTS.includes(h)) continue
				const inSlot = candidates.filter(c => c.slotHour === h)
				const hasCoord = inSlot.some(c => c.latitude != null)
				if (hasCoord) continue
				for (const it of inSlot) {
					if (it.latitude == null) {
						it.latitude = rec.latitude
						it.longitude = rec.longitude
						it.place = rec.place || ''
						it.coordSource = rec.place ? 'system' : 'gps'
					}
				}
				// 该时间点一张图都没有时，也记一条独立轨迹点
				if (!inSlot.length && rec.place) {
					const ts = rec.ts || dayStartTs(day) + h * 3600e3
					candidates.push({
						srcOnly: true,
						path: '',
						takenAt: ts,
						name: '整点定位',
						kind: 'checkin',
						place: rec.place,
						latitude: rec.latitude,
						longitude: rec.longitude,
						coordSource: 'system',
						meaning: '',
						renderable: false,
						slotHour: h
					})
				}
			}
		} catch (e) {
			// 读不到就跳过
		}
	}

	// 3) 读图（只对入选图，最多 8 次）——用已落盘的地址，保证能读到
	let done = 0
	for (const it of candidates) {
		if (doUnderstand && it.kind !== 'checkin') {
			try {
				const src = /^(https?|data|file|blob):/.test(it.path) || it.path.startsWith('/')
					? it.path
					: it.sourceUri
				const dataUrl = await galleryImageToDataUrl(src, 900, 0.55)
				it.meaning = await understandImage(dataUrl)
				// 图里有可判断位置的文字（店名/路牌）时，AI 会在句末带「 @地名」
				if (it.meaning && it.latitude == null) {
					const m = it.meaning.match(/@([^\s@。]{2,24})\s*$/)
					if (m) {
						it.place = m[1]
						it.coordSource = 'ai'
						it.meaning = it.meaning.replace(/@([^\s@。]{2,24})\s*$/, '').trim()
					}
				}
			} catch (e) {
				it.meaning = ''
			}
		}
		done++
		step(`正在读图 ${done}/${candidates.length}…`, 70 + Math.round((done / candidates.length) * 22))
	}

	// 4) 轨迹：按时间排，位移 < 150m 记为原地
	candidates.sort((a, b) => a.takenAt - b.takenAt)
	const track = []
	for (const it of candidates) {
		if (it.latitude == null) continue
		const prev = track[track.length - 1]
		const same = !!prev && distMeters(prev, it) < 150
		track.push({
			ts: it.takenAt,
			t: fmtTime(it.takenAt),
			latitude: it.latitude,
			longitude: it.longitude,
			place: same ? prev.place : it.place,
			sameAsPrev: same,
			kind: it.kind,
			slotHour: it.slotHour
		})
	}

	// 5) 点位汇总：每个时间点一条，带地点与照片数（界面直接用）
	const slotOf = (c, h) => c.slotHour === h && c.kind !== 'checkin'
	const slotSummary = DAY_SLOTS.map(h => {
		const here = candidates.filter(c => slotOf(c, h))
		const located = here.find(c => c.place) || {}
		const withCoord = here.find(c => c.latitude != null) || {}
		return {
			hour: h,
			count: here.length,
			photos: here.filter(c => c.kind !== 'screenshot').length,
			shots: here.filter(c => c.kind === 'screenshot').length,
			place: located.place || '',
			latitude: withCoord.latitude != null ? withCoord.latitude : null,
			longitude: withCoord.longitude != null ? withCoord.longitude : null
		}
	})

	// 6) 落库
	const d = loadDay(day) || {
		day,
		checkins: [],
		photos: [],
		segments: { morning: '', noon: '', afternoon: '', evening: '' },
		log: null
	}
	const brokenImgs = candidates.filter(it => it.renderable === false).length

	// v2.8：扫描前手工添加的图也补查一次位置（之前只靠添加时读取，可能失败）
	const manual = (d.photos || []).filter(p => p && p.manual)
	const manualFixed = []
	for (const p of manual) {
		if (p.latitude != null || !p.src) continue
		try {
			const { ex, dbg } = await readExifChain(p.src)
			p.exifDbg = 'm:' + dbg
			if (ex && typeof ex.latitude === 'number' && typeof ex.longitude === 'number' && !(ex.latitude === 0 && ex.longitude === 0)) {
				const g = toGcj02(ex.latitude, ex.longitude)
				p.latitude = g.latitude
				p.longitude = g.longitude
				p.coordSource = 'manual-exif'
				p.place = (await reverseGeocode(ex.latitude, ex.longitude)).label || p.place || ''
				manualFixed.push(p.name || '?')
			}
		} catch (e) {
			// 读不到就保持原样
		}
	}

	// 用户手动加过的图要留住：重新扫描只替换「自动挑的那批」（manual 已在上方取出）
	const auto = candidates
		.filter(it => it.kind !== 'checkin')
		.map(it => ({
			path: it.path,
			src: it.sourceUri || '',   // 相册原图地址（content://），提交 AI 与导出 PDF 用
			takenAt: it.takenAt,
			name: it.name,
			kind: it.kind,
			place: it.place || '',
			latitude: it.latitude,
			longitude: it.longitude,
			coordSource: it.coordSource,
			exifDbg: it.exifDbg || '',
			meaning: it.meaning || '',
			renderable: it.renderable !== false,
			slotHour: it.slotHour != null ? it.slotHour : nearestHour(it.takenAt)
		}))

	d.photos = [...auto, ...manual].sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0))

	// 手动图、自动图合算点位；「整点定位」独立轨迹点补进没有照片的空档
	if (manual.length || candidates.some(c => c.kind === 'checkin')) {
		d.slotSummary = DAY_SLOTS.map(h => {
			const here = d.photos.filter(p => p.slotHour === h)
			const located = here.find(p => p.place) || {}
			const withCoord = here.find(p => p.latitude != null) || {}
			// 照片没落位时，借同时间点的整点定位记录
			const sysRec = candidates.find(c => c.kind === 'checkin' && c.slotHour === h && c.place)
			return {
				hour: h,
				count: here.length,
				photos: here.filter(p => p.kind !== 'screenshot').length,
				shots: here.filter(p => p.kind === 'screenshot').length,
				place: located.place || (sysRec ? sysRec.place : ''),
				latitude: withCoord.latitude != null ? withCoord.latitude : (sysRec ? sysRec.latitude : null),
				longitude: withCoord.longitude != null ? withCoord.longitude : (sysRec ? sysRec.longitude : null)
			}
		})
		d.track = buildTrackFromPhotos(d.photos, candidates.filter(c => c.kind === 'checkin'))
	} else {
		d.track = track
		d.slotSummary = slotSummary
	}

	d.slots = slots
	d.scannedAt = Date.now()
	d.scannedCount = all.length
	d.brokenImages = brokenImgs
	d.manualAdded = manual.length > 0
	saveDay(d)

	step('完成', 100)
	return { photos: d.photos, track, slots, slotSummary, scanned: all.length, brokenImages: brokenImgs }
}

export function nearestHour(ts) {
	const d = new Date(ts)
	let best = DAY_SLOTS[0]
	let bestDelta = Infinity
	for (const h of DAY_SLOTS) {
		const delta = Math.abs(d.getHours() * 60 + d.getMinutes() - h * 60)
		if (delta < bestDelta) {
			bestDelta = delta
			best = h
		}
	}
	return best
}

/**
 * 按照片列表重算轨迹（手动加图、删图后调用）。
 * 规则与 syncDay 一致：按时间排，位移 < 150 米视为原地，地名沿用上一站。
 */
export function buildTrackFromPhotos(photos, checkins) {
	const list = (photos || [])
		.filter(p => p && p.latitude != null && p.longitude != null)
		.map(p => ({ ts: p.takenAt, place: p.place || '', latitude: p.latitude, longitude: p.longitude, kind: p.kind, slotHour: p.slotHour }))
	// 后台整点定位也作为独立轨迹点并入
	for (const c of checkins || []) {
		if (c && c.latitude != null) {
			list.push({ ts: c.takenAt, place: c.place || '', latitude: c.latitude, longitude: c.longitude, kind: 'checkin', slotHour: c.slotHour })
		}
	}
	list.sort((a, b) => (a.ts || 0) - (b.ts || 0))
	const track = []
	for (const p of list) {
		const prev = track[track.length - 1]
		const same = !!prev && distMeters(prev, p) < 150
		track.push({
			ts: p.ts,
			t: fmtTime(p.ts),
			latitude: p.latitude,
			longitude: p.longitude,
			place: same ? prev.place : p.place || '',
			sameAsPrev: same,
			kind: p.kind,
			slotHour: p.slotHour
		})
	}
	return track
}

/** 按照片列表重算 4 个点位的汇总（手动加图、删图后调用） */
export function buildSlotSummary(photos) {
	return DAY_SLOTS.map(h => {
		const here = (photos || []).filter(p => p && p.slotHour === h)
		const located = here.find(p => p.place) || {}
		const withCoord = here.find(p => p.latitude != null) || {}
		return {
			hour: h,
			count: here.length,
			photos: here.filter(p => p.kind !== 'screenshot').length,
			shots: here.filter(p => p.kind === 'screenshot').length,
			place: located.place || '',
			latitude: withCoord.latitude != null ? withCoord.latitude : null,
			longitude: withCoord.longitude != null ? withCoord.longitude : null
		}
	})
}
