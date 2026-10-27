// 大模型调用：OpenAI 兼容 /chat/completions，用户自己的 Key，直连不经中间服务器
// 选片 + 内容理解 + 散文生成合并为一次调用（文档已确认的决策）
import { readAsDataURL, compressForModel, pickForModel } from './media.js'
import { CapacitorHttp } from '@capacitor/core'
import { isShell } from './shell.js'

const KEY_STORE = 'el:apikey'
const XOR_KEY = 'everylog-local-xor-v1' // 本地混淆；真·Keystore/Keychain 需原生插件，二期替换

// 简易可逆混淆：至少保证明文不出现在 storage / 备份里
function maskKey(raw) {
	let out = ''
	for (let i = 0; i < raw.length; i++) {
		out += String.fromCharCode(raw.charCodeAt(i) ^ XOR_KEY.charCodeAt(i % XOR_KEY.length))
	}
	return uni.arrayBufferToBase64(
		Uint8Array.from([...out].map(c => c.charCodeAt(0))).buffer
	)
}
function unmaskKey(masked) {
	const bin = Array.from(new Uint8Array(uni.base64ToArrayBuffer(masked)))
	let out = ''
	for (let i = 0; i < bin.length; i++) {
		out += String.fromCharCode(bin[i] ^ XOR_KEY.charCodeAt(i % XOR_KEY.length))
	}
	return out
}

// 预设服务商：一键填入地址与模型，Key 仍然只由用户自己粘贴
// 所有预设都走 OpenAI 兼容协议（/chat/completions），换成别家只需改 Base URL + 模型名
export const PRESETS = [
	{
		id: 'deepseek',
		name: 'DeepSeek',
		baseUrl: 'https://api.deepseek.com',
		model: 'deepseek-v4-flash',
		// 官方 2026-07-24 起停用 deepseek-chat / deepseek-reasoner，只剩 v4 两个
		models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
		vision: false,
		note: '便宜、中文好，但不识图：生成时只送文字与位置。模型名是 deepseek-v4-flash，不是 deepseek-flash'
	},
	{
		id: 'qwen',
		name: '通义千问',
		baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
		model: 'qwen-vl-plus',
		models: ['qwen-vl-plus', 'qwen-vl-max', 'qwen-plus'],
		vision: true,
		note: '阿里云百炼，支持识图，国内直连稳定'
	},
	{
		id: 'zhipu',
		name: '智谱 GLM',
		baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
		model: 'glm-4v-plus',
		models: ['glm-4v-plus', 'glm-4v-flash', 'glm-4-plus'],
		vision: true,
		note: '支持识图，有免费额度'
	},
	{
		id: 'moonshot',
		name: 'Kimi',
		baseUrl: 'https://api.moonshot.cn/v1',
		model: 'moonshot-v1-8k-vision-preview',
		models: ['moonshot-v1-8k-vision-preview', 'moonshot-v1-32k-vision-preview'],
		vision: true,
		note: '长文本强，识图模型需账号有权限'
	},
	{
		id: 'openai',
		name: 'OpenAI',
		baseUrl: 'https://api.openai.com/v1',
		model: 'gpt-4o-mini',
		models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
		vision: true,
		note: '国内需代理，手机端要能连通'
	},
	{
		id: 'siliconflow',
		name: '硅基流动',
		baseUrl: 'https://api.siliconflow.cn/v1',
		model: 'Qwen/Qwen2.5-VL-7B-Instruct',
		models: ['Qwen/Qwen2.5-VL-7B-Instruct', 'deepseek-ai/DeepSeek-V3'],
		vision: true,
		note: '一个 Key 调多家开源模型，有免费额度'
	},
	{
		id: 'ollama',
		name: '本地 Ollama',
		baseUrl: 'http://192.168.1.100:11434/v1',
		model: 'qwen2.5vl:7b',
		models: ['qwen2.5vl:7b', 'llama3.2-vision'],
		vision: true,
		note: '换成电脑的局域网 IP，手机与电脑同一 Wi-Fi'
	},
	{
		id: 'custom',
		name: '自定义',
		baseUrl: '',
		model: '',
		models: [],
		vision: true,
		note: '任何 OpenAI 兼容网关都可以，填到 /v1 这一级'
	}
]

// 清理模型名：去掉零宽字符、把全角/中文破折号统一成半角连字符
// 中文输入法很容易把 "-" 打成 "－"（全角）或 "–"（半角长横），肉眼几乎看不出，但服务端会 400
export function cleanModelName(v) {
	return String(v || '')
		.replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
		.replace(/[\uff0d\u2010-\u2015\u2212]/g, '-')
		.replace(/[\uff0e\u3002]/g, '.')
		.replace(/\s+/g, '')
		.trim()
}

