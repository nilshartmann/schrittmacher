import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // Im SPA-Modus liefert der Server nur eine leere Seite aus, gerendert wird im Browser.
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
  ],
});
