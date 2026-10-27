<template>
	<view class="page">
		<!-- 日期头 -->
		<view class="hero">
			<view class="hero-nav">
				<view class="nav-btn" hover-class="nav-hover" @click="goPrev">‹ 前一天</view>
				<text class="hero-eyebrow">{{ dayEyebrow }}</text>
				<view v-if="!isToday" class="nav-btn" hover-class="nav-hover" @click="goNext">后一天 ›</view>
				<view v-else class="nav-btn nav-placeholder">后一天 ›</view>
			</view>
			<text class="hero-date">{{ dayCN }}</text>
			<view class="slots">
				<view v-for="h in slots" :key="h" class="slot" :class="slotClass(h)">
					<text class="slot-text">{{ h }}点</text>
				</view>
			</view>
			<text class="hero-hint">{{ heroHint }}</text>
		</view>

		<!-- 历史日期已生成：先给「直接看日志」入口 -->
		<view v-if="!isToday && hasLog" class="done-bar">
			<view class="done-left">
				<text class="done-title">这一天已经写过</text>
				<text class="done-sub">{{ logSummary }}</text>
			</view>
			<view class="done-actions">
				<view class="mini-btn ghost" hover-class="nav-hover" @click="doGenerate(true)">
					<text class="mini-text ghost-text">重新生成</text>
				</view>
				<view class="mini-btn solid" hover-class="nav-hover" @click="openLog">
					<text class="mini-text">直接看日志</text>
				</view>
			</view>
		</view>

		<!-- 相册同步 -->
		<view class="card">
			<view class="card-head">
				<text class="card-title">{{ isToday ? '今日素材' : '当日素材' }}</text>
				<text class="card-action" @click="doSync">{{ syncing ? '同步中…' : (data.scannedAt ? '重新扫描' : '扫描相册') }}</text>
			</view>

			<view v-if="syncMsg" class="progress-wrap">
				<view class="progress">
					<view class="progress-bar" :style="{ width: syncPct + '%' }"></view>
				</view>
				<text class="progress-text">{{ syncMsg }}</text>
			</view>

			<template v-if="data.photos && data.photos.length">
				<text class="sum">
					共 {{ data.photos.length }} 张（自动扫描 {{ data.scannedCount || 0 }} 张）
					· {{ photoCount }} 张照片 / {{ shotCount }} 张截图<text v-if="manualCount"> · {{ manualCount }} 张手动添加</text>
				</text>

				<!-- 4 个时间点：时间 + 地点 + 张数，一行一个点 -->
				<view class="slot-list">
					<view v-for="s in slotRows" :key="s.hour" class="slot-row">
						<view class="slot-clock-col">
							<text class="slot-clock">{{ s.hhmm }}</text>
							<text class="slot-cnt">{{ s.cntText }}</text>
						</view>
						<view class="slot-info">
							<text class="slot-place" :class="{ mute: !s.place }">{{ s.place || s.emptyText }}</text>
							<text v-if="s.sub" class="slot-sub">{{ s.sub }}</text>
						</view>
					</view>
				</view>

				<text v-if="data.brokenImages" class="warn">
					有 {{ data.brokenImages }} 张图未能存入本地（可能是系统限制），已跳过缩略图
				</text>

				<view class="groups">
					<view v-for="g in groups" :key="g.key" class="group">
						<text class="group-title">{{ g.title }}</text>
						<view v-if="g.items.length" class="thumbs">
							<view v-for="(p, i) in g.items" :key="p.path + i" class="thumb-wrap">
								<image
									v-if="p.renderable !== false"
									class="thumb"
									:src="p.path"
									mode="aspectFill"
									@click="previewPhoto(p.path)"
									@error="onThumbError(p)"
								/>
								<view v-else class="thumb thumb-broken">
									<text class="thumb-broken-text">读不到</text>
								</view>
								<text class="thumb-time">{{ clock(p.takenAt) }}</text>
								<text v-if="p.latitude != null" class="thumb-place">📍{{ p.place }} {{ coordText(p) }}</text>
								<text v-else-if="p.exifDbg" class="thumb-dbg">EXIF:{{ p.exifDbg }}</text>
								<text v-if="p.kind === 'screenshot'" class="thumb-badge">截图</text>
								<text v-if="p.manual" class="thumb-manual">手动</text>
								<view class="thumb-del" @click.stop="removeManual(p)">
									<text class="thumb-del-text">×</text>
								</view>
							</view>
						</view>
						<text v-else class="group-empty">这个时间点附近没有图</text>
						<!-- v2.9：每张照片一行的位置信息（完整不截断，替代缩略图上的小标签） -->
						<view v-if="g.items.length" class="place-lines">
							<view v-for="(p, i) in g.items" :key="'pl' + i" class="place-line">
								<text class="place-line-text" :class="{ dbg: p.latitude == null }">{{ photoLine(p) }}</text>
							</view>
						</view>
					</view>
				</view>
			</template>
			<text v-else-if="!syncing" class="hint">
				点右上角「扫描相册」，App 会自动从手机里挑出 {{ slots.join('/') }} 点前后 90 分钟内最近的照片
			</text>

			<!-- 手动添加：不受自动选图上限限制，点几次加几张 -->
			<view class="add-row">
				<view class="add-btn" hover-class="nav-hover" @click="addManualPhoto">
					<text class="add-text">＋ 从相册添加照片</text>
				</view>
			</view>
			<text class="hint">自动每天取 3~4 张（照片、截图各一组）；想多放几张就用这里手动加，添加进日志的张数在设置里调</text>
		</view>

		<!-- 行程轨迹 -->
		<view v-if="trackStops.length" class="card">
			<view class="card-head">
				<text class="card-title">今日行程</text>
				<text class="card-sub-right">{{ trackStops.length }} 站</text>
			</view>
			<view v-for="(s, i) in trackStops" :key="i" class="stop">
				<view class="stop-rail">
					<text class="stop-dot">●</text>
					<text v-if="i < trackStops.length - 1" class="stop-line"></text>
				</view>
				<view class="stop-body">
					<text class="stop-time">{{ s.span }}</text>
					<text class="stop-place">{{ s.place }}</text>
				</view>
			</view>
		</view>

		<!-- 图片含义 -->
		<view v-if="meaningList.length" class="card">
			<text class="card-title">图片里的今天</text>
			<view v-for="(p, i) in meaningList" :key="i" class="meaning-row">
				<image
					v-if="p.renderable !== false"
					class="meaning-thumb"
					:src="p.path"
					mode="aspectFill"
					@click="previewPhoto(p.path)"
					@error="onThumbError(p)"
				/>
				<view v-else class="meaning-thumb meaning-thumb-broken">
					<text class="thumb-broken-text">读不到</text>
				</view>
				<view class="meaning-text">
					<text class="meaning-time">{{ clock(p.takenAt) }}<text v-if="p.kind === 'screenshot'"> · 截图</text><text v-if="p.place"> · {{ p.place }}</text></text>
					<text class="meaning-body">{{ p.meaning || '（这张还没有读到内容）' }}</text>
				</view>
			</view>
		</view>

		<!-- 四段随手记 -->
		<view class="card">
			<text class="card-title">随手记（全部可空）</text>
			<view v-for="seg in SEGMENTS" :key="seg.key" class="seg">
				<text class="seg-label">{{ seg.label }}<text class="seg-hint"> · {{ seg.hint }}</text></text>
				<view class="seg-wrap">
					<textarea
						class="seg-input"
						v-model="data.segments[seg.key]"
						:maxlength="500"
						@focus="onSegFocus(seg.key)"
						@blur="onSegBlur(seg.key)"
						@input="onSegInput(seg.key, $event)"
					/>
					<!-- 自绘占位：聚焦或已有内容时立即隐藏，不依赖 uni 的值同步（输入法组词期间不回传值） -->
					<text v-if="segFocus !== seg.key && !data.segments[seg.key]" class="seg-ph">{{ seg.label }}发生了什么…（可空）</text>
				</view>
			</view>
		</view>

		<!-- 生成 / 重新生成 / 直接看日志 -->
		<view v-if="hasLog" class="gen-row">
			<view class="gen gen-ghost" hover-class="gen-hover" @click="doGenerate(true)">
				<text class="gen-text ghost-text">{{ generating ? '重新生成中…' : '重新生成（覆盖当天）' }}</text>
			</view>
			<view class="gen" hover-class="gen-hover" @click="openLog">
				<text class="gen-text">直接看日志</text>
			</view>
		</view>
		<view v-else class="gen" hover-class="gen-hover" @click="doGenerate(false)">
			<text class="gen-text">{{ generating ? '生成中…' : genLabel }}</text>
		</view>
		<text v-if="genMsg" class="hint center">{{ genMsg }}</text>

		<view class="footer-links">
			<text class="link" @click="goLogs">历史日志</text>
			<text class="sep">·</text>
			<text class="link" @click="goSettings">设置</text>
		</view>
	</view>
