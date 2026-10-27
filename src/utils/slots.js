// 一天 4 个时间点：09 / 12 / 15 / 18
// 每个点位取「离该时刻最近」的一张照片（最多回看 90 分钟、前瞻 90 分钟，避免跨时段串味）
export const DAY_SLOTS = [9, 12, 15, 18]

// 每个点位最多回看/前瞻多少分钟
export const SLOT_WINDOW_MIN = 90

// 从 4 个点位里取某张照片最贴近的那个（给没有 EXIF 时间的照片按文件名日期推断用）
export function slotLabelFor(hour) {
	if (hour < 10) return '上午'
	if (hour < 13) return '中午'
	if (hour < 16) return '下午'
	return '傍晚'
}

export function slotTimeText(day, hour) {
	return `${day} ${String(hour).padStart(2, '0')}:00`
}

/**
 * 在候选照片中为每个时间点挑选最接近的一张。
 * @param {Array<{takenAt:number, name?:string, kind?:string}>} items
 * @param {number} dayStart 当天 00:00 的时间戳
 * @returns {Array<{hour:number, item:object|null, deltaMin:number|null}>}
 */
export function pickNearestPerSlot(items, dayStart, dayEnd) {
	const win = SLOT_WINDOW_MIN * 60 * 1000
	return DAY_SLOTS.map(hour => {
		// 今天还没到的点位直接跳过（点在未来，取“最近”会误取早上的图）
		if (typeof dayEnd === 'number' && dayStart + hour * 3600 * 1000 > dayEnd) {
			return { hour, item: null, deltaMin: null, future: true }
		}
		const target = dayStart + hour * 3600 * 1000
		let best = null
		let bestDelta = Infinity
		for (const it of items) {
			if (!it || typeof it.takenAt !== 'number') continue
			const d = Math.abs(it.takenAt - target)
			if (d > win) continue
			if (d < bestDelta) {
				// 同一距离时优先正片（非截图）
				if (best && d === bestDelta && best.kind === 'screenshot' && it.kind !== 'screenshot') continue
				best = it
				bestDelta = d
			}
		}
		return { hour, item: best, deltaMin: best ? Math.round(bestDelta / 60000) : null }
	})
}

/** 判断文件名像不像截图：Screenshot_20261020-150405 / 截屏_xxx / IMG_xxx 不算 */
export function looksLikeScreenshot(name = '') {
	const n = String(name).toLowerCase()
	if (!n) return false
	return (
		n.startsWith('screenshot') ||
		n.includes('screenshot_') ||
		n.startsWith('截屏') ||
		n.includes('截屏_') ||
		n.startsWith('屏幕截图') ||
		n.includes('screencap') ||
		(n.startsWith('pxl_') && n.includes('screenshot'))
	)
}

// 完整本地时间（毫秒）
export function dayStartTs(day) {
	const [y, m, d] = String(day).split('-').map(Number)
	return new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
}
