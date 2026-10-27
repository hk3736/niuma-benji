<template>
	<view class="page">
		<view class="intro">
			<text class="intro-title">模型与自动化</text>
			<text class="intro-sub">Key 只存在本机，生成日志时直接连你选的服务商</text>
		</view>

		<!-- 模型服务 -->
		<view class="card">
			<view class="card-head">
				<view class="head-badge"><text class="head-badge-text">AI</text></view>
				<view class="head-text">
					<text class="card-title">模型服务</text>
					<text class="card-sub">选一个服务商，或填自定义兼容接口</text>
				</view>
			</view>

			<view class="presets">
				<view
					v-for="p in PRESETS"
					:key="p.id"
					class="preset"
					:class="{ on: cfg.presetId === p.id }"
					hover-class="preset-hover"
					@click="usePreset(p)"
				>
					<text class="preset-text">{{ p.name }}</text>
				</view>
			</view>
			<text v-if="presetNote" class="note">{{ presetNote }}</text>

			<view class="field">
				<text class="label">接口地址</text>
				<input
					class="input"
					:value="cfg.baseUrl"
					placeholder="https://api.deepseek.com"
					@input="onBaseInput"
					@blur="onBaseBlur"
				/>
				<text v-if="epPreview" class="note">实际请求：{{ epPreview }}</text>
			</view>

			<view class="field">
				<text class="label">模型名称</text>
				<view v-if="modelOptions.length" class="model-chips">
					<view
						v-for="m in modelOptions"
						:key="m"
						class="model-chip"
						:class="{ on: cfg.model === m }"
						@click="pickModel(m)"
					>
						<text class="model-chip-text">{{ m }}</text>
					</view>
				</view>
				<input
					class="input"
					:value="cfg.model"
					placeholder="deepseek-v4-flash"
					@input="onModelInput"
					@blur="onModelBlur"
					@confirm="onModelBlur"
				/>
				<text v-if="modelWarn" class="warn">{{ modelWarn }}</text>
				<text v-else class="note">点上面胶囊直接选用，避免手打出错</text>
			</view>

			<view class="field">
				<text class="label">API Key</text>
				<view class="key-row">
					<input
						class="input key-input"
						:value="keyInput"
						:password="true"
						:placeholder="hasKey ? '已保存，留空则不修改' : '粘贴你的 Key'"
						@input="onKeyInput"
						@blur="onKeyBlur"
					/>
					<view class="paste" hover-class="btn-hover" @click="pasteKey">
						<text class="paste-text">粘贴</text>
					</view>
				</view>
				<text class="note">只保存在本机沙盒，换手机需重新填写</text>
			</view>

			<view class="divider"></view>

			<view class="row">
				<view class="row-text">
					<text class="row-title">照片识图</text>
					<text class="row-sub">关闭后只发文字与位置，更省 token</text>
				</view>
				<switch :checked="cfg.vision" color="#2b7fff" @change="e => (cfg.vision = e.detail.value)" />
			</view>

			<view class="row">
				<view class="row-text">
					<text class="row-title">嵌入照片上限</text>
					<text class="row-sub">模型从当天照片里挑几张写进日记</text>
				</view>
				<view class="stepper">
					<view
						v-for="n in [1, 2, 3]"
						:key="n"
						class="step"
						:class="{ on: cfg.maxPhotos === n }"
						@click="cfg.maxPhotos = n"
					>
						<text class="step-text">{{ n }}</text>
					</view>
				</view>
			</view>

			<view class="field">
				<text class="label">文本生成风格</text>
				<view class="style-chips">
					<view
						v-for="s in STYLE_OPTIONS"
						:key="s.id"
						class="style-chip"
						:class="{ on: cfg.style === s.id }"
						hover-class="preset-hover"
						@click="cfg.style = s.id"
					>
						<text class="style-chip-text">{{ s.label }}</text>
					</view>
				</view>
				<text class="note">{{ styleNote }}</text>
			</view>
		</view>

		<!-- 位置与地址 -->
		<view class="card">
			<view class="card-head">
				<view class="head-badge amber"><text class="head-badge-text">📍</text></view>
				<view class="head-text">
					<text class="card-title">位置与地址</text>
					<text class="card-sub">照片定位 → 中文地标名</text>
				</view>
			</view>

			<view class="field">
				<text class="label">高德 Web 服务 Key（可选）</text>
				<view class="key-row">
					<input
						class="input key-input"
						:value="amapInput"
						:password="true"
						:placeholder="hasAmap ? '已保存，留空则不修改' : '粘贴高德 Key，地名更准、全中文'"
						@input="e => (amapInput = e.detail.value)"
					/>
					<view class="paste" hover-class="btn-hover" @click="pasteAmap">
						<text class="paste-text">粘贴</text>
					</view>
				</view>
				<text class="note">
					填写后逆地理走高德，直接得到中文 POI 名（如「瑞安广场」）。到高德开放平台
					console.amap.com → 应用管理 → 创建应用，Key 类型选「Web服务」。
					不填则用 OpenStreetMap（也返回中文，但精度略低）。
				</text>
			</view>
		</view>

		<!-- 每日自动生成 -->
		<view class="card">
			<view class="card-head">
				<view class="head-badge teal"><text class="head-badge-text">⏱</text></view>
				<view class="head-text">
					<text class="card-title">每天自动生成</text>
					<text class="card-sub">不用每天手动点，打开就有稿</text>
				</view>
			</view>

			<view class="row">
				<view class="row-text">
					<text class="row-title">自动扫描相册</text>
					<text class="row-sub">自动从相册取 9/12/15/18 点最近的照片与截图</text>
				</view>
				<switch :checked="autoScan" color="#2b7fff" @change="onAutoScan" />
			</view>

			<view class="row">
				<view class="row-text">
					<text class="row-title">自动生成日志</text>
					<text class="row-sub">打开 App 时补生成昨天：有素材且还没生成，就写一篇</text>
				</view>
				<switch :checked="autoGen" color="#2b7fff" @change="onAutoGen" />
			</view>

			<view class="notice">
				<text class="notice-text">
					当前是“前台补生成”：打开 App 才执行，不在后台常驻、不额外耗电。
					当天没有照片会跳过；只把选中的 4～8 张图发给你配置的模型。
				</text>
			</view>
		</view>

		<!-- 照片时间点 -->
		<view class="card">
			<view class="card-head">
				<view class="head-badge amber"><text class="head-badge-text">◎</text></view>
				<view class="head-text">
					<text class="card-title">照片时间点</text>
					<text class="card-sub">每天取这 4 个时刻最近的一张，构成行程</text>
				</view>
			</view>

			<view class="slots">
				<view v-for="h in SLOTS" :key="h" class="slot on">
					<text class="slot-text">{{ pad(h) }}:00</text>
				</view>
			</view>
			<text class="note">
				每个点位取前后 90 分钟内最近的图：照片与截图各取一组；截图没有位置时，借用同段最近照片的坐标
			</text>
			<text class="note">位置位移小于 150 米会合并为同一站，不重复记录</text>
		</view>

		<!-- 隐私 -->
		<view class="card">
			<view class="card-head">
				<view class="head-badge gray"><text class="head-badge-text">锁</text></view>
				<view class="head-text">
					<text class="card-title">隐私</text>
					<text class="card-sub">数据默认不出这台手机</text>
				</view>
			</view>
			<view class="privacy-row"><text class="dot"></text><text class="privacy-text">所有日志、照片、定位只存本机沙盒</text></view>
			<view class="privacy-row"><text class="dot"></text><text class="privacy-text">没有服务器，也没有埋点上报</text></view>
			<view class="privacy-row"><text class="dot"></text><text class="privacy-text">生成时才把压缩后的照片发给你配置的模型</text></view>
		</view>

		<view class="footer-space"></view>

		<!-- 底部操作条 -->
		<view class="footer">
			<text v-if="testMsg" class="test-msg">{{ testMsg }}</text>
			<view class="footer-btns">
				<view class="btn ghost" hover-class="btn-hover" @click="test">
					<text class="btn-text ghost-text">测试连接</text>
				</view>
				<view class="btn primary" hover-class="btn-hover" @click="save">
					<text class="btn-text">保存设置</text>
				</view>
			</view>
		</view>

		<!-- 版本号 -->
		<view class="version-bar">
			<text class="version-text">牛马本纪 EveryLog v{{ APP_VERSION }}</text>
		</view>
	</view>