// 老版本遗留 / 常见写错的 DeepSeek 模型名 → 当前可用模型
const DEEPSEEK_ALIAS = {
	'deepseek': 'deepseek-v4-flash',
	'deepseek-flash': 'deepseek-v4-flash',
	'deepseek-pro': 'deepseek-v4-pro',
	'deepseek-v4': 'deepseek-v4-flash',
	'deepseek-chat': 'deepseek-v4-flash',
	'deepseek-reasoner': 'deepseek-v4-flash',
	'deepseek-r1': 'deepseek-v4-flash'
}

export function fixKnownModel(baseUrl, model) {
	const b = String(baseUrl || '')
	const m = cleanModelName(model)
	if (b.indexOf('api.deepseek.com') < 0) return m
	const low = m.toLowerCase()
	if (!low) return m
	if (DEEPSEEK_ALIAS[low]) return DEEPSEEK_ALIAS[low]
	// 已经是 v4 系列就原样保留
	if (/^deepseek-v\d+-(flash|pro)$/.test(low)) return low
	// 其它 deepseek 开头但没带版本号的（deepseek-flash、deepseek- 这类截断或旧写法）→ 兜底到 v4-flash
	if (/^deepseek/.test(low) && !/^deepseek-v\d+/.test(low)) return 'deepseek-v4-flash'
	return m
}

export function loadCfg() {
	const c = uni.getStorageSync('el:llmcfg') || {}
	const baseUrl = c.baseUrl || 'https://api.deepseek.com'
	return {
		baseUrl,
		model: fixKnownModel(baseUrl, c.model || 'deepseek-v4-flash'),
		vision: c.vision !== false,
		maxPhotos: c.maxPhotos || 3,
		presetId: c.presetId || 'deepseek',
		style: c.style || 'formal'
	}
}

export function saveCfg(cfg) {
	uni.setStorageSync('el:llmcfg', cfg)
}

export function setApiKey(raw) {
	uni.setStorageSync(KEY_STORE, raw ? maskKey(raw.trim()) : '')
}

export function getApiKey() {
	const m = uni.getStorageSync(KEY_STORE)
	return m ? unmaskKey(m) : ''
}

function endpoint(baseUrl) {
	const b = baseUrl.trim().replace(/\/+$/, '')
	return /\/v\d+$/.test(b) ? `${b}/chat/completions` : `${b}/v1/chat/completions`
}

const PROMPT_TASK = `你是一位写日记的人本人。用户给你一天的素材：若干张按时间排列的照片（含拍摄时刻与可能的位置/地标）、当天的行程轨迹（时间 + 地标名）、以及几段随手记文字（可能为空）。请只输出一个 JSON：
1. 为每张照片写一句"它记录了什么"（客观、具体、有细节，不要抽象评价，不要写"照片"三个字）；如果这张照片没有给出真实定位，仔细看画面里能判断位置的线索（店铺招牌、路牌、门牌、屏幕上的地名、标志性建筑），把推断出的地名写进对应的 place 字段；看不出就留空，绝不编造；
2. 按时间顺序列出当天的行程节点：几时在什么地方、做了什么（合计不超过 6 条，位置没变就合并）；照片地点真实定位与你推断的地名都要按时序放进 nodes；
3. 写一篇 350 字以内的第一人称日记。日记正文按「上午 → 中午 → 下午 → 晚上」的顺序组织：每个时段的内容独立成一段，段与段之间用一个换行符分隔；每段开头自然带出时段词（如「上午……」），该时段没有素材就整段跳过；不要输出「上午：」这种标签加冒号的写法。每段经历提到之前，要先带出它对应的地点名（用真实定位的地名，或你从画面推断并填入 place 的地名），即「先地点、后事情」；推断出的地点要带「附近」「路过」「看到」这类不确定措辞。

通用规则（重要）：
- 不要罗列时间点，不要写"几点几分"；行程节点单独放 nodes 字段，正文里不点名时刻，但要点名地点；
- 给出的真实地名只能照抄不能替换；推断地名不得写成确定事实；
- 照片内容与截图里的信息自然融入叙述，不要写"照片里""截图显示"这类标注语；
- 有人工文字的段落优先采用原文意思，空的段落靠地标轨迹与照片补足。

`

// 三种文风（设置页可选，默认正式）
export const STYLE_OPTIONS = [
	{ id: 'formal', label: '正式', note: '平实记录事实，不写内心戏（默认）' },
	{ id: 'lyrical', label: '抒情', note: '有温度、有画面感，可以写心情与氛围' },
	{ id: 'xiaozi', label: '小资', note: '轻松文艺的生活情调，短句、俏皮、小确幸' }
]

