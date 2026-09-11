import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  // En desarrollo, el servidor de Vite hace lo que nginx hace en producción
  // (ver nginx.conf): recibe `/api` y `/uploads` en su propio origen y los
  // reenvía al backend. Así el navegador nunca habla con otro puerto.
  //
  // Sin esto, el frontend llamaba a `http://localhost:3000` escrito a fuego. Eso
  // funciona en tu propia máquina, pero al abrir la app desde otro dispositivo
  // (un túnel de VS Code, ngrok, el celular en la misma red) ese `localhost` es
  // el propio dispositivo, no el servidor, y ninguna petición llegaba.
  //
  // De paso desaparece CORS en desarrollo: todo es del mismo origen, igual que
  // en producción, y basta con exponer UN puerto (el 5173).
  //
  // Sin `xfwd` a propósito: así pasa intacta la X-Forwarded-For que ponga el
  // túnel y el backend (TRUST_PROXY=1) ve la IP real de cada persona. Con xfwd,
  // Vite añadiría 127.0.0.1 al final y todos compartirían IP — y límite de
  // peticiones.
  server: {
    proxy: {
      '/api':     { target: 'http://localhost:3000' },
      '/uploads': { target: 'http://localhost:3000' },
    },
    // Vite 6 rechaza con 403 cualquier Host que no sea localhost (protección
    // contra DNS rebinding). Se permiten SOLO los dominios de túnel que el
    // equipo usa para abrir la app desde otros dispositivos: el reenvío de
    // puertos de VS Code y ngrok (ver .env.example). No se usa `true`: eso
    // apagaría la protección para cualquier dominio.
    allowedHosts: ['.devtunnels.ms', '.ngrok-free.app'],
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;

          // Charts — recharts pulls in d3-* and victory-* internally
          if (id.includes('recharts') || id.includes('/d3-') || id.includes('d3/')) {
            return 'vendor-charts';
          }
          // Animation
          if (id.includes('/motion/') || id.includes('framer-motion')) {
            return 'vendor-motion';
          }
          // Radix UI primitives (all @radix-ui/* packages)
          if (id.includes('@radix-ui')) {
            return 'vendor-radix';
          }
          // React core — keep separate so browsers can cache across deploys
          if (id.includes('react-dom') || id.includes('/react/')) {
            return 'vendor-react';
          }
          // Icon library
          if (id.includes('lucide-react')) {
            return 'vendor-icons';
          }
        },
      },
    },
  },
})
