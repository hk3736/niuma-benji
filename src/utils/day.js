// 日期与采集时间点工具
export const SEGMENTS = [
	{ key: 'morning', label: '上午', hint: '醒来后到中午前' },
	{ key: 'noon', label: '中午', hint: '午饭前后' },
	{ key: 'afternoon', label: '下午', hint: '午后到傍晚' },
	{ key: 'evening', label: '晚上', hint: '晚饭后到睡前' }
]

// 文档确认的 5 个采集时间点（24 小时制）
export const DEFAULT_SLOTS = [1, 6, 10, 15, 19]

export function pad(n) {
	return String(n).padStart(2, '0')
}

export function dayKey(d = new Date()) {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fmtTime(ts) {
	const d = new Date(ts)
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtDayCN(day) {
	// '2026-10-18' -> '10月18日 周日'
	const d = new Date(day + 'T00:00:00')
	const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
	return `${d.getMonth() + 1}月${d.getDate()}日 ${week}`
}

export function slotLabel(hour) {
	if (hour < 6) return '凌晨'
	if (hour < 11) return '上午'
	if (hour < 14) return '中午'
	if (hour < 18) return '下午'
	return '晚上'
}

// 新一天的空白数据结构
export function emptyDay(day) {
	return {
		day,
		checkins: [],   // [{ ts, latitude, longitude, slot: '上午' }]
		photos: [],     // [{ path, takenAt }]
		segments: { morning: '', noon: '', afternoon: '', evening: '' },
		log: null       // { text, photoPaths, filePath, fileKind, generatedAt }
	}
}