</template>

<script setup>
	import { ref, computed, watch, nextTick } from 'vue'
	import { onShow } from '@dcloudio/uni-app'
	import { SEGMENTS, dayKey, fmtDayCN, emptyDay, fmtTime, pad } from '@/utils/day.js'
	import { loadDay, saveDay } from '@/utils/db.js'
	import { DAY_SLOTS } from '@/utils/slots.js'
	import { syncDay, nearestHour, buildTrackFromPhotos, buildSlotSummary } from '@/utils/sync.js'
	import {
		isNativeGallery, hasAccess, requestAccess, browserGallerySupported, browserGalleryName,
		pickBrowserFolder, pickImagesNative, importImageNative
	} from '@/utils/gallery.js'
	import { parseExif } from '@/utils/exif.js'
	import { generateDiary } from '@/utils/llm.js'
	import { exportLog } from '@/utils/pdf.js'
	import { autoGenerateRecent } from '@/utils/auto.js'
	import { toGcj02 } from '@/utils/coord.js'
	import { reverseGeocode } from '@/utils/geo.js'
	import { isShell } from '@/utils/shell.js'

	const today = dayKey()
	const day = ref(today)
	const data = ref(emptyDay(today))
	const generating = ref(false)
	const genMsg = ref('')
	const syncing = ref(false)
	const syncMsg = ref('')
	const syncPct = ref(0)
	const importing = ref(false)
	const slots = DAY_SLOTS
	const folderName = ref(browserGalleryName())

	const isToday = computed(() => day.value === today)
	const hasLog = computed(() => !!(data.value && data.value.log && data.value.log.text))
	const dayCN = computed(() => fmtDayCN(day.value))
	const dayEyebrow = computed(() => (isToday.value ? '今天' : '回看'))

	const hello = computed(() => {
		const h = new Date().getHours()
		if (h < 6) return '凌晨好'
		if (h < 11) return '早上好'
		if (h < 14) return '中午好'
		if (h < 18) return '下午好'
		return '晚上好'
	})

	const genLabel = computed(() => (isToday.value ? '生成今日日志' : '生成这一天日志'))

	const logSummary = computed(() => {
		const l = data.value && data.value.log
		if (!l) return ''
		const n = (l.photoPaths || []).length
		return `${l.generatedAt ? fmtTime(l.generatedAt) + ' 生成' : ''}${n ? ` · 收入 ${n} 张图` : ''}`
	})

	const heroHint = computed(() => {
		const n = (data.value.photos || []).length
		const word = isToday.value ? '今天' : '这一天'
		if (!data.value.scannedAt) return `${word}还没扫过相册，点右上角扫描`
		return n ? `${word}共 ${n} 张图，含 ${shotCount.value} 张截图` : `${word}还没有素材`
	})

	const photoCount = computed(() => (data.value.photos || []).filter(p => p.kind !== 'screenshot').length)
	const shotCount = computed(() => (data.value.photos || []).filter(p => p.kind === 'screenshot').length)
	const manualCount = computed(() => (data.value.photos || []).filter(p => p.manual).length)

	// 4 个时间点分组展示（照片与截图各一组时按 slotHour 合并）
	const groups = computed(() => {
		const photos = data.value.photos || []
		return slots.map(h => {
			const items = photos.filter(p => p.slotHour === h)
			return { key: h, title: `${String(h).padStart(2, '0')}:00`, items }
		})
	})

	const meaningList = computed(() =>
		(data.value.photos || []).filter(p => p.meaning).slice(0, 12)
	)

	// 4 个点位的「时间 · 地点」行：优先用 sync 时算好的 slotSummary，
	// 老数据没有 slotSummary 时按 photos 现算，保证这一块永远有内容
	const slotRows = computed(() => {
		const photos = data.value.photos || []
		const summary = data.value.slotSummary || []
		return slots.map(h => {
			const s = summary.find(x => x.hour === h)
			const items = s ? [] : photos.filter(p => p.slotHour === h)
			const place = (s && s.place) || (items.find(p => p.place) || {}).place || ''
			const photoN = s ? s.photos : items.filter(p => p.kind !== 'screenshot').length
			const shotN = s ? s.shots : items.filter(p => p.kind === 'screenshot').length
			const count = s ? s.count : items.length
			const started = h * 3600e3 + new Date(day.value + 'T00:00:00').getTime() <= Date.now()
			let emptyText = '这个点还没有素材'
			if (!started) emptyText = '还没到这个时间'
			else if (count) emptyText = '这几张没有位置信息'
			const parts = []
			if (photoN) parts.push(`照片 ${photoN}`)
			if (shotN) parts.push(`截图 ${shotN}`)
			return {
				hour: h,
				hhmm: `${String(h).padStart(2, '0')}:00`,
				place,
				sub: parts.join(' · '),
				cntText: count ? `${count} 张` : '—',
				emptyText
			}
		})
	})

	// 缩略图加载失败（多半是旧数据留着的 content:// 地址）就地降级
	function onThumbError(p) {
		p.renderable = false
	}

	// 轨迹压缩成「站点」：同一个地标连续出现就合并成一段时间
	const trackStops = computed(() => {
		const track = data.value.track || []
		const stops = []
		for (const t of track) {
			if (!t.place) continue
			const last = stops[stops.length - 1]
			if (last && last.place === t.place) {
				last.end = t.t
				continue
			}
			stops.push({ place: t.place, start: t.t, end: t.t })
		}
		return stops.map(s => ({
			place: s.place,
			span: s.end !== s.start ? `${s.start}–${s.end}` : s.start
		}))
	})

	function slotClass(h) {
		const has = (data.value.photos || []).some(p => p.slotHour === h)
		if (has) return 'done'
		return h * 3600e3 + new Date(day.value + 'T00:00:00').getTime() < Date.now() ? 'past' : 'future'
	}

	function clock(ts) {
		return ts ? fmtTime(ts) : '--:--'
	}

	/* 调试用：位置标签里附上 GCJ02 经纬度（5 位小数），用于区分「没坐标」与「逆地理失败」 */
	function coordText(p) {
		return `${Number(p.latitude).toFixed(5)},${Number(p.longitude).toFixed(5)}`
	}

	// v2.9：每个整点下方每张照片一行的完整位置/诊断信息（不再受缩略图宽度截断）
	function photoLine(p) {
		const t = clock(p.takenAt)
		const tag = p.manual ? ' [手动]' : p.kind === 'screenshot' ? ' [截图]' : ''
		if (p.latitude != null) {
			return `${t}${tag} 📍${p.place || '(逆地理无结果)'} ${coordText(p)}`
		}
		if (p.exifDbg) return `${t}${tag} EXIF:${p.exifDbg}`
		return `${t}${tag} 无位置信息`
	}

	function shiftDay(key, delta) {
		const d = new Date(`${key}T12:00:00`)
		d.setDate(d.getDate() + delta)
		return dayKey(d)
	}

	function load() {
		const d = loadDay(day.value)
		data.value = d || emptyDay(day.value)
		if (!data.value.track) data.value.track = []
		if (!data.value.photos) data.value.photos = []
		if (!data.value.segments) data.value.segments = { morning: '', noon: '', afternoon: '', evening: '' }
		// 已有内容的输入框恢复成多行高度
		nextTick(() => { for (const s of SEGMENTS) growSeg(s.key, 60) })
	}

	// 输入超过一行时自动撑高输入框。
	// uni 的 auto-height 在中文输入法组词期间拿到的值是滞后的（v-model 同理），
	// 所以直接量 DOM：先置 height:auto 再取 scrollHeight，一行时 CSS 的 min-height 兜底
	function growSeg(key, delay = 0) {
		try {
			const idx = SEGMENTS.findIndex(s => s.key === key)
			setTimeout(() => {
				const els = document.querySelectorAll('.seg-wrap textarea')
				const el = els && els[idx]
				if (!el) return
				el.style.height = 'auto'
				el.style.height = Math.max(el.scrollHeight, 46) + 'px'
			}, delay)
		} catch (e) {
			// 非 H5 环境没有 DOM，交给原生 auto-height 行为
		}
	}

	// 输入格里的默认文字（示例数据）在用户点进去输入时自动清空
	const DEMO_SEG = /^（示例）[^。]*。?\s*/
	const segFocus = ref('')
	function onSegFocus(key) {
		segFocus.value = key
		growSeg(key)
		const v = data.value.segments[key]
		if (typeof v === 'string' && v.indexOf('（示例）') === 0) {
			data.value.segments[key] = ''
		}
	}
	// 关键修复：Android 中文输入法组合期间 uni 不向外回传值（v-model 滞后），
	// 失焦时直接从 DOM 读真实输入内容强制同步，否则换框后占位符会重新出现
	function onSegBlur(key) {
		if (segFocus.value === key) segFocus.value = ''
		growSeg(key)
		try {
			const idx = SEGMENTS.findIndex(s => s.key === key)
			const els = document.querySelectorAll('.seg-wrap textarea')
			const el = els && els[idx]
			let v = el ? String(el.value || '') : String(data.value.segments[key] || '')
			v = v.replace(DEMO_SEG, '')
			if (v !== data.value.segments[key]) {
				data.value.segments[key] = v
				saveDay(data.value)
			}
		} catch (e) {
			// 非 H5 环境拿不到 DOM，退回 v-model 已同步的值
		}
	}
	// 双保险：万一 focus 没触发，用户敲下的第一个字也会把示例文字从值里剥掉
	function onSegInput(key, e) {
		const v = String((e && e.detail && e.detail.value) || '')
		if (v.indexOf('（示例）') === 0) {
			data.value.segments[key] = v.replace(DEMO_SEG, '')
		}
		// 输入期间持续量高（组词期间 e.detail 可能滞后，growSeg 读的是 DOM 真实内容）
		growSeg(key)
	}

	function goPrev() {
		if (syncing.value || generating.value) return
		day.value = shiftDay(day.value, -1)
		genMsg.value = ''
		syncMsg.value = ''
		load()
	}

	function goNext() {
		if (isToday.value || syncing.value || generating.value) return
		day.value = shiftDay(day.value, 1)
		genMsg.value = ''
		syncMsg.value = ''
		load()
	}

	// 草稿防抖保存
	let saveTimer = null
	watch(
		() => ({ ...data.value.segments }),
		() => {
			if (saveTimer) clearTimeout(saveTimer)
			saveTimer = setTimeout(() => saveDay(data.value), 500)
		},
		{ deep: true }
	)

	async function ensurePermission() {
		if (!isNativeGallery()) {
			if (!browserGallerySupported()) {
				uni.showToast({ title: '当前浏览器不支持选文件夹，请用 Chrome/Edge', icon: 'none' })
				return false
			}
			const r = await pickBrowserFolder()
			if (!r.ok) {
				if (r.reason === 'unsupported') {
					uni.showToast({ title: '浏览器不支持文件夹选择', icon: 'none' })
				}
				return false
			}
			folderName.value = r.name
			return true
		}
		const acc = await hasAccess()
		if (acc && acc.granted) return true
		const r = await requestAccess()
		if (r && r.granted) return true
		uni.showModal({
			title: '需要相册权限',
			content: '牛马本纪 只在本机读取照片的时间、位置并挑出 4 个时间点的图，不上传相册。请在系统设置里允许「照片和视频」访问。',
			showCancel: false,
			confirmText: '知道了'
		})
		return false
	}

	async function doSync() {
		if (syncing.value) return
		const ok = await ensurePermission()
		if (!ok) return
		syncing.value = true
		syncMsg.value = '准备扫描…'
		syncPct.value = 0
		const target = day.value
		try {
			const r = await syncDay(target, {
				onStep: (m, p) => {
					syncMsg.value = m
					syncPct.value = p
				}
			})
			load()
			syncMsg.value = `完成：${r.photos.length} 张图，${r.track.length} 条轨迹`
			syncPct.value = 100
			setTimeout(() => {
				syncMsg.value = ''
			}, 2500)
		} catch (e) {
			syncMsg.value = ''
			uni.showModal({
				title: '扫描失败',
				content: e.message || e.errMsg || '未知错误',
				showCancel: false
			})
		} finally {
			syncing.value = false
		}
	}

	/* ---------------- 手动添加图片 ---------------- */

	function guessKind(name) {
		return /screen|截屏|屏幕截图|screencap/i.test(name || '') ? 'screenshot' : 'photo'
	}

	// 手动图落在哪个时间点：有拍摄时间就按最近的点位，否则按「现在」或最后一个点位
	function slotFor(ts) {
		if (typeof ts === 'number' && ts > 0) return nearestHour(ts)
		if (isToday.value) return nearestHour(Date.now())
		return slots[slots.length - 1]
	}

	async function addManualPhoto() {
		if (importing.value) return
		importing.value = true
		try {
			// 1) 拿到用户选的图：原生走系统相册选择器，浏览器走 file input
			let picked = []
			if (isNativeGallery()) {
				picked = await pickImagesNative(10)
			} else {
				picked = await pickFilesInBrowser(10)
			}
			if (!picked.length) return

			watchdogImport(0)
			const added = []
			for (let i = 0; i < picked.length; i++) {
				watchdogImport(i + 1, picked.length)
				const it = picked[i]
				try {
					let localPath = it.webPath || it.path
					let takenAt = it.takenAt || 0
					let lat = null
					let lng = null

					// 原生：导入私有目录 + 读 EXIF（时间与位置）
					if (isNativeGallery()) {
						const fileUri = await importImageNative({ uri: it.uri, path: it.path }, 1600, 85)
						if (!fileUri) continue
						localPath = fileUri
						let ex = await readExifOf(it)
						// v2.12：EXIF 链读不到时，用原生选图回调里带回来的坐标兜底
						if ((!ex || typeof ex.latitude !== 'number') && typeof it.exifLat === 'number' && typeof it.exifLng === 'number' && !(it.exifLat === 0 && it.exifLng === 0)) {
							ex = { latitude: it.exifLat, longitude: it.exifLng, takenAt: null }
						}
						if (ex) {
							if (ex.takenAt) takenAt = ex.takenAt
							if (typeof ex.latitude === 'number') {
								lat = ex.latitude
								lng = ex.longitude
							}
						}
					} else if (it.exif) {
						takenAt = typeof it.exif.takenAt === 'number' ? it.exif.takenAt : takenAt
						lat = it.exif.latitude
						lng = it.exif.longitude
					}

					// 转成界面可渲染的地址
					let renderPath = localPath
					if (isShell() && localPath.indexOf('file://') === 0) {
						const { Capacitor } = await import('@capacitor/core')
						renderPath = Capacitor.convertFileSrc(localPath)
					}

					const slotHour = slotFor(takenAt)
					let place = ''
					let coord = null
					if (typeof lat === 'number' && typeof lng === 'number' && !(lat === 0 && lng === 0)) {
						coord = toGcj02(lat, lng)
						try {
							place = (await reverseGeocode(lat, lng)).label || ''
						} catch (e) {
							place = ''
						}
					} else {
						// 借用同点位已有的地名
						const same = (data.value.photos || []).find(p => p.slotHour === slotHour && p.place)
						if (same) {
							place = same.place
							coord = { latitude: same.latitude, longitude: same.longitude }
						}
					}

					added.push({
						path: renderPath,
						src: (isNativeGallery() && (it.uri || it.path)) || '',   // 原图地址（content://），AI 与 PDF 用
						takenAt: takenAt || (isToday.value ? Date.now() : new Date(day.value + 'T' + pad(slotHour) + ':00:00').getTime()),
						name: it.name || '手动添加',
						kind: guessKind(it.name),
						place,
						latitude: coord ? coord.latitude : null,
						longitude: coord ? coord.longitude : null,
						coordSource: coord ? 'manual' : 'none',
						meaning: '',
						renderable: true,
						manual: true,
						slotHour
					})
				} catch (e) {
					console.warn('添加图片失败', e)
				}
			}

			if (!added.length) {
				uni.showToast({ title: '没有添加成功', icon: 'none' })
				return
			}

			// 2) 并入当天数据（同时间点、按拍摄时间排）
			const d = data.value
			d.photos = [...(d.photos || []), ...added].sort((a, b) => (a.takenAt || 0) - (b.takenAt || 0))
			d.manualAdded = true
			// slotSummary 有手动图后按照片重算，保证点位行张数正确
			d.slotSummary = buildSlotSummary(d.photos)
			d.track = buildTrackFromPhotos(d.photos)
			saveDay(d)
			load()
			uni.showToast({ title: `已添加 ${added.length} 张`, icon: 'none' })
		} finally {
			importing.value = false
		}
	}

	// 给用户一个百分比/进度提示（原生选图是异步的，长图会慢）
	function watchdogImport(done, total) {
		if (!total) {
			importing.value = true
			uni.showLoading({ title: '正在读取…', mask: true })
			return
		}
		uni.showLoading({ title: `${done}/${total}`, mask: true })
		// 最后一张由 finally 关闭
		if (done === total) setTimeout(() => uni.hideLoading(), 300)
	}

	async function readExifOf(it) {
		try {
			const { readExifChain } = await import('@/utils/gallery.js')
			// v2.8：手工图也走 native → JS 头部兜底链，与自动扫描一致
			const { ex } = await readExifChain(it.uri || it.path)
			if (!ex) return null
			const out = {}
			if (ex.latitude != null) {
				out.latitude = ex.latitude
				out.longitude = ex.longitude
			}
			if (ex.dateTime) {
				const m = String(ex.dateTime).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
				if (m) out.takenAt = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
			}
			return out
		} catch (e) {
			return null
		}
	}

	// 浏览器端：input[type=file] 多选，读内嵌 EXIF
	function pickFilesInBrowser(max = 10) {
		return new Promise(resolve => {
			const input = document.createElement('input')
			input.type = 'file'
			input.accept = 'image/*'
			input.multiple = true
			input.onchange = async () => {
				const files = Array.from(input.files || []).slice(0, max)
				const out = []
				for (const f of files) {
					let exif = null
					if (/\.jpe?g$/i.test(f.name)) {
						try {
							exif = parseExif(await f.arrayBuffer())
						} catch (e) {
							exif = null
						}
					}
					out.push({ name: f.name, path: URL.createObjectURL(f), exif })
				}
				resolve(out)
			}
			input.oncancel = () => resolve([])
			input.click()
		})
	}

	function removeManual(p) {
		uni.showModal({
			title: '移除这张图',
			content: '只从这天的素材里移除，不会删手机相册里的原图。',
			success: r => {
				if (!r.confirm) return
				const d = data.value
				d.photos = (d.photos || []).filter(x => x !== p)
				d.slotSummary = buildSlotSummary(d.photos)
				d.track = buildTrackFromPhotos(d.photos)
				saveDay(d)
				load()
			}
		})
	}

	/* ---------------- 生成 ---------------- */

	function previewPhoto(path) {
		uni.previewImage({
			urls: (data.value.photos || []).map(p => p.path),
			current: path
		})
	}

	function openLog() {
		uni.navigateTo({ url: `/pages/preview/preview?day=${day.value}` })
	}

	async function doGenerate(isRegen) {
		if (generating.value) return
		if (!(data.value.photos || []).length) {
			uni.showToast({ title: '先扫描相册或手动添加图片', icon: 'none' })
			return
		}
		if (isRegen && hasLog.value) {
			const ok = await new Promise(res => {
				uni.showModal({
					title: '重新生成',
					content: `${fmtDayCN(day.value)} 已有日志，重新生成会覆盖这一天（含导出文件）。`,
					confirmText: '覆盖',
					confirmColor: '#e5484d',
					success: r => res(!!r.confirm),
					fail: () => res(false)
				})
			})
			if (!ok) return
		}
		generating.value = true
		genMsg.value = '正在读图并成文（一次调用完成选片、行程与散文）…'
		const target = day.value
		saveDay(data.value)
		try {
			const { diary, photoPaths, nodes } = await generateDiary(data.value, slots)
			genMsg.value = '日记已生成，正在导出 txt 与 PDF…'
			const file = await exportLog(target, diary, photoPaths, data.value, nodes)
			data.value.log = {
				text: diary,
				photoPaths,
				nodes,
				filePath: file.filePath,
				fileKind: file.fileKind,
				pdfPath: file.pdfPath || '',
				generatedAt: Date.now()
			}
			saveDay(data.value)
			genMsg.value = ''
			uni.navigateTo({ url: `/pages/preview/preview?day=${target}` })
		} catch (e) {
			genMsg.value = '生成失败：' + (e.message || e.errMsg || '未知错误')
		} finally {
			generating.value = false
		}
	}

	function goLogs() {
		uni.navigateTo({ url: '/pages/logs/logs' })
	}
	function goSettings() {
		uni.navigateTo({ url: '/pages/settings/settings' })
	}

	let autoTried = false

	onShow(() => {
		load()
		if (!autoTried) {
			autoTried = true
			setTimeout(checkAutoGenerate, 1200)
		}
	})

	async function checkAutoGenerate() {
		const done = await autoGenerateRecent(3)
		if (done) {
			load()
			uni.showToast({ title: `已自动生成 ${done} 的日志`, icon: 'none' })
		}
	}
