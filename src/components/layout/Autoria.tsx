import { linhasAutoria } from '../../lib/autoria'

/** Duas linhas discretas de autoria (ideia 03). A cor vem de fora, porque as duas telas que a usam têm fundo marinho. */
export function Autoria({ className = '' }: { className?: string }) {
  const [linha1, linha2] = linhasAutoria()
  return (
    <p className={`text-[11px] leading-snug ${className}`}>
      <span className="block">{linha1}</span>
      <span className="block">{linha2}</span>
    </p>
  )
}