const STYLE_RULES = {
	formal: `文风要求（正式）：
- 文风严肃、平实、正式，以记录事实为主：做了什么、去了哪里、看到了什么；
- 不要揣测主人的内心与情绪：不写"我感到""我想""大概是因为""内心"这类心理描写；
- 只允许轻微抒情：全文最多一两处点到为止的收尾语气，不升华、不喊口号、不滥用感叹号；
- 用户随手记里已写出的感受或情绪，可以顺着原文意思略微展开一句，但不得加码拔高，不得无中生有。`,
	lyrical: `文风要求（抒情）：
- 文风抒情、有温度，可以用光线、天气、气味等细节烘托氛围；
- 可以写「我」的心情与感触，但以当天真实发生的事为骨架，感受要从事实里自然长出来；
- 允许适度的比喻与收尾感怀，但不堆砌辞藻、不喊口号，每段一到两处即可；
- 用户随手记里已写出的感受，顺着原文意思展开，不得虚构没发生过的事。`,
	xiaozi: `文风要求（小资）：
- 文风轻松文艺，带一点生活情调：咖啡、街角、书店、晚风这类日常小确幸可以写；
- 语气松弛、略带自嘲或俏皮，多用短句，句子干净利落；
- 仍然以当天真实发生的事与地点为骨架，不虚构没发生过的事；
- 用户随手记里已写出的感受，顺着原文意思展开，不得无中生有。`
}

function systemPrompt(style) {
	return PROMPT_TASK + (STYLE_RULES[style] || STYLE_RULES.formal) +
		`\n输出格式：{"photos":[{"i":序号,"meaning":"一句话","place":"照片无真实定位时才填，画面里能确认的地名"}],"nodes":[{"time":"09:00","place":"地标","doing":"在做什么"}],"diary":"日记正文"}`
}

const VISION_PROMPT = `你看图说一句话：这张图记录了什么？只输出一句不超过 30 字的中文描述，写具体内容（人/物/场景/界面上的关键信息），不要加"照片中""这张图"之类的开头，不要输出标点以外的格式。若画面里有能判断位置的明显文字（店铺招牌、路牌、屏幕上的地名），在句子末尾加「 @地名」；看不出来就不要加。`

// 把当天的素材整理成给模型的纯文本上下文
function buildUserText(data, slotHours) {
	const segText = [
		data.segments.morning && `上午：${String(data.segments.morning).replace(/^（示例）[^。]*。?\s*/, '')}`,
		data.segments.noon && `中午：${String(data.segments.noon).replace(/^（示例）[^。]*。?\s*/, '')}`,
		data.segments.afternoon && `下午：${String(data.segments.afternoon).replace(/^（示例）[^。]*。?\s*/, '')}`,
		data.segments.evening && `晚上：${String(data.segments.evening).replace(/^（示例）[^。]*。?\s*/, '')}`
	].filter(s => s && s.slice(3).trim()).join('\n') || '（今天没有人工输入）'

	const photos = (data.photos || []).map((p, i) => {
		const d = p.takenAt ? new Date(p.takenAt) : null
		const t = d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '时间未知'
		const kind = p.kind === 'screenshot' ? '截图' : '照片'
		const spot = p.place
			? ` @${p.place}${p.coordSource === 'ai' ? '（画面推断）' : ''}`
			: p.latitude
				? ` @${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`
				: '（无真实定位：请从画面里的招牌/路牌/屏幕文字找地名线索，填入 place）'
		return `[${i}] ${t} ${kind}${spot}${p.meaning ? ' · 已读：' + p.meaning : ''}`
	}).join('\n') || '（今天没有照片）'

	const track = (data.track || [])
		.filter(c => c.place || !c.sameAsPrev)
		.map(c => {
			const d = new Date(c.ts)
			const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
			const spot = c.place || (c.latitude != null ? `${c.latitude.toFixed(3)},${c.longitude.toFixed(3)}` : '位置未知')
			return `${t} ${spot}${c.sameAsPrev ? '（与上一站相同）' : ''}`
		})
		.join('\n') || '（没有行程记录）'

	// 4 个时间点各自的位置：直接作为事实给模型，避免它自己编地名
	const slotLines = (data.slotSummary || [])
		.filter(s => s.place)
		.map(s => `${String(s.hour).padStart(2, '0')}:00 ${s.place}`)
		.join('\n') || '（没有点位位置）'

	const cfg = loadCfg()
	return [
		`最多可选照片数 N = ${cfg.maxPhotos}`,
		`采集时间点（小时）：${slotHours.join(', ')}`,
		`各时间点位置（这是真实定位，地名必须照抄，不要改写成别的城市或地标）：\n${slotLines}`,
		`当天轨迹：\n${track}`,
		`照片清单（按序号）：\n${photos}`,
		`随手记：\n${segText}`
	].join('\n\n')
}

