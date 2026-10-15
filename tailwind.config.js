/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        marinho: '#102A43',
        azul: { DEFAULT: '#2563EB', claro: '#EAF2FF' },
        fundo: '#F7F9FC',
        positivo: '#15803D',
        negativo: '#B91C1C',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: { card: '14px' },
      boxShadow: { card: '0 1px 2px rgba(16,42,67,0.06), 0 1px 3px rgba(16,42,67,0.04)' },
    },
  },
  plugins: [],
}
