<template>
	<view class="page">
		<view v-if="!days.length" class="empty">
			<text class="empty-emoji">📔</text>
			<text class="empty-text">还没有任何日志</text>
			<text class="empty-hint">回到首页记录今天，生成第一篇</text>
		</view>

		<view
			v-for="d in days"
			:key="d.day"
			class="item"
			hover-class="item-hover"
			@longpress="askDelete(d.day)"
			@click="open(d.day)"
		>
			<view class="item-left">
				<text class="item-date">{{ fmtDayCN(d.day) }}</text>
				<text class="item-sub">
					{{ d.hasLog ? '已生成' : '未生成' }} · 定位 {{ d.checkins }} 条 · 照片 {{ d.photos }} 张
				</text>
			</view>
			<view class="badge" :class="d.hasLog ? 'badge-ok' : 'badge-todo'">
				<text class="badge-text">{{ d.hasLog ? '✓' : '…' }}</text>
			</view>
		</view>

		<text class="tip">长按某天可删除（日志文件与该天数据一起删）</text>
	</view>
</template>

<script setup>
	import { ref } from 'vue'
	import { onShow } from '@dcloudio/uni-app'
	import { listDays, loadDay, removeDay } from '@/utils/db.js'
	import { fmtDayCN } from '@/utils/day.js'

	const days = ref([])

	function refresh() {
		days.value = listDays().map(day => {
			const d = loadDay(day) || {}
			return {
				day,
				hasLog: !!d.log,
				checkins: (d.checkins || []).length,
				photos: (d.photos || []).length
			}
		})
	}

	function open(day) {
		uni.navigateTo({ url: `/pages/preview/preview?day=${day}` })
	}

	function askDelete(day) {
		uni.showModal({
			title: '删除日志',
			content: `删除 ${day} 的全部记录与文件？不可恢复。`,
			confirmColor: '#e5484d',
			success: r => {
				if (!r.confirm) return
				const d = loadDay(day)
				// #ifdef APP-PLUS
				if (d && d.log && d.log.filePath && d.log.filePath.startsWith('_doc/')) {
					plus.io.resolveLocalFileSystemURL(d.log.filePath, e => e.remove(), () => {})
				}
				// #endif
				removeDay(day)
				refresh()
			}
		})
	}

	onShow(refresh)
</script>

<style>
	.page {
		min-height: 100vh;
		padding: 24rpx 24rpx 60rpx;
		box-sizing: border-box;
		background-color: #f2f3f5;
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding-top: 200rpx;
	}

	.empty-emoji {
		font-size: 90rpx;
	}

	.empty-text {
		margin-top: 24rpx;
		font-size: 30rpx;
		color: #4b5563;
	}

	.empty-hint {
		margin-top: 12rpx;
		font-size: 24rpx;
		color: #9ca3af;
	}

	.item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 20rpx;
		padding: 30rpx;
		border-radius: 24rpx;
		background-color: #ffffff;
	}

	.item-hover {
		background-color: #f5f8ff;
	}

	.item-date {
		font-size: 30rpx;
		font-weight: 600;
		color: #111827;
	}

	.item-sub {
		display: block;
		margin-top: 8rpx;
		font-size: 22rpx;
		color: #9ca3af;
	}

	.badge {
		width: 52rpx;
		height: 52rpx;
		border-radius: 50%;
		text-align: center;
		line-height: 52rpx;
	}

	.badge-ok {
		background-color: #e6f7ed;
	}

	.badge-ok .badge-text {
		color: #18a058;
	}

	.badge-todo {
		background-color: #f2f3f5;
	}

	.badge-todo .badge-text {
		color: #9ca3af;
	}

	.tip {
		display: block;
		margin-top: 16rpx;
		text-align: center;
		font-size: 22rpx;
		color: #c0c4cc;
	}
</style>
