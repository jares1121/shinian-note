import { createApp } from 'vue'
import FloatApp from './FloatApp.vue'
import './style.css'
import { applyTheme } from './theme'

applyTheme()

createApp(FloatApp).mount('#app')
