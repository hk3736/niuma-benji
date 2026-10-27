// 逆地理编码：把坐标换成「最近的地标 / 商圈 / 街道名」，用于行程文案与地图卡片。
// 源的选择顺序（逐个降级）：
//   1. 高德 Web 服务 —— 有 key 时最准，能直接拿到 POI 名（"新天地"这种）
//   2. Photon（komoot 的 OSM 服务）—— 免 key，中文字段直接可用，限速宽松
//   3. OpenStreetMap Nominatim —— 免 key 但要求 ≤1 req/s 且 UA 可识别，作最后兜底
// 结果按 30 天缓存到本地（地名几乎不会变）；全部失败时降级成「31.230, 121.474 附近」。
import { toGcj02 } from './coord.js'

const CACHE_KEY = 'el:geo:cache:v2' // v2：切换成中文地址后，旧的英文缓存直接作废
const AMAP_KEY_STORE = 'el:amapkey'
const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse'
const PHOTON = 'https://photon.komoot.io/reverse'

let lastCall = 0
let queue = Promise.resolve()

function sleep(ms) {
	return new Promise(r => setTimeout(r, ms))
}

function loadCache() {
	const c = uni.getStorageSync(CACHE_KEY)
	return c && typeof c === 'object' ? c : {}
}

function saveCache(c) {
	uni.setStorageSync(CACHE_KEY, c)
}

// 坐标量化到 ~1km 网格做 key，避免每次请求都不同
function cacheKey(lat, lng) {
	return `${lat.toFixed(2)},${lng.toFixed(2)}`
}

export function getAmapKey() {
	return uni.getStorageSync(AMAP_KEY_STORE) || ''
}

export function setAmapKey(k) {
	uni.setStorageSync(AMAP_KEY_STORE, String(k || '').trim())
}

async function httpGet(url, timeout = 8000) {
	// #ifdef H5
	const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null
	const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : null
	try {
		const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctl ? ctl.signal : undefined })
		if (timer) clearTimeout(timer)
		if (!r.ok) throw new Error('HTTP ' + r.status)
		return await r.json()
	} catch (e) {
		if (timer) clearTimeout(timer)
		throw e
	}
	// #endif
	// #ifndef H5
	return new Promise((resolve, reject) => {
		uni.request({
			url,
			method: 'GET',
			timeout,
			header: { Accept: 'application/json' },
			success: res => {
				if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data)
				else reject(new Error('HTTP ' + res.statusCode))
			},
			fail: e => reject(new Error(e.errMsg || '网络失败'))
		})
	})
	// #endif
}

// Nominatim 逆地理：挑最有辨识度的一个名字（地标 > 商场 > 街道 > 区域）
function pickLabelFromNominatim(d) {
	if (!d) return ''
	const a = d.address || {}
	const name = d.name || ''
	const isPoi = ['building', 'shop', 'amenity', 'tourism', 'leisure', 'office', 'man_made'].includes(d.category)
	if (isPoi && name) return name
	return (
		a.tourism ||
		a.attraction ||
		a.mall ||
		a.retail ||
		a.shop ||
		a.amenity ||
		a.building ||
		a.leisure ||
		a.road ||
		a.suburb ||
		a.quarter ||
		a.neighbourhood ||
		a.city_district ||
		a.town ||
		a.city ||
		a.county ||
		''
	)
}

async function reverseNominatim(lat, lng) {
	const url =
		`${NOMINATIM}?format=jsonv2&lat=${lat}&lon=${lng}` +
		'&accept-language=zh-CN,zh&zoom=18&addressdetails=1'
	const d = await httpGet(url)
	return { label: pickLabelFromNominatim(d), raw: d && d.display_name, source: 'osm' }
}

// Photon：返回 OSM 要素，中文字段一般已经本地化（street/district/city/state）
// 一次取多个候选，然后按「具体建筑/店铺 > 街道 > 社区 > 区市」的优先级挑，
// 这样才不会永远是「某某路」——用户要的是「最近的地标建筑」。
const PHOTON_POI = new Set([
	'house', 'building', 'apartments', 'commercial', 'retail', 'school', 'university',
	'hospital', 'clinic', 'hotel', 'restaurant', 'cafe', 'bar', 'fast_food', 'bank',
	'supermarket', 'convenience', 'mall', 'department_store', 'station', 'bus_stop',
	'subway', 'park', 'cinema', 'theatre', 'museum', 'attraction', 'office', 'company',
	'government', 'square', 'locality'
])

