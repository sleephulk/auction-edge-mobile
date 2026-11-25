import { defineConfig } from 'vite';

// The app is served at https://app.auctionedge.in/pocket/ and calls
// /api/mobile/* on the same origin. In dev the same paths are proxied to the
// live server, so the login and the data are the real ones.
export default defineConfig({
  base: '/pocket/',
  server: {
    port: 5183,
    proxy: {
      '/api': { target: 'https://app.auctionedge.in', changeOrigin: true },
    },
  },
  build: { target: 'es2022', sourcemap: false },
});
