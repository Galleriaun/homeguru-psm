/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
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