// 有名字的「具体场所」权重最高；道路次之；行政区最末
function photonScore(p) {
	const typ = p.type || p.osm_value || ''
	const key = p.osm_key || ''
	const hasName = !!(p.name && p.name.length)
	if (!hasName) return 0
	if (key === 'building' || typ === 'house' || typ === 'building') return 100
	if (PHOTON_POI.has(typ)) return 90
	if (key === 'highway' || typ === 'street' || typ === 'road') return 60
	if (key === 'place') return 40
	if (typ === 'district' || typ === 'city' || typ === 'state' || typ === 'county') return 10
	return 30
}

function labelFromPhotonFeature(p) {
	const city = p.city || p.county || ''
	const state = p.state || ''
	const mid = p.district || p.locality || ''
	const head = p.name || p.street || mid
	if (!head) return ''
	const parts = [head]
	// 地名本身已经是「黄浦区」「上海市」这类行政区时不再重复
	if (mid && mid !== head && head !== city && head !== state) parts.push(mid)
	if (city && parts[parts.length - 1] !== city) parts.push(city)
	else if (!city && state && parts[parts.length - 1] !== state) parts.push(state)
	return parts.filter(Boolean).join(' · ')
}

async function reversePhoton(lat, lng) {
	const url = `${PHOTON}?lat=${lat}&lon=${lng}&limit=5&radius=0.3`
	const d = await httpGet(url)
	const feats = (d && d.features) || []
	let best = null
	let bestScore = -1
	let bestLabel = ''
	for (const f of feats) {
		const p = (f && f.properties) || {}
		const sc = photonScore(p)
		if (sc > bestScore) {
			const lb = labelFromPhotonFeature(p)
			if (lb) {
				bestScore = sc
				best = p
				bestLabel = lb
			}
		}
	}
	// 全部没有名字时，退回第一个要素的行政区组合
	if (!bestLabel && feats[0]) bestLabel = labelFromPhotonFeature(feats[0].properties || {})
	return {
		label: bestLabel,
		raw: best ? [best.name, best.street, best.district, best.city, best.state].filter(Boolean).join(', ') : '',
		source: 'photon'
	}
}

async function reverseAmap(lat, lng) {
	const key = getAmapKey()
	if (!key) return null
	// 高德要求 GCJ02 坐标
	const g = toGcj02(lat, lng)
	const url = `https://restapi.amap.com/v3/geocode/regeo?key=${key}&location=${g.longitude.toFixed(6)},${g.latitude.toFixed(6)}&extensions=base&radius=300`
	const d = await httpGet(url)
	if (!d || d.status !== '1') return null
	const re = d.regeocode || {}
	const pois = (re.pois || [])[0]
	return {
		label: (pois && pois.name) || (re.formatted_address || '').split(';')[0],
		raw: re.formatted_address,
		source: 'amap'
	}
}

/**
 * 单点逆地理（带缓存与串行限速）
 * @returns {Promise<{label:string, raw?:string, source:string, ok:boolean}>}
 */
export async function reverseGeocode(lat, lng) {
	if (typeof lat !== 'number' || typeof lng !== 'number') {
		return { label: '', source: 'none', ok: false }
	}
	const key = cacheKey(lat, lng)
	const cache = loadCache()
	if (cache[key] && Date.now() - cache[key].ts < 30 * 24 * 3600 * 1000) {
		return { ...cache[key].v, ok: true, cached: true }
	}

	queue = queue.then(async () => {
		const wait = 1200 - (Date.now() - lastCall)
		if (wait > 0) await sleep(wait)
		lastCall = Date.now()
	})
	await queue

	let result = null
	try {
		result = await reverseAmap(lat, lng)
	} catch (e) {
		result = null
	}
	// 没有高德 key 时优先 Nominatim（accept-language=zh-CN 能出中文地名），
	// Photon 只能出英文/本地语言名，作为最后兜底
	if (!result || !result.label) {
		try {
			result = await reverseNominatim(lat, lng)
		} catch (e) {
			result = null
		}
	}
	if (!result || !result.label) {
		try {
			result = await reversePhoton(lat, lng)
		} catch (e) {
			result = null
		}
	}

	if (!result || !result.label) {
		const fallback = { label: `${lat.toFixed(3)}, ${lng.toFixed(3)} 附近`, source: 'coord' }
		return { ...fallback, ok: false }
	}

	const c2 = loadCache()
	c2[key] = { v: result, ts: Date.now() }
	saveCache(c2)
	return { ...result, ok: true }
}

/**
 * 批量逆地理：给轨迹的每个停靠点标上地标名
 * @param {Array<{latitude:number, longitude:number}>} points
 * @param {(done:number,total:number)=>void} onProgress
 */
export async function reverseBatch(points, onProgress) {
	const out = []
	for (let i = 0; i < points.length; i++) {
		const p = points[i]
		const r = await reverseGeocode(p.latitude, p.longitude)
		out.push({ ...p, place: r.label, source: r.source })
		if (onProgress) onProgress(i + 1, points.length)
	}
	return out
}

