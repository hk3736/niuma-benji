// 本地数据层：按天存取，key = 'el:day:YYYY-MM-DD'
// 说明：MVP 用 uni storage（App 端落盘、H5 端 localStorage），接口保持稳定，
// 后续要换 plus.sqlite 只改这一个文件即可。
const IDX = 'el:index'

export function loadDay(day) {
	const d = uni.getStorageSync('el:day:' + day)
	if (d && typeof d === 'object') return d
	return null
}

export function saveDay(data) {
	uni.setStorageSync('el:day:' + data.day, data)
	const idx = listDays()
	if (!idx.includes(data.day)) {
		idx.unshift(data.day)
		idx.sort((a, b) => (a < b ? 1 : -1)) // 新的在前
		uni.setStorageSync(IDX, idx)
	}
}

export function listDays() {
	return uni.getStorageSync(IDX) || []
}

export function removeDay(day) {
	uni.removeStorageSync('el:day:' + day)
	uni.setStorageSync(IDX, listDays().filter(d => d !== day))
}

// 开发模式示例数据：只写一次，明确标注“示例”，长按即可删除
export function seedDemo() {
	if (uni.getStorageSync('el:demo-seeded')) return
	uni.setStorageSync('el:demo-seeded', true)

	const d = new Date(Date.now() - 24 * 3600 * 1000)
	const p = n => String(n).padStart(2, '0')
	const yesterday = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`

	const mk = (hour, lat, lng, place, meaning, tail) => {
		const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 12, 0).getTime()
		return {
			path: '/static/logo.png',
			takenAt: t,
			slotHour: hour,
			slot: 'photo',
			latitude: lat,
			longitude: lng,
			place,
			meaning,
			tail: tail || false
		}
	}

	saveDay({
		day: yesterday,
		checkins: [],
		photos: [
			mk(9, 31.2304, 121.4737, '人民广场 · 上海', '会议室白板上写满了排期，蓝笔圈出了三个截止日'),
			mk(12, 31.2304, 121.4737, '人民广场 · 上海', '便利店饭团配关东煮，桌角压着没看完的报表'),
			mk(15, 31.2245, 121.4692, '新天地 · 上海', '街角咖啡店的拉花歪了，窗外在下小雨'),
			mk(18, 31.2245, 121.4692, '新天地 · 上海', '天色暗下来，地铁口的灯亮成一排')
		],
		track: [
			{ ts: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 12).getTime(), place: '人民广场 · 上海', latitude: 31.2304, longitude: 121.4737 },
			{ ts: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 15, 12).getTime(), place: '新天地 · 上海', latitude: 31.2245, longitude: 121.4692 }
		],
		slots: { 9: 'p', 12: 'p', 15: 'p', 18: 'p' },
		segments: { morning: '', noon: '', afternoon: '', evening: '' },
		log: {
			text:
				'一上午都耗在会议里，好在把乱糟糟的排期捋顺了。下午出门透口气，街角那家店的咖啡还是熟悉的味道。傍晚回到家，日程表安静地躺在桌上，今天算是有交代的一天。',
			photoPaths: ['/static/logo.png'],
			filePath: '',
			fileKind: 'txt',
			generatedAt: Date.now() - 3600e3
		}
	})
}
