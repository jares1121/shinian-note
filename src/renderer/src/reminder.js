import { createApp } from 'vue'
import ReminderApp from './ReminderApp.vue'
import './style.css'
import { applyTheme } from './theme'

applyTheme()

createApp(ReminderApp).mount('#app')
