<script>
	import { seedDemo } from './utils/db.js'

	export default {
		onLaunch() {
			// 开发模式写入一次示例数据，方便演示；正式使用可整段删除
			// #ifdef H5
			if (import.meta.env.DEV) seedDemo()
			// #endif
			console.log('App Launch')
		},
		onShow() {
			console.log('App Show')
		},
		onHide() {
			console.log('App Hide')
		}
	}
</script>

<style>
	/* 每个页面公共 css */
	page {
		background-color: #f4f6f9;
		color: #111827;
		font-family: -apple-system, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
	}

	/* 统一一点击态手感 */
	button::after {
		border: none;
	}
</style>
