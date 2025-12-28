import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  root: './',
  build: {
    outDir: 'assets',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'list-records': resolve(__dirname, 'src/components/list-records.html'),
        'create-records': resolve(__dirname, 'src/components/create-records.html'),
        'update-record': resolve(__dirname, 'src/components/update-record.html'),
        'get-record': resolve(__dirname, 'src/components/get-record.html'),
        'display-records-for-table': resolve(__dirname, 'src/components/display-records-for-table.html'),
        'preview': resolve(__dirname, 'src/dev/preview.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.html')) {
            return '[name][extname]';
          }
          return '[name]-[hash][extname]';
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5173,
    open: '/src/dev/preview.html',
  }
});

