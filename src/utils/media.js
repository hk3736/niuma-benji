// 照片：选择 → 落盘（temp 路径重启会丢）→ 压缩 → base64（给大模型看图）
import { isShell, pickImages, savePhotoToData, dataUrlFrom, compressToDataUrl } from './shell.js'

export function choosePhotos(max = 9) {
	if (isShell()) return pickImages(max)
	return new Promise((resolve, reject) => {
		uni.chooseImage({
			count: max,
			sizeType: ['compressed'],
			success: res => resolve(res.tempFilePaths || []),
			fail: reject
		})
	})
}

// 把临时文件拷到应用沙盒，重启不丢
export function persistPhoto(tempPath) {
	if (isShell()) return savePhotoToData(tempPath)
	return new Promise((resolve, reject) => {
		uni.saveFile({
			tempFilePath: tempPath,
			success: res => resolve(res.savedFilePath),
			fail: () => resolve(tempPath) // 保存失败就先用临时路径，别卡流程
		})
	})
}

function isApp() {
	// #ifdef APP-PLUS
	return true
	// #endif
	// #ifndef APP-PLUS
	return false
	// #endif
}

// 读本地文件为 dataURL（App 用 plus.io，H5 用 fetch+FileReader）
export function readAsDataURL(path) {
	if (isShell()) return dataUrlFrom(path)
	if (isApp()) {
		return new Promise((resolve, reject) => {
			plus.io.resolveLocalFileSystemURL(
				path,
				entry => entry.file(file => {
					const reader = new plus.io.FileReader()
					reader.onloadend = e => resolve(e.target.result)
					reader.onerror = reject
					reader.readAsDataURL(file)
				}, reject),
				reject
			)
		})
	}
	return new Promise((resolve, reject) => {
		fetch(path)
			.then(r => r.blob())
			.then(blob => {
				const fr = new FileReader()
				fr.onload = () => resolve(fr.result)
				fr.onerror = reject
				fr.readAsDataURL(blob)
			})
			.catch(reject)
	})
}

// 压缩到适合发模型的尺寸/体积，失败则返回原图
export function compressForModel(path) {
	// 原生壳里压到 1024 长边、0.6 质量，控制 token 与流量
	if (isShell()) return compressToDataUrl(path, 1024, 0.6)
	return new Promise(resolve => {
		if (!isApp()) return resolve(path)
		uni.compressImage({
			src: path,
			quality: 40,
			success: res => resolve(res.tempFilePath || path),
			fail: () => resolve(path)
		})
	})
}

// 粗筛：照片太多先本地截断，控制 token（文档风险表：>10 张先本地筛）
export async function pickForModel(paths, limit = 10) {
	const step = Math.max(1, Math.ceil(paths.length / limit))
	const out = []
	for (let i = 0; i < paths.length; i += step) out.push(paths[i])
	return out.slice(0, limit)
}
