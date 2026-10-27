// 定位采集：MVP 策略 = 打开 App 时把「已过时间点」一次性补采，
// 同一地点（位移 < 150m）不重复记录。后台定时定位需要原生服务，放到二期。
import { loadDay, saveDay } from './db.js'
import { DEFAULT_SLOTS, slotLabel, dayKey, pad } from './day.js'
import { isShell, currentPosition } from './shell.js'

export function getSlots() {
	const s = uni.getStorageSync('el:slots')
	return Array.isArray(s) && s.length ? s : DEFAULT_SLOTS
}

export function saveSlots(slots) {
	uni.setStorageSync('el:slots', [...slots].sort((a, b) => a - b))
}

function distMeters(a, b) {
	if (!a || !b) return Infinity
	const R = 6371000
	const rad = x => (x * Math.PI) / 180
	const dLat = rad(b.latitude - a.latitude)
	const dLng = rad(b.longitude - a.longitude)
	const s =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
	return 2 * R * Math.asin(Math.sqrt(s))
}

export function getLocationOnce() {
	// 本地 APK 壳：直接调系统定位（WGS84 自动转 GCJ02）
	if (isShell()) return currentPosition()
	return new Promise((resolve, reject) => {
		uni.getLocation({
			type: 'gcj02',
			success: resolve,
			fail: reject
		})
	})
}

function fmtCoord(v) {
	return typeof v === 'number' ? v.toFixed(5) : '?'
}

export function coordText(c) {
	if (!c) return '未采集'
	return `${fmtCoord(c.latitude)}, ${fmtCoord(c.longitude)}`
}

/**
 * 补采今天已过的时间点。
 * @returns {Promise<{added:number, last:object|null, skippedSameSpot:number}>}
 */
export async function collectDueSlots() {
	const day = dayKey()
	const now = new Date()
	const curHour = now.getHours() + now.getMinutes() / 60
	const data = loadDay(day) || { day, checkins: [], photos: [], segments: {}, log: null }
	const due = getSlots().filter(h => h <= curHour)
	const result = { added: 0, last: null, skippedSameSpot: 0 }

	for (const h of due) {
		// 槽位定义为 “小时整点前” 触发：h=10 表示 10:00 这个点
		const slotTs = new Date(`${day}T${pad(h)}:00:00`).getTime()
		if (data.checkins.some(c => c.slotHour === h)) continue

		try {
			const pos = await getLocationOnce()
			const prev = data.checkins[data.checkins.length - 1]
			if (prev && distMeters(prev, pos) < 150) {
				// 位置没变化：按文档要求不记录，只补一个“原地”标记，避免 UI 显示未采集
				data.checkins.push({
					ts: Date.now(), slotHour: h, slot: slotLabel(h),
					sameAsPrev: true, latitude: prev.latitude, longitude: prev.longitude
				})
				result.skippedSameSpot++
			} else {
				data.checkins.push({
					ts: Date.now(), slotHour: h, slot: slotLabel(h),
					latitude: pos.latitude, longitude: pos.longitude
				})
				result.added++
				result.last = pos
			}
			void slotTs
		} catch (e) {
			// 定位失败（未授权/室内）不中断其他槽位
			console.warn('定位失败', h, e)
		}
	}

	if (result.added || result.skippedSameSpot) saveDay(data)
	return result
}
