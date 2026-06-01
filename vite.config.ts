import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/GoldenTimeAED/',
  server: {
    proxy: {
      // 로컬 개발 시: /api/aed → 안전데이터포털 (CORS 우회)
      '/api/aed': {
        target: 'https://www.safetydata.go.kr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/aed/, '/V2/api/DSSP-IF-00068'),
      },
    },
  },
})