</template>

<script setup>
	import { ref, computed } from 'vue'
	const APP_VERSION = '2.14'
	import {
		loadCfg, saveCfg, setApiKey, getApiKey, ping, PRESETS, STYLE_OPTIONS,
		cleanModelName, fixKnownModel, describeEndpoint
	} from '@/utils/llm.js'
	import { pad } from '@/utils/day.js'
	import { isAutoGenOn, setAutoGen, isAutoScanOn, setAutoScan } from '@/utils/auto.js'
	import { DAY_SLOTS } from '@/utils/slots.js'
	import { getAmapKey, setAmapKey } from '@/utils/geo.js'

	const SLOTS = DAY_SLOTS

	const cfg = ref(loadCfg())
	const autoGen = ref(isAutoGenOn())
	const autoScan = ref(isAutoScanOn())
	const hasKey = ref(!!getApiKey())
	const keyInput = ref('')
	const testMsg = ref('')
	const hasAmap = ref(!!getAmapKey())
	const amapInput = ref('')

	const presetNote = computed(() => {
		const p = PRESETS.find(x => x.id === cfg.value.presetId)
		return p && p.id !== 'custom' ? p.note : ''
	})

	// 当前选中的文本风格说明
	const styleNote = computed(() => {
		const s = STYLE_OPTIONS.find(x => x.id === cfg.value.style)
		return s ? s.note : ''
	})

	// 当前服务商的推荐模型名，点一下就填好，省得手打（手打最容易错一个字符）
	const modelOptions = computed(() => {
		const p = PRESETS.find(x => x.id === cfg.value.presetId)
		return (p && p.models) || []
	})

	const epPreview = computed(() => {
		const b = (cfg.value.baseUrl || '').trim()
		return b ? describeEndpoint(b) : ''
	})

	// DeepSeek 官方现在只认 v4 两个模型，填错时当场提示，不用等 400
	const modelWarn = computed(() => {
		const b = cfg.value.baseUrl || ''
		const m = cleanModelName(cfg.value.model)
		if (b.indexOf('api.deepseek.com') < 0) return ''
		if (!m) return ''
		if (/^deepseek-v4-(flash|pro)$/.test(m)) return ''
		return `DeepSeek 现在只有 deepseek-v4-flash / deepseek-v4-pro，你填的 ${m} 会被服务端拒绝`
	})

	// uni-app 的 input 在中文输入法组词时，v-model 可能收不到最后一个词
	// （表现就是 deepseek-v4-flash 只剩 deepseek-v4-），所以 input 和 blur 都直接取 detail.value
	function onBaseInput(e) {
		cfg.value.baseUrl = e.detail.value
	}

	function onBaseBlur(e) {
		cfg.value.baseUrl = String(e.detail.value || '')
			.replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
			.trim()
	}

	function onModelInput(e) {
		cfg.value.model = e.detail.value
	}

	function onModelBlur(e) {
		cfg.value.model = fixKnownModel(cfg.value.baseUrl, e.detail.value)
	}

	function pickModel(m) {
		cfg.value.model = m
	}

	function onKeyInput(e) {
		keyInput.value = e.detail.value
	}

	function onKeyBlur(e) {
		keyInput.value = String(e.detail.value || '').replace(/\s+/g, '')
	}

	function usePreset(p) {
		cfg.value.presetId = p.id
		if (p.id === 'custom') {
			cfg.value.baseUrl = ''
			cfg.value.model = ''
		} else {
			cfg.value.baseUrl = p.baseUrl
			cfg.value.model = p.model
			cfg.value.vision = p.vision
		}
		saveCfg(cfg.value)
		uni.showToast({ title: p.id === 'custom' ? '请手动填写地址' : `已填入 ${p.name}`, icon: 'none' })
	}

	function pasteKey() {
		uni.getClipboardData({
			success: r => {
				const v = (r.data || '').trim()
				if (!v) return uni.showToast({ title: '剪贴板是空的', icon: 'none' })
				keyInput.value = v
				uni.showToast({ title: '已粘贴，记得保存', icon: 'none' })
			},
			fail: () => uni.showToast({ title: '读取剪贴板失败，请手动输入', icon: 'none' })
		})
	}

	function pasteAmap() {
		uni.getClipboardData({
			success: r => {
				const v = (r.data || '').trim()
				if (!v) return uni.showToast({ title: '剪贴板是空的', icon: 'none' })
				amapInput.value = v
				uni.showToast({ title: '已粘贴，记得保存', icon: 'none' })
			},
			fail: () => uni.showToast({ title: '读取剪贴板失败，请手动输入', icon: 'none' })
		})
	}

	function onAutoGen(e) {
		autoGen.value = e.detail.value
		setAutoGen(autoGen.value)
		uni.showToast({ title: autoGen.value ? '已开启' : '已关闭', icon: 'none' })
	}

	function onAutoScan(e) {
		autoScan.value = e.detail.value
		setAutoScan(autoScan.value)
		uni.showToast({ title: autoScan.value ? '已开启自动扫描' : '已关闭自动扫描', icon: 'none' })
	}

	function save() {
		cfg.value.baseUrl = String(cfg.value.baseUrl || '').trim()
		// 保存前统一清洗：全角连字符 / 零宽字符 / 首尾空格，避免服务端 400
		cfg.value.model = fixKnownModel(cfg.value.baseUrl, cfg.value.model)
		if (!cfg.value.baseUrl || !cfg.value.model) {
			uni.showToast({ title: '地址和模型名不能为空', icon: 'none' })
			return
		}
		saveCfg(cfg.value)
		if (keyInput.value.trim()) setApiKey(keyInput.value)
		hasKey.value = !!getApiKey()
		keyInput.value = ''
		if (amapInput.value.trim()) {
			setAmapKey(amapInput.value.trim())
			// 新 key 意味着更好的中文地名：把旧地名缓存清掉，重新扫描即生效
			try { uni.removeStorageSync('el:geo:cache:v2') } catch (e) {}
		}
		hasAmap.value = !!getAmapKey()
		amapInput.value = ''
		setAutoGen(autoGen.value)
		setAutoScan(autoScan.value)
		if (modelWarn.value) {
			uni.showToast({ title: '已保存，但模型名可能不对', icon: 'none' })
		} else {
			uni.showToast({ title: '已保存', icon: 'success' })
		}
	}

	async function test() {
		testMsg.value = '正在请求模型…'
		if (keyInput.value.trim()) setApiKey(keyInput.value)
		hasKey.value = !!getApiKey()
		if (cfg.value.baseUrl && cfg.value.model) {
			cfg.value.model = fixKnownModel(cfg.value.baseUrl, cfg.value.model)
			saveCfg(cfg.value)
		}
		try {
			const r = await ping()
			testMsg.value = `连接成功，模型回复：${r}`
		} catch (e) {
			testMsg.value = '失败：' + (e.message || e.errMsg || '未知错误')
		}
	}

