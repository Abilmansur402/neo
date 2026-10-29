/**
 * Tailwind CSS v4 is configured CSS-first in src/index.css (@theme block).
 * This file exists for editor tooling and documents the design tokens.
 */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        porcelain: '#F8FAFC',
        slate: { 950: '#0F172A' },
        line: '#E2E8F0',
        electric: '#0055FF',
        teal: '#00D4B2',
        coral: '#FF2D55',
        amber: '#FF9500',
        violet: '#7C3AED',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
};
