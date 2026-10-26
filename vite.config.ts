import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      ...(process.env.VITE_USE_FIREBASE_EMULATORS === 'true' ? {
        proxy: {
          '/api/account': {
            target: 'http://127.0.0.1:5001',
            changeOrigin: true,
            rewrite: (url: string) => url.replace(/^\/api\/account/, '/demo-racepulseph/asia-southeast1/accountApi'),
            configure: (proxy) => {
              proxy.on('proxyReq', (proxyRequest, request) => {
                // server.ts parses JSON before Vite's middleware. Restore that
                // consumed body when forwarding; plain Vite requests still stream.
                const body = (request as typeof request & { body?: unknown }).body;
                if (body !== undefined && request.headers['content-type']?.includes('application/json')) {
                  const data = JSON.stringify(body);
                  proxyRequest.setHeader('Content-Length', Buffer.byteLength(data));
                  proxyRequest.write(data);
                }
              });
            },
          },
        },
      } : {}),
      fs: {
        deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.secret*'],
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
