import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` proxies the API and login to the server on :3001
// (run the server with DEMO=1 for example data).
const target = process.env.API_URL || 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/login': { target, changeOrigin: true },
      '/logout': { target, changeOrigin: true }
    }
  }
});