async function photoToDataUrl(path) {
	// 原生壳优先走原图（content:// 或原路径，原生端解码，最多长边 4096）
	if (isShell()) {
		try {
			const { readImageOriginal } = await import('./gallery.js')
			const original = await readImageOriginal(path, 4096)
			if (original) return original
		} catch (e) {
			// 落回压缩路径
		}
	}
	const p = await compressForModel(path)
	const url = await readAsDataURL(p)
	return url
}

function extractJson(text) {
	const m = text.match(/\{[\s\S]*\}/)
	if (!m) throw new Error('模型没有返回 JSON：' + text.slice(0, 120))
	return JSON.parse(m[0])
}

function request(url, payload, apiKey) {
	// 本地 APK 壳：走原生 HTTP，绕开 WebView 的 CORS 限制（各种中转站都能直连）
	if (isShell()) {
		return CapacitorHttp.post({
			url,
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`
			},
			data: payload,
			connectTimeout: 30000,
			readTimeout: 120000
		}).then(res => {
			const body = typeof res.data === 'string' ? safeJson(res.data) : res.data
			if (res.status >= 200 && res.status < 300) return body
			const msg = body && body.error && body.error.message
			throw new Error(`API ${res.status}: ${msg || JSON.stringify(body).slice(0, 200)}`)
		}).catch(e => {
			throw new Error(e.message || '网络请求失败')
		})
	}
	return new Promise((resolve, reject) => {
		uni.request({
			url,
			method: 'POST',
			timeout: 120000,
			header: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`
			},
			data: payload,
			success: res => {
				if (res.statusCode >= 200 && res.statusCode < 300) return resolve(res.data)
				const msg = res.data && res.data.error && res.data.error.message
				reject(new Error(`API ${res.statusCode}: ${msg || JSON.stringify(res.data).slice(0, 200)}`))
			},
			fail: e => reject(new Error(e.errMsg || '网络请求失败'))
		})
	})
}

function safeJson(t) {
	try { return JSON.parse(t) } catch (e) { return t }
}

/**
 * 单张图理解：拿到 dataURL 后让视觉模型给一句话含义。
 * 失败不抛错（返回空串），保证批量处理不被单张图拖垮。
 * @param {string} dataUrl
 * @returns {Promise<string>}
 */
export async function understandImage(dataUrl) {
	const cfg = loadCfg()
	const apiKey = getApiKey()
	if (!apiKey || !cfg.vision || !dataUrl) return ''
	try {
		const res = await request(endpoint(cfg.baseUrl), {
			model: cfg.model,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: VISION_PROMPT },
						{ type: 'image_url', image_url: { url: dataUrl } }
					]
				}
			],
			temperature: 0.4,
			max_tokens: 120
		}, apiKey)
		const txt = res.choices && res.choices[0] && res.choices[0].message
			? String(res.choices[0].message.content || '')
			: ''
		return txt.trim().replace(/^["“]|["”]$/g, '').slice(0, 120)
	} catch (e) {
		console.warn('单图理解失败', e && e.message)
		return ''
	}
}

/**
 * 生成今日散文日记（一次调用完成选片 + 行程梳理 + 成文）
 * @returns {Promise<{diary:string, photoPaths:string[], nodes:Array}>}
 */
