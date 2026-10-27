<template>
	<view class="page">
		<view v-if="!data" class="empty">
			<text class="empty-text">这一天还没有数据</text>
		</view>

		<template v-else>
			<!-- 散文正文（按时段分段，每段首行缩进 2 字） -->
			<view class="paper">
				<text class="paper-date">{{ dayCN }}</text>
				<text v-if="!data.log" class="paper-body paper-empty">今天还没有生成日志，回首页点「生成今日日志」</text>
				<view v-else class="paper-body">
					<text v-for="(p, i) in diaryParas" :key="i" class="paper-para">{{ p }}</text>
				</view>
				<text v-if="data.log" class="paper-time">生成于 {{ fmtTime(data.log.generatedAt) }}{{ data.log.auto ? ' · 自动' : '' }}</text>
			</view>

			<!-- 行程 -->
			<view v-if="stops.length" class="card">
				<text class="card-title">当日行程</text>
				<view v-for="(s, i) in stops" :key="i" class="stop">
					<view class="stop-rail">
						<text class="stop-dot">●</text>
						<text v-if="i < stops.length - 1" class="stop-line"></text>
					</view>
					<view class="stop-body">
						<text class="stop-time">{{ s.span }}</text>
						<text class="stop-place">{{ s.place }}</text>
						<text v-if="s.kinds.length" class="stop-kind">{{ s.kinds.join(' · ') }}</text>
					</view>
				</view>
			</view>

			<!-- 4 个时间点的位置 -->
			<view v-if="slotRows.length" class="card">
				<text class="card-title">各时间点的位置</text>
				<view v-for="s in slotRows" :key="s.hour" class="slot-row">
					<text class="slot-clock">{{ s.hhmm }}</text>
					<view class="slot-info">
						<text class="slot-place" :class="{ mute: !s.place }">{{ s.place || s.emptyText }}</text>
						<text v-if="s.sub" class="slot-sub">{{ s.sub }}</text>
					</view>
				</view>
			</view>

			<!-- 图片与含义 -->
			<view class="card">
				<text class="card-title">当天图片（{{ (data.photos || []).length }}）</text>
				<view v-for="(p, i) in data.photos || []" :key="i" class="prow">
					<image
						v-if="p.renderable !== false"
						class="pthumb"
						:class="{ picked: pickedIdx.includes(p.path) }"
						:src="p.path"
						mode="aspectFill"
						@click="previewPhoto(i)"
						@error="onImgError(p)"
					/>
					<view v-else class="pthumb pthumb-broken">
						<text class="pthumb-broken-text">读不到</text>
					</view>
					<view class="pinfo">
						<text class="ptime">
							{{ fmtTime(p.takenAt) }}
							<text v-if="p.kind === 'screenshot'" class="ptag">截图</text>
							<text v-if="p.place"> · {{ p.place }}</text>
						</text>
						<text class="pmeaning">{{ p.meaning || '—' }}</text>
					</view>
				</view>
				<text v-if="!(data.photos || []).length" class="hint">这天没有图片</text>
			</view>

			<!-- 文件与操作 -->
			<view v-if="data.log" class="card">
				<text class="card-title">导出与分享</text>
				<text class="mono">TXT：{{ data.log.filePath || '（未导出）' }}</text>
				<text class="mono">PDF：{{ data.log.pdfPath || '（还没生成，点下面按钮生成）' }}</text>
				<view class="btn-row">
					<view v-if="data.log.pdfPath" class="btn" hover-class="btn-hover" @click="doShare('pdf')">
						<text class="btn-text">分享 PDF</text>
					</view>
					<view v-else class="btn" hover-class="btn-hover" @click="makePdf">
						<text class="btn-text">{{ makingPdf ? '生成中…' : '生成 PDF（含图片）' }}</text>
					</view>
					<view v-if="data.log.filePath" class="btn" :class="{ 'btn-ghost': data.log.pdfPath }" hover-class="btn-hover" @click="doShare('txt')">
						<text class="btn-text" :class="{ ghost: data.log.pdfPath }">分享 TXT</text>
					</view>
				</view>
				<view class="btn-row">
					<view class="btn btn-ghost" hover-class="btn-hover" @click="regenerate">
						<text class="btn-text ghost">重新生成（覆盖）</text>
					</view>
				</view>
				<text class="hint">点「分享」调起系统分享面板（微信 / 网盘 / 邮件都能发）；重新生成覆盖当天的文件</text>
			</view>
		</template>
	</view>
