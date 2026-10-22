import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { applyTheme } from './theme'

// 启动时恢复主题（深/浅/跟随系统）与主题色，避免闪烁
applyTheme()

createApp(App).mount('#app')
