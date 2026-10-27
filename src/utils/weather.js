// 当天天气（PDF 题头用）：Open-Meteo 免费无 Key，按坐标查指定日期。
// 坐标来源：当天照片/轨迹里第一个真实定位。拿不到坐标或请求失败都返回 ''，
// PDF 里就不显示天气行，不影响生成。
import { CapacitorHttp } from '@capacitor/core'
import { isShell } from './shell.js'

// WMO weather code → 中文简述
const CODE_DESC = {
	0: '晴', 1: '晴', 2: '多云', 3: '阴',
	45: '雾', 48: '雾',
	51: '毛毛雨', 53: '毛毛雨', 55: '毛毛雨',
	56: '冻雨', 57: '冻雨',
	61: '小雨', 63: '中雨', 65: '大雨',
	66: '冻雨', 67: '冻雨',
	71: '小雪', 73: '中雪', 75: '大雪', 77: '雪',
	80: '阵雨', 81: '阵雨', 82: '强阵雨',
	85: '阵雪', 86: '阵雪',
	95: '雷阵雨', 96: '雷阵雨', 99: '雷阵雨'
}

function httpGetJson(url) {
	if (isShell()) {
		// 原生壳走 CapacitorHttp，绕开 WebView CORS
		return CapacitorHttp.get({ url, connectTimeout: 15000, readTimeout: 15000 }).then(res => {
			if (res.status >= 200 && res.status < 300) {
				return typeof res.data === 'string' ? JSON.parse(res.data) : res.data
			}
			throw new Error('HTTP ' + res.status)
		})
	}
	return new Promise((resolve, reject) => {
		uni.request({
			url,
			method: 'GET',
			timeout: 15000,
			success: r => (r.statusCode >= 200 && r.statusCode < 300 ? resolve(r.data) : reject(new Error('HTTP ' + r.statusCode))),
			fail: e => reject(new Error(e.errMsg || '请求失败'))
		})
	})
}

/**
 * 取某天的天气简述，如「多云 · 14~23℃」。
 * @param {string} day 'yyyy-MM-dd'
 * @param {object|null} dayData 当天数据（从照片/轨迹里找坐标）
 * @returns {Promise<string>} 失败返回 ''
 */
export async function dayWeatherText(day, dayData) {
	try {
		if (!day || !dayData) return ''
		let lat = null
		let lng = null
		for (const p of dayData.photos || []) {
			if (p && typeof p.latitude === 'number' && typeof p.longitude === 'number' && !(p.latitude === 0 && p.longitude === 0)) {
				lat = p.latitude
				lng = p.longitude
				break
			}
		}
		if (lat == null) {
			for (const t of dayData.track || []) {
				if (t && typeof t.latitude === 'number' && typeof t.longitude === 'number') {
					lat = t.latitude
					lng = t.longitude
					break
				}
			}
		}
		if (lat == null) return ''
		const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
			`&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${day}&end_date=${day}`
		const data = await httpGetJson(url)
		const d = data && data.daily
		if (!d || !Array.isArray(d.time) || !d.time.includes(day)) return ''
		const i = d.time.indexOf(day)
		const desc = (d.weather_code && CODE_DESC[d.weather_code[i]]) || ''
		const tmax = Math.round(d.temperature_2m_max[i])
		const tmin = Math.round(d.temperature_2m_min[i])
		if (!desc && isNaN(tmax)) return ''
		return `${desc ? desc + ' · ' : ''}${isNaN(tmin) ? '' : tmin + '~'}${isNaN(tmax) ? '' : tmax + '℃'}`
	} catch (e) {
		return ''
	}
}
