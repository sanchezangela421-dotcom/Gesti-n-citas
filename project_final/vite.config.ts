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
