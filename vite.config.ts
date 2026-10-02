import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages sert l'app sous /training-app/ ; surchargeable via VITE_BASE (cf. DECISIONS.md).
export default defineConfig(({ command }) => ({
  base: process.env.VITE_BASE ?? (command === 'build' ? '/training-app/' : '/'),
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
}));
