// 导出：一天两版 —— txt（纯文本）+ PDF（杂志风、含图片）。
//  - 本地 APK 壳：txt 走 Filesystem 写公共 Documents；PDF 走原生 MagazinePdf（PdfDocument 排版）
//  - H5：txt 下载；PDF 打开杂志版式预览窗口，用浏览器「打印 → 另存为 PDF」
// 重新生成覆盖同一天文件。生成的文件通过系统分享面板发出。
import { pad } from './day.js'
import { isShell, writeDocText, shareFile } from './shell.js'
import { exportPdfNative, toAbsFilePath } from './gallery.js'
import { fmtDayCN } from './day.js'
import { dayWeatherText } from './weather.js'

function isApp() {
	// #ifdef APP-PLUS
	return true
	// #endif
	// #ifndef APP-PLUS
	return false
	// #endif
}

function requireNex() {
	try {
		const nex = uni.requireNativePlugin('nex-pdf')
		return nex && typeof nex.textToPdf === 'function' ? nex : null
	} catch (e) {
		return null
	}
}

function writeText(relPath, text) {
	return new Promise((resolve, reject) => {
		plus.io.resolveLocalFileSystemURL('_doc/', dir => {
			const parts = relPath.split('/')
			const name = parts.pop()
			const mkdir = (parent, rest) => {
				if (!rest.length) return doWrite(parent, name)
				parent.getDirectory(rest[0], { create: true }, sub => mkdir(sub, rest.slice(1)), reject)
			}
			mkdir(dir, parts)
		}, reject)

		function doWrite(dir, name) {
			dir.getFile(name, { create: true }, entry => {
				entry.createWriter(writer => {
					writer.onwrite = () => resolve('_doc/' + relPath)
					writer.onerror = reject
					writer.write(text)
				}, reject)
			}, reject)
		}
	})
}

