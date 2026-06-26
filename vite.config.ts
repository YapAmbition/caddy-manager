import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'

const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'))
const basePath = config.frontend.basePath
const serverPort = config.server.port

export default defineConfig({
  plugins: [react()],
  base: basePath === '/' ? '/' : `${basePath}/`,
  define: {
    __BASE_PATH__: JSON.stringify(basePath === '/' ? '' : basePath),
  },
  server: {
    port: config.frontend.port,
    proxy: {
      [`${basePath}/api`]: {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
      },
    },
  },
})
