import { CORES, FUNDOS } from './src/lib/cores.ts'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // identidade visual (24/10/2026): marinho e celeste da logo
        marinho: CORES.transferencia.DEFAULT,
        celeste: '#48B5FF',
        azul: { DEFAULT: CORES.lucro.DEFAULT, claro: CORES.lucro.fundo },
        fundo: FUNDOS.app,
        // sistema de cores do dinheiro (#184): a fonte é src/lib/cores.ts; ver "30 - Decisões" e "20 - Regras do dinheiro"
        ...CORES,
        // vermelho de erro e de ação destrutiva (e dos Relatórios, #179): o mesmo tom do prejuízo, com nome de interface
        negativo: CORES.prejuizo,
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