export async function generateDiary(data, slotHours) {
	const cfg = loadCfg()
	const apiKey = getApiKey()
	if (!apiKey) throw new Error('还没有配置 API Key，请到「设置」填写')
	if (!data.photos || !data.photos.length) throw new Error('今天还没有照片，先加几张再生成')

	// 提交 AI 的图用原图：优先相册原图地址（content://），没有原图地址才用界面缩略副本
	const paths = await pickForModel(data.photos.map(p => p.src || p.path))
	const images = []
	for (const p of paths) {
		if (cfg.vision) {
			try {
				images.push(await photoToDataUrl(p))
			} catch (e) {
				images.push(null) // 单张读失败不影响整体
			}
		}
	}

	const text = buildUserText(data, slotHours)
	const content = [{ type: 'text', text }]
	for (const u of images) {
		if (u) content.push({ type: 'image_url', image_url: { url: u } })
	}

	const payload = {
		model: cfg.model,
		messages: [
			{ role: 'system', content: systemPrompt(cfg.style) },
			{ role: 'user', content: cfg.vision ? content : text }
		],
		temperature: 0.6
	}

	const res = await request(endpoint(cfg.baseUrl), payload, apiKey)
	const raw = res.choices && res.choices[0] && res.choices[0].message
		? res.choices[0].message.content
		: ''
	if (!raw) throw new Error('API 返回为空')

	const parsed = extractJson(raw)
	const diary = (parsed.diary || '').trim()
	if (!diary) throw new Error('模型没有生成日记正文')

	// 本地兜底选片：模型没选或选越界时，均匀取 maxPhotos 张
	const chosen = Array.isArray(parsed.photos)
		? parsed.photos
			.map(x => (typeof x === 'object' && x ? Number(x.i) : Number(x)))
			.filter(n => Number.isInteger(n) && n >= 0 && n < paths.length)
		: []
	let idx = [...new Set(chosen)].slice(0, cfg.maxPhotos)
	if (!idx.length) {
		const step = Math.max(1, Math.floor(paths.length / cfg.maxPhotos))
		for (let i = 0; i < paths.length && idx.length < cfg.maxPhotos; i += step) idx.push(i)
	}

	// 把模型给的「一句话含义」回写到当天照片上，后面列表与导出都能用；
	// 无真实定位的照片，模型从画面里认出的地名（place）也一并回写，只补空位、不覆盖真实定位
	if (Array.isArray(parsed.photos)) {
		for (const x of parsed.photos) {
			if (!x || typeof x !== 'object') continue
			const i = Number(x.i)
			if (!data.photos[i]) continue
			if (x.meaning) data.photos[i].meaning = String(x.meaning).slice(0, 120)
			const guess = String(x.place || '').trim()
			if (guess && !data.photos[i].place) {
				data.photos[i].place = guess.slice(0, 40)
				data.photos[i].coordSource = 'ai'
			}
		}
	}

	const nodes = Array.isArray(parsed.nodes)
		? parsed.nodes
			.filter(n => n && (n.place || n.doing))
			.slice(0, 8)
			.map(n => ({
				time: String(n.time || '').slice(0, 5),
				place: String(n.place || '').slice(0, 40),
				doing: String(n.doing || '').slice(0, 60)
			}))
		: []

	// 模型没给节点、或节点丢了地名时，用本地轨迹里的真实地名补齐：
	// 地名是我们自己逆地理出来的事实，不该让模型决定有没有
	const realPlaces = []
	for (const c of data.track || []) {
		if (c.place && !realPlaces.includes(c.place)) realPlaces.push(c.place)
	}
	if (!nodes.length && realPlaces.length) {
		for (const c of data.track || []) {
			const last = nodes[nodes.length - 1]
			if (last && last.place === c.place) continue
			nodes.push({ time: c.t || '', place: c.place, doing: '' })
		}
	}
	for (const n of nodes) {
		if (n.place) continue
		// 按时间就近补一个真实地名
		const mins = /^(\d{1,2}):(\d{2})$/.test(n.time) ? +n.time.slice(0, 2) * 60 + +n.time.slice(3) : null
		let best = null
		let bestDelta = Infinity
		for (const c of data.track || []) {
			if (!c.place) continue
			if (mins == null) {
				best = c
				break
			}
			const ch = new Date(c.ts).getHours() * 60 + new Date(c.ts).getMinutes()
			const dd = Math.abs(ch - mins)
			if (dd < bestDelta) {
				bestDelta = dd
				best = c
			}
		}
		if (best) n.place = best.place
	}

	return { diary, photoPaths: idx.map(i => paths[i]), nodes }
}

// 设置页「测试连接」
export async function ping() {
	const cfg = loadCfg()
	const apiKey = getApiKey()
	if (!apiKey) throw new Error('先填写 API Key')
	const url = endpoint(cfg.baseUrl)
	const sent = `model=${cfg.model}｜${url}`
	try {
		const res = await request(url, {
			model: cfg.model,
			messages: [{ role: 'user', content: '回复"ok"两个字母即可' }],
			max_tokens: 5
		}, apiKey)
		const txt = res.choices && res.choices[0] && res.choices[0].message
			? res.choices[0].message.content
			: ''
		const model = (res.model ? `（服务端模型：${res.model}）` : '')
		return (txt || '(空回复)') + model
	} catch (e) {
		// 把「实际发出去的模型名和地址」一起带出来，便于对照报错
		throw new Error(`${e.message || '请求失败'}　【本次发送 ${sent}】`)
	}
}

// 给界面展示：这条配置最终会请求哪个地址
export function describeEndpoint(baseUrl) {
	return endpoint(baseUrl)
}