</script>

<style>
	.page {
		min-height: 100vh;
		padding: 28rpx 28rpx 0;
		box-sizing: border-box;
		background-color: #f4f6f9;
	}

	/* 顶部说明 */
	.intro {
		padding: 8rpx 8rpx 28rpx;
	}

	.intro-title {
		display: block;
		font-size: 38rpx;
		font-weight: 700;
		color: #111827;
		letter-spacing: 1rpx;
	}

	.intro-sub {
		display: block;
		margin-top: 10rpx;
		font-size: 23rpx;
		line-height: 1.6;
		color: #8b93a1;
	}

	/* 卡片 */
	.card {
		margin-bottom: 26rpx;
		padding: 34rpx 30rpx;
		border-radius: 28rpx;
		background-color: #ffffff;
		box-shadow: 0 10rpx 30rpx rgba(17, 24, 39, 0.05);
	}

	.card-head {
		display: flex;
		align-items: center;
		margin-bottom: 26rpx;
	}

	.head-badge {
		width: 64rpx;
		height: 64rpx;
		border-radius: 20rpx;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-right: 20rpx;
		background-color: #e8f1ff;
		flex-shrink: 0;
	}

	.head-badge.teal {
		background-color: #e6f7f4;
	}

	.head-badge.amber {
		background-color: #fff4e5;
	}

	.head-badge.gray {
		background-color: #f2f4f7;
	}

	.head-badge-text {
		font-size: 24rpx;
		font-weight: 700;
		color: #2b7fff;
	}

	.head-badge.teal .head-badge-text {
		color: #0f9d8a;
	}

	.head-badge.amber .head-badge-text {
		color: #d98324;
	}

	.head-badge.gray .head-badge-text {
		font-size: 20rpx;
		color: #6b7280;
	}

	.head-text {
		flex: 1;
	}

	.card-title {
		display: block;
		font-size: 30rpx;
		font-weight: 600;
		color: #111827;
	}

	.card-sub {
		display: block;
		margin-top: 6rpx;
		font-size: 22rpx;
		line-height: 1.5;
		color: #9aa1ad;
	}

	/* 预设 */
	.presets {
		display: flex;
		flex-wrap: wrap;
		margin-bottom: 6rpx;
	}

	.preset {
		margin: 0 14rpx 14rpx 0;
		padding: 14rpx 26rpx;
		border-radius: 999rpx;
		background-color: #f4f6f9;
		border: 2rpx solid transparent;
	}

	.preset.on {
		background-color: #eef5ff;
		border-color: #2b7fff;
	}

	.preset-hover {
		opacity: 0.7;
	}

	.preset-text {
		font-size: 24rpx;
		color: #5b6472;
	}

	.preset.on .preset-text {
		color: #2b7fff;
		font-weight: 600;
	}

	/* 表单 */
	.field {
		margin-top: 24rpx;
	}

	.label {
		display: block;
		margin-bottom: 12rpx;
		font-size: 23rpx;
		color: #8b93a1;
	}

	/* 注意：必须给显式高度，否则 uni-app H5 的 input 会塌成 0 高，点不进去 */
	.input {
		width: 100%;
		height: 92rpx;
		line-height: 92rpx;
		box-sizing: border-box;
		padding: 0 26rpx;
		border-radius: 20rpx;
		border: 2rpx solid transparent;
		font-size: 27rpx;
		color: #111827;
		background-color: #f6f8fb;
	}

	.key-row {
		display: flex;
		align-items: center;
	}

	.key-input {
		flex: 1;
	}

	.paste {
		margin-left: 16rpx;
		padding: 0 26rpx;
		height: 92rpx;
		line-height: 92rpx;
		border-radius: 20rpx;
		background-color: #eef5ff;
	}

	.paste-text {
		font-size: 24rpx;
		color: #2b7fff;
	}

	.note {
		display: block;
		margin-top: 14rpx;
		font-size: 21rpx;
		line-height: 1.6;
		color: #a3aab6;
	}

	/* 推荐模型名胶囊 */
	.model-chips {
		display: flex;
		flex-wrap: wrap;
		margin-bottom: 14rpx;
	}

	.model-chip {
		margin: 0 12rpx 12rpx 0;
		padding: 10rpx 20rpx;
		border-radius: 12rpx;
		background-color: #f4f6f9;
		border: 2rpx solid transparent;
	}

	.model-chip.on {
		background-color: #eef5ff;
		border-color: #2b7fff;
	}

	.model-chip-text {
		font-size: 21rpx;
		color: #6b7280;
		font-family: "SF Mono", Menlo, Consolas, monospace;
	}

	.model-chip.on .model-chip-text {
		color: #2b7fff;
		font-weight: 600;
	}

	.warn {
		display: block;
		margin-top: 14rpx;
		font-size: 21rpx;
		line-height: 1.6;
		color: #d14343;
	}

	.divider {
		height: 1rpx;
		margin: 30rpx 0 6rpx;
		background-color: #f0f2f5;
	}

	/* 开关行 */
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18rpx 0;
	}

	.row-text {
		flex: 1;
		padding-right: 20rpx;
	}

	.row-title {
		display: block;
		font-size: 27rpx;
		color: #111827;
	}

	.row-sub {
		display: block;
		margin-top: 6rpx;
		font-size: 21rpx;
		line-height: 1.5;
		color: #a3aab6;
	}

	/* 文本生成风格胶囊 */
	.style-chips {
		display: flex;
		flex-wrap: wrap;
	}

	.style-chip {
		margin: 0 16rpx 10rpx 0;
		padding: 16rpx 40rpx;
		border-radius: 999rpx;
		background-color: #f4f6f9;
		border: 2rpx solid transparent;
	}

	.style-chip.on {
		background-color: #eef5ff;
		border-color: #2b7fff;
	}

	.style-chip-text {
		font-size: 26rpx;
		color: #5b6472;
	}

	.style-chip.on .style-chip-text {
		color: #2b7fff;
		font-weight: 600;
	}

	/* 1/2/3 分段 */
	.stepper {
		display: flex;
		padding: 6rpx;
		border-radius: 16rpx;
		background-color: #f4f6f9;
	}

	.step {
		width: 62rpx;
		height: 56rpx;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 12rpx;
	}

	.step.on {
		background-color: #ffffff;
		box-shadow: 0 2rpx 8rpx rgba(17, 24, 39, 0.08);
	}

	.step-text {
		font-size: 25rpx;
		color: #8b93a1;
	}

	.step.on .step-text {
		color: #2b7fff;
		font-weight: 600;
	}

	/* 提示块 */
	.notice {
		margin-top: 10rpx;
		padding: 20rpx 22rpx;
		border-radius: 18rpx;
		background-color: #f7f9fc;
	}

	.notice-text {
		font-size: 21rpx;
		line-height: 1.7;
		color: #8b93a1;
	}

	/* 采集时间点 */
	.slots {
		display: flex;
		flex-wrap: wrap;
	}

	.slot {
		margin: 0 16rpx 16rpx 0;
		padding: 16rpx 30rpx;
		border-radius: 999rpx;
		background-color: #f4f6f9;
		border: 2rpx solid transparent;
	}

	.slot.on {
		background-color: #eef5ff;
		border-color: #2b7fff;
	}

	.slot-text {
		font-size: 25rpx;
		color: #5b6472;
	}

	.slot.on .slot-text {
		color: #2b7fff;
		font-weight: 600;
	}

	/* 隐私 */
	.privacy-row {
		display: flex;
		align-items: flex-start;
		margin-bottom: 14rpx;
	}

	.dot {
		width: 8rpx;
		height: 8rpx;
		margin: 13rpx 16rpx 0 4rpx;
		border-radius: 50%;
		background-color: #c7cdd6;
		flex-shrink: 0;
	}

	.privacy-text {
		font-size: 23rpx;
		line-height: 1.7;
		color: #5b6472;
	}

	/* 底部操作条 */
	.footer-space {
		height: 220rpx;
	}

	.footer {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 18rpx 28rpx calc(24rpx + constant(safe-area-inset-bottom));
		padding-bottom: calc(24rpx + env(safe-area-inset-bottom));
		background-color: rgba(255, 255, 255, 0.97);
		border-top: 1rpx solid #eef0f4;
	}

	/* 页面最下方的版本号 */
	.version-bar {
		display: flex;
		justify-content: center;
		padding: 30rpx 0 calc(140rpx + env(safe-area-inset-bottom));
	}
	.version-text {
		font-size: 22rpx;
		color: #b6bcc6;
	}

	.test-msg {
		display: block;
		margin-bottom: 14rpx;
		font-size: 21rpx;
		line-height: 1.5;
		color: #6b7280;
		word-break: break-all;
	}

	.footer-btns {
		display: flex;
	}

	.btn {
		flex: 1;
		height: 92rpx;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 999rpx;
	}

	.btn.primary {
		background-image: linear-gradient(135deg, #2b7fff 0%, #5a9bff 100%);
		box-shadow: 0 10rpx 24rpx rgba(43, 127, 255, 0.28);
		margin-left: 16rpx;
		flex: 1.4;
	}

	.btn.ghost {
		background-color: #f4f6f9;
	}

	.btn-hover {
		opacity: 0.82;
	}

	.btn-text {
		font-size: 28rpx;
		font-weight: 600;
		color: #ffffff;
	}

	.btn-text.ghost-text {
		color: #5b6472;
		font-weight: 500;
	}
</style>