function clockOf(ts) {
	if (!ts) return '--:--'
	const d = new Date(ts)
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function buildDiaryDoc(day, diaryText, photoPaths, dayData) {
	const lines = []
	lines.push(`牛马本纪 · ${day}`)
	lines.push('='.repeat(24))
	lines.push('')
	lines.push(diaryText)

	// 行程轨迹（按时间顺序的地标）
	const track = (dayData && dayData.track) || []
	const stops = []
	for (const t of track) {
		const key = t.place || '未知地点'
		const last = stops[stops.length - 1]
		if (last && last.place === key) {
			last.end = t.t
			continue
		}
		stops.push({ place: key, start: t.t, end: t.t, kind: t.kind })
	}
	if (stops.length) {
		lines.push('')
		lines.push('【当日行程】')
		stops.forEach((s, i) => {
			const span = s.end && s.end !== s.start ? `${s.start}–${s.end}` : s.start
			lines.push(`  ${i + 1}. ${span}  ${s.place}`)
		})
	}

	// 照片 / 截图及其含义
	const photos = (dayData && dayData.photos) || []
	if (photos.length) {
		lines.push('')
		lines.push('【图片记录】')
		photos.forEach(p => {
			const tag = p.kind === 'screenshot' ? '截图' : '照片'
			const spot = p.place ? ` @ ${p.place}` : ''
			lines.push(`  [${clockOf(p.takenAt)} ${tag}]${spot} ${p.meaning || ''}`.trimEnd())
		})
	}

	if (photoPaths && photoPaths.length) {
		lines.push('')
		lines.push(`嵌入日记的图片 ${photoPaths.length} 张，文件位置：`)
		photoPaths.forEach((p, i) => lines.push(`  [${i + 1}] ${p}`))
	}

	lines.push('')
	lines.push(`生成于 ${new Date().toLocaleString()}`)
	return lines.join('\n')
}

/**
 * 导出某天的日志：txt + 杂志风 PDF。
 * @returns {Promise<{filePath:string, fileKind:'pdf'|'txt', pdfPath:string}>}
 */
export async function exportLog(day, diaryText, photoPaths = [], dayData = null, nodes = []) {
	const doc = buildDiaryDoc(day, diaryText, photoPaths, dayData)

	// 本地 APK 壳：txt 写公共 Documents/牛马本纪/；PDF 由原生排版（含图片）
	if (isShell()) {
		const uri = await writeDocText(`牛马本纪/${day}.txt`, doc)
		let pdfPath = ''
		try {
			const weather = await dayWeatherText(day, dayData)
			const r = await exportPdfNative(buildPdfArgs(day, diaryText, dayData, nodes, weather))
			pdfPath = r.fileUri || ''
		} catch (e) {
			console.warn('PDF 生成失败，当天只有 txt', e && e.message)
		}
		return { filePath: uri, fileKind: 'txt', pdfPath }
	}

	// H5 预览环境：txt 下载 + 杂志版式打印窗口（浏览器里可「另存为 PDF」）
	// #ifdef H5
	const blob = new Blob([doc], { type: 'text/plain;charset=utf-8' })
	const a = document.createElement('a')
	a.href = URL.createObjectURL(blob)
	a.download = `牛马本纪-${day}.txt`
	a.click()
	const weather = await dayWeatherText(day, dayData)
	openMagazinePrint(day, diaryText, dayData, weather)
	return { filePath: `牛马本纪-${day}.txt`, fileKind: 'txt', pdfPath: '' }
	// #endif

	// #ifndef H5
	return { filePath: '', fileKind: 'txt', pdfPath: '' }
	// #endif
}

/* ---------------- PDF 组装 ---------------- */

/**
 * 组装原生 PDF 参数（导出与「补生成 PDF」共用）。
 * @returns {{day,dateCN,diary,nodes:Array,photos:Array,weather:string,outName:string}}
 */
export function buildPdfArgs(day, diaryText, dayData, nodes, weather = '') {
	return {
		day,
		dateCN: fmtDayCN(day),
		diary: String(diaryText || ''),
		nodes: (Array.isArray(nodes) ? nodes : []).map(n => ({
			time: String((n && n.time) || ''),
			place: String((n && n.place) || ''),
			doing: String((n && n.doing) || '')
		})),
		photos: (() => {
			const out = []
			for (const p of (dayData && dayData.photos) || []) {
				if (p && p.renderable === false) continue
				// 优先相册原图（content://），原生端直接解码原图再按页宽缩放
				const src = (p && p.src) || ''
				const abs = toAbsFilePath(p && p.path)
				if (!src && !abs) continue
				out.push({
					src,
					path: abs,
					time: clockOf(p.takenAt),
					kind: p.kind === 'screenshot' ? '截图' : '照片',
					place: p.place || '',
					meaning: p.meaning || ''
				})
			}
			return out
		})(),
		weather: String(weather || ''),
		outName: `牛马本纪-${day}.pdf`
	}
}

/**
 * 查当天的天气简述（题头小字用）。查不到返回 ''，不阻塞导出。
 */
export async function withWeather(day, dayData) {
	return dayWeatherText(day, dayData)
}

// H5：杂志版式 → 浏览器打印（另存为 PDF）
function openMagazinePrint(day, diaryText, dayData, weather = '') {
	const photos = (dayData && dayData.photos) || []
	const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	// 日记按时段分段：每段一个 <p>，首行缩进 2 字
	const diaryHtml = String(diaryText || '')
		.replace(/\r\n/g, '\n')
		.split(/\n+/)
		.map(s => s.trim())
		.filter(Boolean)
		.map(s => `<p class="para">${esc(s)}</p>`)
		.join('')
	const figs = photos
		.filter(p => p && p.renderable !== false)
		.map(
			p => `<figure>
				<img src="${esc(p.path)}" />
				<figcaption><b>${clockOf(p.takenAt)} · ${p.kind === 'screenshot' ? '截图' : '照片'}${p.place ? ' · ' + esc(p.place) : ''}</b><br/>${esc(p.meaning)}</figcaption>
			</figure>`
		)
	// 每页 2 张：上下两个半版槽位，图文各自居中
	const pages = []
	for (let i = 0; i < figs.length; i += 2) pages.push(figs.slice(i, i + 2).join(''))
	const imgHtml = pages
		.map((g, i) => `<div class="photo-page${i === pages.length - 1 ? ' last' : ''}">${g}</div>`)
		.join('')
	const trackHtml = ((dayData && dayData.track) || [])
		.map(t => {
			const d = t.ts ? new Date(t.ts) : null
			const tm = d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''
			return tm ? `<li>${tm}　${esc(t.place || '')}</li>` : ''
		})
		.filter(Boolean)
		.join('')
	const w = window.open('', '_blank')
	if (!w) return
	w.document.write(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>牛马本纪 ${esc(day)}</title>
	<style>
		@page { margin: 18mm 16mm; }
		body { font-family: "Noto Serif SC","Songti SC",serif; color:#1f2937; max-width:640px; margin:0 auto; }
		.top-rule { border-bottom:1.6px solid #d8d2c2; margin-bottom:3px; }
		.top-rule2 { border-bottom:0.8px solid #e5e0d5; margin-bottom:22px; }
		.brand { text-align:center; font-size:11px; letter-spacing:4px; color:#b08b4f; font-family:sans-serif; }
		h1 { text-align:center; font-size:26px; margin:10px 0 4px; }
		.weather { text-align:center; font-size:11px; color:#9aa1ad; font-family:sans-serif; margin-bottom:6px; }
		.diary { font-size:14px; line-height:2; margin-bottom:8px; }
		.diary .para { text-indent:2em; margin:0 0 10px; }
		h2 { font-size:16px; border-left:4px solid #b08b4f; padding-left:10px; margin:36px 0 12px; font-family:sans-serif; }
		ol.track { font-size:13px; line-height:1.9; color:#374151; }
		figure { margin:22px 0; page-break-inside:avoid; }
		figure img { width:100%; border-radius:4px; }
		figcaption { font-size:11px; color:#6b7280; margin-top:6px; line-height:1.6; font-family:sans-serif; }
		/* 图片页：每页上下两个半版，各放一个图文块 */
		.photo-page { page-break-after: always; height: 240mm; display: flex; flex-direction: column; }
		.photo-page.last { page-break-after: auto; }
		.photo-page figure { flex: 1 1 0; min-height: 0; margin: 0; display: flex; align-items: center; gap: 14px; page-break-inside: avoid; }
		.photo-page figure + figure { border-top: 1px solid #e5e0d5; }
		.photo-page figure img { width: 52%; max-height: 100%; object-fit: contain; border-radius: 4px; }
		.photo-page figcaption { width: 48%; margin-top: 0; }
	</style></head><body>
	<div class="top-rule"></div>
	<div class="top-rule2"></div>
	<div class="brand">NIU MA BEN JI · 牛马本纪</div>
	<h1>${esc(fmtDayCN(day))}</h1>
	${weather ? `<div class="weather">${esc(weather)}</div>` : ''}
	<div class="diary">${diaryHtml}</div>
	${trackHtml ? `<h2>当日行程</h2><ol class="track">${trackHtml}</ol>` : ''}
	${imgHtml ? `<h2>图片里的今天</h2>${imgHtml}` : ''}
	</body></html>`)
	w.document.close()
	setTimeout(() => {
		try { w.focus(); w.print() } catch (e) {}
	}, 900)
}

export function openFile(path, title = '牛马本纪 日志') {
	// 本地 APK 壳：用系统分享面板打开/发送文件（微信、网盘、邮件等都能接）
	if (isShell()) {
		shareFile(path, title).catch(() => {})
		return true
	}
	if (isApp()) {
		plus.runtime.openFile(path)
		return true
	}
	return false
}