</template>

<script setup>
	import { ref, computed } from 'vue'
	import { onLoad } from '@dcloudio/uni-app'
	import { loadDay, saveDay } from '@/utils/db.js'
	import { fmtDayCN, fmtTime } from '@/utils/day.js'
	import { openFile, buildPdfArgs, withWeather } from '@/utils/pdf.js'
	import { exportPdfNative } from '@/utils/gallery.js'
	import { DAY_SLOTS } from '@/utils/slots.js'

	const day = ref('')
	const data = ref(null)
	const dayCN = ref('')
	const pickedIdx = ref([])
	const makingPdf = ref(false)

	onLoad(q => {
		day.value = q.day
		dayCN.value = fmtDayCN(q.day)
		data.value = loadDay(q.day)
		pickedIdx.value = data.value && data.value.log ? data.value.log.photoPaths || [] : []
	})

	// 日记按时段分段（生成端已按 上午/中午/下午/晚上 分段输出）
	const diaryParas = computed(() => {
		const t = (data.value && data.value.log && data.value.log.text) || ''
		return String(t).replace(/\r\n/g, '\n').split(/\n+/).map(s => s.trim()).filter(Boolean)
	})

	// 4 个时间点的位置（老数据没 slotSummary 就按 photos 现算）
	const slotRows = computed(() => {
		const d = data.value || {}
		const photos = d.photos || []
		const summary = d.slotSummary || []
		return DAY_SLOTS.map(h => {
			const s = summary.find(x => x.hour === h)
			const items = s ? [] : photos.filter(p => p.slotHour === h)
			const place = (s && s.place) || (items.find(p => p.place) || {}).place || ''
			const photoN = s ? s.photos : items.filter(p => p.kind !== 'screenshot').length
			const shotN = s ? s.shots : items.filter(p => p.kind === 'screenshot').length
			const count = s ? s.count : items.length
			const parts = []
			if (photoN) parts.push(`照片 ${photoN}`)
			if (shotN) parts.push(`截图 ${shotN}`)
			return {
				hour: h,
				hhmm: `${String(h).padStart(2, '0')}:00`,
				place,
				sub: parts.join(' · '),
				emptyText: count ? '这几张没有位置信息' : '这个点没有素材'
			}
		})
	})

	function onImgError(p) {
		p.renderable = false
	}

	// 轨迹压成「站点」：连续同一地点合并
	const stops = computed(() => {
		const track = (data.value && data.value.track) || []
		const out = []
		for (const t of track) {
			if (!t.place) continue
			const last = out[out.length - 1]
			if (last && last.place === t.place) {
				last.end = t.t
				if (t.kind === 'screenshot' && !last.kinds.includes('截图')) last.kinds.push('截图')
				continue
			}
			out.push({
				place: t.place,
				start: t.t,
				end: t.t,
				kinds: t.kind === 'screenshot' ? ['截图'] : []
			})
		}
		return out.map(s => ({
			place: s.place,
			span: s.end !== s.start ? `${s.start}–${s.end}` : s.start,
			kinds: s.kinds
		}))
	})

	function previewPhoto(i) {
		uni.previewImage({
			urls: (data.value.photos || []).map(p => p.path),
			current: i
		})
	}

	function doShare(kind) {
		const log = data.value && data.value.log
		if (!log) return
		const path = kind === 'pdf' ? log.pdfPath : log.filePath
		if (!path) {
			uni.showToast({ title: '这个文件还没生成', icon: 'none' })
			return
		}
		if (!openFile(path, kind === 'pdf' ? '牛马本纪 PDF（含图片）' : '牛马本纪 日志')) {
			uni.showToast({ title: 'H5 预览不支持分享本地文件', icon: 'none' })
		}
	}

	// 老日志补生成 PDF：直接用已保存的日记与图片排版，不重跑 AI
	async function makePdf() {
		const d = data.value
		if (!d || !d.log || makingPdf.value) return
		makingPdf.value = true
		uni.showLoading({ title: '正在生成 PDF…', mask: true })
		try {
			const weather = await withWeather(day.value, d)
			const args = buildPdfArgs(day.value, d.log.text, d, d.log.nodes || [], weather)
			const r = await exportPdfNative(args)
			d.log.pdfPath = (r && r.fileUri) || ''
			saveDay(d)
			uni.hideLoading()
			uni.showToast({ title: 'PDF 已生成', icon: 'success' })
		} catch (e) {
			uni.hideLoading()
			uni.showModal({
				title: 'PDF 生成失败',
				content: (e && e.message) || String(e),
				showCancel: false
			})
		} finally {
			makingPdf.value = false
		}
	}

	function regenerate() {
		uni.redirectTo({ url: '/pages/index/index' })
	}
