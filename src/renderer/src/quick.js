import { createApp } from 'vue'
import QuickApp from './QuickApp.vue'
import './style.css'
import { applyTheme } from './theme'

applyTheme()

createApp(QuickApp).mount('#app')
