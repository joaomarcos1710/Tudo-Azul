import { useEffect, useRef, useState } from 'react'

/**
 * Largura real (em px) da caixa do gráfico, para o SVG desenhar nela 1:1: com a largura fixa de 640, no iPad em
 * retrato (≈460px úteis) o texto de 12px encolhia para ≈8px. Sem ResizeObserver (testes, navegador antigo), fica
 * no `padrao`. Nunca menos que `minimo` (abaixo disso o gráfico encolhe como antes).
 */
export function useLargura<T extends HTMLElement>(padrao = 640, minimo = 300) {
  const ref = useRef<T>(null)
  const [largura, setLargura] = useState(padrao)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const medir = () => { const w = Math.round(el.clientWidth); if (w > 0) setLargura(Math.max(minimo, w)) }
    medir()
    const obs = new ResizeObserver(medir)
    obs.observe(el)
    return () => obs.disconnect()
  }, [minimo])
  return [ref, largura] as const
}