</script>

<style>
	.page {
		min-height: 100vh;
		padding: 24rpx 24rpx 60rpx;
		box-sizing: border-box;
		background-color: #f2f3f5;
	}

	.empty {
		padding-top: 200rpx;
		text-align: center;
	}

	.empty-text {
		font-size: 28rpx;
		color: #9ca3af;
	}

	.paper {
		padding: 48rpx 40rpx;
		border-radius: 24rpx;
		background-color: #fffdf7;
		border: 1rpx solid #f0e9d8;
	}

	.paper-date {
		display: block;
		font-size: 26rpx;
		color: #b08b4f;
		letter-spacing: 2rpx;
	}

	.paper-body {
		display: block;
		margin-top: 28rpx;
	}

	/* 没有日志时的占位文字 */
	.paper-empty {
		font-size: 28rpx;
		line-height: 1.8;
		color: #9ca3af;
	}

	/* 日记分段：每段首行缩进 2 字 */
	.paper-para {
		display: block;
		margin-top: 18rpx;
		font-size: 30rpx;
		line-height: 2;
		color: #33302a;
		text-indent: 2em;
	}

	.paper-para:first-child {
		margin-top: 0;
	}

	.paper-time {
		display: block;
		margin-top: 32rpx;
		font-size: 22rpx;
		color: #c9bda2;
	}

	.card {
		margin-top: 24rpx;
		padding: 32rpx;
		border-radius: 24rpx;
		background-color: #ffffff;
	}

	.card-title {
		display: block;
		margin-bottom: 22rpx;
		font-size: 30rpx;
		font-weight: 600;
		color: #1f2937;
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
		padding-bottom: 24rpx;
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

	.stop-kind {
		display: block;
		margin-top: 4rpx;
		font-size: 20rpx;
		color: #b6bcc6;
	}

	/* 图片行 */
	.prow {
		display: flex;
		margin-bottom: 22rpx;
	}

	.pthumb {
		width: 132rpx;
		height: 132rpx;
		border-radius: 16rpx;
		background-color: #f0f0f0;
		flex-shrink: 0;
	}

	.pthumb-broken {
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: #f4f5f7;
	}

	.pthumb-broken-text {
		font-size: 20rpx;
		color: #a8aeb8;
	}

	/* 时间点位置行 */
	.slot-row {
		display: flex;
		padding: 14rpx 0;
		border-bottom: 1rpx solid #f2f4f8;
	}

	.slot-clock {
		width: 108rpx;
		flex-shrink: 0;
		font-size: 24rpx;
		font-weight: 600;
		color: #2b7fff;
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

	.picked {
		border: 4rpx solid #2b7fff;
	}

	.pinfo {
		flex: 1;
		margin-left: 20rpx;
	}

	.ptime {
		display: block;
		font-size: 22rpx;
		color: #9ca3af;
	}

	.ptag {
		margin-left: 8rpx;
		padding: 0 8rpx;
		border-radius: 6rpx;
		font-size: 18rpx;
		color: #2b7fff;
		background-color: #eef5ff;
	}

	.pmeaning {
		display: block;
		margin-top: 6rpx;
		font-size: 25rpx;
		line-height: 1.6;
		color: #374151;
	}

	.mono {
		font-size: 23rpx;
		color: #6b7280;
		word-break: break-all;
	}

	.btn-row {
		display: flex;
		margin-top: 24rpx;
	}

	.btn {
		flex: 1;
		margin-right: 16rpx;
		padding: 22rpx 0;
		border-radius: 16rpx;
		background-color: #2b7fff;
		text-align: center;
	}

	.btn-ghost {
		background-color: #ffffff;
		border: 1rpx solid #2b7fff;
	}

	.btn-hover {
		opacity: 0.85;
	}

	.btn-text {
		font-size: 26rpx;
		color: #ffffff;
	}

	.btn-text.ghost {
		color: #2b7fff;
	}

	.hint {
		display: block;
		margin-top: 16rpx;
		font-size: 22rpx;
		color: #9ca3af;
	}
</style>