</script>

<style>
	.page {
		min-height: 100vh;
		padding: 28rpx 28rpx 60rpx;
		box-sizing: border-box;
		background-color: #f4f6f9;
	}

	.hero {
		position: relative;
		overflow: hidden;
		padding: 40rpx 36rpx;
		border-radius: 28rpx;
		background-image: linear-gradient(135deg, #2b7fff 0%, #6ea8ff 100%);
		box-shadow: 0 16rpx 36rpx rgba(43, 127, 255, 0.22);
	}

	.hero-eyebrow {
		display: block;
		margin-bottom: 10rpx;
		font-size: 22rpx;
		letter-spacing: 2rpx;
		color: rgba(255, 255, 255, 0.8);
	}

	/* 日期切换 */
	.hero-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8rpx;
	}

	.hero-nav .hero-eyebrow {
		margin-bottom: 0;
	}

	.nav-btn {
		padding: 6rpx 18rpx;
		border-radius: 999rpx;
		font-size: 22rpx;
		color: #ffffff;
		background-color: rgba(255, 255, 255, 0.18);
	}

	.nav-hover {
		opacity: 0.7;
	}

	.nav-placeholder {
		opacity: 0.3;
	}

	/* 已生成提示条 */
	.done-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 22rpx;
		padding: 22rpx 26rpx;
		border-radius: 22rpx;
		background-color: #eef6ef;
		border: 1rpx solid #d6ebd8;
	}

	.done-left {
		flex: 1;
		min-width: 0;
	}

	.done-title {
		display: block;
		font-size: 25rpx;
		font-weight: 600;
		color: #2f7d47;
	}

	.done-sub {
		display: block;
		margin-top: 4rpx;
		font-size: 20rpx;
		color: #6d9c7d;
	}

	.done-actions {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.mini-btn {
		margin-left: 12rpx;
		padding: 12rpx 18rpx;
		border-radius: 999rpx;
	}

	.mini-btn.ghost {
		border: 1rpx solid #7fb48e;
	}

	.mini-btn.solid {
		background-color: #2f7d47;
	}

	.mini-text {
		font-size: 21rpx;
		color: #ffffff;
	}

	.mini-text.ghost-text {
		color: #2f7d47;
	}

	.hero-date {
		font-size: 46rpx;
		font-weight: 600;
		letter-spacing: 1rpx;
		color: #ffffff;
	}

	.slots {
		display: flex;
		margin-top: 24rpx;
	}

	.slot {
		margin-right: 14rpx;
		padding: 8rpx 22rpx;
		border-radius: 999rpx;
		background-color: rgba(255, 255, 255, 0.2);
	}

	.slot-text {
		font-size: 22rpx;
		color: rgba(255, 255, 255, 0.75);
	}

	.slot.done {
		background-color: rgba(255, 255, 255, 0.92);
	}

	.slot.done .slot-text {
		color: #2b7fff;
		font-weight: 600;
	}

	.slot.past {
		background-color: rgba(0, 0, 0, 0.16);
	}

	.slot.past .slot-text {
		color: rgba(255, 255, 255, 0.6);
	}

	.hero-hint {
		display: block;
		margin-top: 20rpx;
		font-size: 22rpx;
		color: rgba(255, 255, 255, 0.78);
	}

	.card {
		margin-top: 26rpx;
		padding: 34rpx 30rpx;
		border-radius: 28rpx;
		background-color: #ffffff;
		box-shadow: 0 10rpx 30rpx rgba(17, 24, 39, 0.05);
	}

	.card-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 18rpx;
	}

	.card-title {
		font-size: 30rpx;
		font-weight: 600;
		color: #1f2937;
	}

	.card-action {
		font-size: 26rpx;
		color: #2b7fff;
	}

	.card-sub-right {
		font-size: 22rpx;
		color: #9ca3af;
	}

	.progress-wrap {
		margin-bottom: 18rpx;
	}

	.progress {
		height: 8rpx;
		border-radius: 999rpx;
		background-color: #eef1f6;
		overflow: hidden;
	}

	.progress-bar {
		height: 100%;
		border-radius: 999rpx;
		background-image: linear-gradient(90deg, #2b7fff, #6ea8ff);
		transition: width 0.25s ease;
	}

	.progress-text {
		display: block;
		margin-top: 10rpx;
		font-size: 21rpx;
		color: #8b93a1;
	}

	.sum {
		display: block;
		margin-bottom: 16rpx;
		font-size: 22rpx;
		color: #8b93a1;
	}

	.group {
		margin-bottom: 20rpx;
	}

	/* 4 个时间点的地点行 */
	.slot-list {
		margin-bottom: 8rpx;
	}

	.slot-row {
		display: flex;
		padding: 14rpx 0;
		border-bottom: 1rpx solid #f2f4f8;
	}

	.slot-clock-col {
		width: 108rpx;
		flex-shrink: 0;
	}

	.slot-clock {
		display: block;
		font-size: 24rpx;
		font-weight: 600;
		color: #2b7fff;
	}

	.slot-cnt {
		display: block;
		margin-top: 2rpx;
		font-size: 19rpx;
		color: #b0b6c0;
	}

	.slot-info {
		flex: 1;
		min-width: 0;
	}

	.slot-place {
		display: block;
		font-size: 25rpx;
		line-height: 1.5;
		color: #1f2937;
	}

	.slot-place.mute {
		color: #b0b6c0;
	}

	.slot-sub {
		display: block;
		margin-top: 2rpx;
		font-size: 20rpx;
		color: #9ca3af;
	}

	.warn {
		display: block;
		margin: 8rpx 0 14rpx;
		padding: 12rpx 16rpx;
		border-radius: 12rpx;
		font-size: 20rpx;
		line-height: 1.5;
		color: #a16207;
		background-color: #fef8e7;
	}

	.group-title {
		display: block;
		margin-bottom: 12rpx;
		font-size: 23rpx;
		font-weight: 600;
		color: #5b6472;
	}

	.group-empty {
		font-size: 21rpx;
		color: #b6bcc6;
	}

	.thumbs {
		display: flex;
		flex-wrap: wrap;
	}

	.thumb-wrap {
		position: relative;
		width: 150rpx;
		height: 150rpx;
		margin: 0 14rpx 14rpx 0;
	}

	.thumb {
		width: 100%;
		height: 100%;
		border-radius: 16rpx;
		background-color: #f0f0f0;
	}

	.thumb-broken {
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: #f4f5f7;
	}

	.thumb-broken-text {
		font-size: 20rpx;
		color: #a8aeb8;
	}

	.thumb-time {
		position: absolute;
		left: 8rpx;
		bottom: 8rpx;
		padding: 2rpx 10rpx;
		border-radius: 8rpx;
		font-size: 18rpx;
		color: #ffffff;
		background-color: rgba(0, 0, 0, 0.45);
	}

	/* 缩略图边缘的位置标签：扫描到图就立刻能看到的 EXIF 逆地理地名 */
	.thumb-place {
		position: absolute;
		left: 8rpx;
		top: 8rpx;
		right: 8rpx;
		padding: 2rpx 10rpx;
		border-radius: 8rpx;
		font-size: 18rpx;
		line-height: 1.4;
		color: #ffe9c2;
		background-color: rgba(0, 0, 0, 0.45);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* 调试：没读到坐标时显示 EXIF 诊断信息 */
	.thumb-dbg {
		position: absolute;
		left: 8rpx;
		top: 8rpx;
		right: 8rpx;
		padding: 2rpx 10rpx;
		border-radius: 8rpx;
		font-size: 16rpx;
		line-height: 1.4;
		color: #ffb4a2;
		background-color: rgba(0, 0, 0, 0.55);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* 每张照片一行的位置/诊断信息 */
	.place-lines {
		margin-top: 10rpx;
	}
	.place-line {
		padding: 4rpx 8rpx;
	}
	.place-line-text {
		font-size: 22rpx;
		line-height: 1.5;
		color: #52606d;
		word-break: break-all;
	}
	.place-line-text.dbg {
		color: #c2410c;
	}

	.thumb-badge {
		position: absolute;
		right: 8rpx;
		top: 8rpx;
		padding: 2rpx 8rpx;
		border-radius: 8rpx;
		font-size: 17rpx;
		color: #ffffff;
		background-color: rgba(43, 127, 255, 0.85);
	}

	.thumb-manual {
		position: absolute;
		left: 8rpx;
		top: 8rpx;
		padding: 2rpx 8rpx;
		border-radius: 8rpx;
		font-size: 17rpx;
		color: #ffffff;
		background-color: rgba(245, 158, 11, 0.9);
	}

	.thumb-del {
		position: absolute;
		right: -6rpx;
		top: -6rpx;
		width: 34rpx;
		height: 34rpx;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: rgba(0, 0, 0, 0.55);
	}

	.thumb-del-text {
		font-size: 24rpx;
		line-height: 24rpx;
		color: #ffffff;
	}

	/* 手动添加 */
	.add-row {
		margin-top: 20rpx;
	}

	.add-btn {
		padding: 22rpx;
		border-radius: 18rpx;
		border: 1rpx dashed #9cc2ff;
		background-color: #f6faff;
		text-align: center;
	}

	.add-text {
		font-size: 25rpx;
		color: #2b7fff;
	}

	.hint {
		display: block;
		margin-top: 8rpx;
		font-size: 22rpx;
		line-height: 1.7;
		color: #9ca3af;
	}

	.hint.center {
		text-align: center;
		margin-top: 20rpx;
	}

	/* 行程 */
	.stop {
		display: flex;
	}

	.stop-rail {
		width: 32rpx;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.stop-dot {
		font-size: 16rpx;
		line-height: 34rpx;
		color: #2b7fff;
	}

	.stop-line {
		flex: 1;
		width: 2rpx;
		background-color: #e5eaf2;
	}

	.stop-body {
		flex: 1;
		padding-bottom: 22rpx;
	}

	.stop-time {
		display: block;
		font-size: 21rpx;
		color: #9ca3af;
	}

	.stop-place {
		display: block;
		margin-top: 2rpx;
		font-size: 27rpx;
		color: #1f2937;
	}

	/* 图片含义 */
	.meaning-row {
		display: flex;
		margin-top: 18rpx;
	}

	.meaning-thumb {
		width: 96rpx;
		height: 96rpx;
		border-radius: 14rpx;
		background-color: #f0f0f0;
		flex-shrink: 0;
	}

	.meaning-thumb-broken {
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: #f4f5f7;
	}

	.meaning-text {
		flex: 1;
		margin-left: 18rpx;
	}

	.meaning-time {
		display: block;
		font-size: 21rpx;
		color: #9ca3af;
	}

	.meaning-body {
		display: block;
		margin-top: 4rpx;
		font-size: 25rpx;
		line-height: 1.55;
		color: #374151;
	}

	/* 随手记 */
	.seg {
		margin-top: 22rpx;
	}

	.seg-label {
		display: block;
		margin-bottom: 10rpx;
		font-size: 26rpx;
		color: #111827;
	}

	.seg-hint {
		font-size: 22rpx;
		color: #9ca3af;
	}

	.seg-wrap {
		position: relative;
	}

	.seg-input {
		width: 100%;
		box-sizing: border-box;
		min-height: 88rpx;
		padding: 18rpx 20rpx;
		border-radius: 16rpx;
		font-size: 26rpx;
		line-height: 1.6;
		color: #1f2937;
		background-color: #f7f8fa;
	}

	/* 自绘占位：与输入框同位置，值非空时由 v-if 移除；不拦截点击 */
	.seg-ph {
		position: absolute;
		top: 18rpx;
		left: 20rpx;
		right: 20rpx;
		font-size: 26rpx;
		line-height: 1.6;
		color: #a8aeb8;
		pointer-events: none;
	}

	.gen {
		margin-top: 32rpx;
		padding: 28rpx;
		border-radius: 999rpx;
		background-color: #2b7fff;
		text-align: center;
		box-shadow: 0 10rpx 24rpx rgba(43, 127, 255, 0.3);
	}

	.gen-row {
		display: flex;
		margin-top: 32rpx;
	}

	.gen-row .gen {
		flex: 1;
		margin-top: 0;
	}

	.gen-row .gen:first-child {
		margin-right: 18rpx;
	}

	.gen-ghost {
		background-color: #ffffff;
		border: 1rpx solid #2b7fff;
		box-shadow: none;
	}

	.gen-hover {
		opacity: 0.85;
	}

	.gen-text {
		font-size: 30rpx;
		font-weight: 600;
		color: #ffffff;
	}

	.gen-text.ghost-text {
		color: #2b7fff;
	}

	.footer-links {
		margin-top: 36rpx;
		text-align: center;
	}

	.link {
		font-size: 26rpx;
		color: #2b7fff;
	}

	.sep {
		margin: 0 16rpx;
		color: #c0c4cc;
	}
</style>
