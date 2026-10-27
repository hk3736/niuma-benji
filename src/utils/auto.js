// 每日自动生成：设置开关 + 打开 App 时补生成「昨天」的日志。
// 流程：自动扫描相册 → 4 个时间点选图（含截图）→ 地标轨迹 → 读图 → 成文
// 说明：真正的后台定时需要 WorkManager（二期），当前是打开 App 时补；不插电、不常驻。
import { loadDay, saveDay } from './db.js'
import { dayKey } from './day.js'
import { generateDiary, getApiKey } from './llm.js'
import { exportLog } from './pdf.js'
import { DAY_SLOTS } from './slots.js'
import { syncDay } from './sync.js'
import { isNativeGallery, hasAccess } from './gallery.js'

const KEY = 'el:autogen'
const KEY_SCAN = 'el:autoscan'
let running = false

export function isAutoGenOn() {
	const v = uni.getStorageSync(KEY)
	if (v === '' || v === null || v === undefined) return true // 默认开启
	return !!v
}

export function setAutoGen(on) {
	uni.setStorageSync(KEY, !!on)
}

// 是否允许「自动扫描相册」（单独一个开关，权限敏感）
export function isAutoScanOn() {
	const v = uni.getStorageSync(KEY_SCAN)
	if (v === '' || v === null || v === undefined) return true
	return !!v
}

export function setAutoScan(on) {
	uni.setStorageSync(KEY_SCAN, !!on)
}

function shiftDay(day, delta) {
	const d = new Date(`${day}T12:00:00`)
	d.setDate(d.getDate() + delta)
	return dayKey(d)
}

/**
 * 检查最近几天里「没生成过日志」的日期，自动同步相册并补一篇。
 * @returns {Promise<string|null>} 生成成功的日期
 */
export async function autoGenerateRecent(daysBack = 3) {
	if (running) return null
	if (!isAutoGenOn()) return null
	if (!getApiKey()) return null
	if (!isAutoScanOn()) return null
	if (isNativeGallery()) {
		const acc = await hasAccess()
		if (!acc || !acc.granted) return null // 没授权就别纠缠，等用户手动点
	}

	running = true
	try {
		for (let i = 1; i <= daysBack; i++) {
			const day = shiftDay(dayKey(), -i)
			const d = loadDay(day)
			if (d && d.log) continue
			// 没同步过：先扫相册
			if (!d || !d.photos || !d.photos.length) {
				try {
					await syncDay(day, { understand: false })
				} catch (e) {
					continue // 这天没照片，看前一天
				}
			}
			const day2 = loadDay(day)
			if (!day2 || !day2.photos || !day2.photos.length) continue

			const { diary, photoPaths, nodes } = await generateDiary(day2, DAY_SLOTS)
			const file = await exportLog(day, diary, photoPaths, day2)
			day2.log = {
				text: diary,
				photoPaths,
				nodes,
				filePath: file.filePath,
				fileKind: file.fileKind,
				generatedAt: Date.now(),
				auto: true
			}
			saveDay(day2)
			return day
		}
		return null
	} catch (e) {
		console.warn('自动生成失败', e)
		return null
	} finally {
		running = false
	}
}
