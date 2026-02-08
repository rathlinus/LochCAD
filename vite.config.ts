import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 3800,
    allowedHosts: ['lochcad.de', 'www.lochcad.de'],
  },
});
