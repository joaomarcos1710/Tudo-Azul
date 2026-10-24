/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // identidade visual (24/10/2026): marinho e celeste da logo
        marinho: '#0B1F46',
        celeste: '#48B5FF',
        azul: { DEFAULT: '#2563EB', claro: '#EAF2FF' },
        fundo: '#F7F9FC',
        positivo: '#15803D',
        negativo: '#B91C1C',
        // status de lançamento (design system): planejado âmbar, pago verde
        planejado: { DEFAULT: '#B45309', fundo: '#FEF3C7' },
        pago: { DEFAULT: '#047857', fundo: '#D1FAE5' },
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
