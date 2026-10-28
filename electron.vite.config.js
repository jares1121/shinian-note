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
          reminder: resolve('src/preload/reminder.js'),
          float: resolve('src/preload/float.js')
        },
        output: {
          // ESM preload 打进 asar 后无法加载（Node ESM loader 不支持 asar），
          // 必须输出 CJS，扩展名用 .cjs 避免被 package.json 的 type:module 误判
          format: 'cjs',
          entryFileNames: '[name].cjs'
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
          reminder: resolve('src/renderer/reminder.html'),
          float: resolve('src/renderer/float.html')
        }
      }
    }
  }
})
