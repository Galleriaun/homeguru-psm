/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  // Touch devices simulate :hover on tap and keep it until you tap elsewhere,
  // leaving cards stuck in their hover (green) state. Scoping hover utilities
  // to `@media (hover: hover)` means they apply only on real pointers (desktop).
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          500: '#1a73e8',
          600: '#1557b0',
          700: '#114a99',
        },
      },
    },
  },
  plugins: [],
};
