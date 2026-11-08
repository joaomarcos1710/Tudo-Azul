const SECOES = [
  { id: 'visao-geral', rotulo: 'Visão geral', principal: true },
  { id: 'contas', rotulo: 'Contas', principal: false },
  { id: 'cartoes', rotulo: 'Cartões', principal: false },
  { id: 'investimentos', rotulo: 'Investimentos', principal: false },
  { id: 'dividas', rotulo: 'Dívidas', principal: false },
] as const

/**
 * Atalhos locais da Minha Carteira. Os destinos são âncoras da própria página:
 * não navegam para outra rota nem iniciam consultas adicionais ao banco.
 */
export function NavegacaoCarteira() {
  return (
    <nav aria-label="Seções da Minha Carteira" className="mb-5 -mx-1 overflow-x-auto overscroll-x-contain px-1 pb-1">
      <ul className="flex w-max min-w-full snap-x snap-mandatory gap-2">
        {SECOES.map((secao) => (
          <li key={secao.id} className="snap-start">
            <a
              href={`#${secao.id}`}
              className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-azul ${
                secao.principal
                  ? 'border-azul bg-azul-claro text-azul hover:bg-blue-100'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {secao.rotulo}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
