/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dji: {
          black: '#000000',
          ink: '#1a1a1a',
          muted: '#525252',
          subtle: '#737373',
          border: '#e5e5e5',
          surface: '#ffffff',
          page: '#f5f5f5',
          dark: '#0a0a0a',
          accent: '#0080ff',
        },
      },
      fontFamily: {
        sans: [
          '"DM Sans"',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        'dji-sm': '0 1px 2px rgba(0, 0, 0, 0.04)',
      },
    },
  },
  plugins: [],
}
