import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.js'),
          quick: resolve('src/preload/quick.js'),
          reminder: resolve('src/preload/reminder.js')
        }
      }
    }
  },
  renderer: {
    plugins: [vue(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          quick: resolve('src/renderer/quick.html'),
          reminder: resolve('src/renderer/reminder.html')
        }
      }
    }
  }
})
