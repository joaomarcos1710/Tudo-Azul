/**
 * Logo do Tudo Azul: a arte oficial em public/brand (logo-azul.png para fundos claros, logo-claro.png para os escuros,
 * com o texto branco). Não há mais desenho em SVG no código.
 */
export function Marca({ tamanho = 32, claro = false }: { tamanho?: number; claro?: boolean }) {
  return (
    <img
      src={claro ? '/brand/logo-claro.png' : '/brand/logo-azul.png'}
      alt="tudo azul"
      style={{ height: tamanho * 1.5, width: 'auto' }}
      className="block shrink-0"
    />
  )
}
