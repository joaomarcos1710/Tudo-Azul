import { bancoEscolhidoOuDoNome, BANDEIRAS, LOGOS, LOGOS_BANDEIRA } from '../../lib/bancos'
import type { Banco } from '../../lib/bancos'
import type { TipoConta } from '../../lib/contas'
import { IconeCartoes, IconeContas } from '../layout/icons'

type Tamanho = 'mini' | 'pequeno' | 'normal'

const caixa: Record<Tamanho, string> = {
  mini: 'h-4 w-4 rounded text-[7px] [&>svg]:h-2.5 [&>svg]:w-2.5',
  pequeno: 'h-7 w-7 rounded-md text-[10px] [&>svg]:h-4 [&>svg]:w-4',
  normal: 'h-10 w-10 rounded-lg text-sm [&>svg]:h-5 [&>svg]:w-5',
}

/** Selo de um banco: o logo (se o arquivo existe) ou a sigla sobre a cor dele; sem banco, o ícone neutro dado. */
function Selo({ banco, tamanho, className, neutro }: { banco: Banco | null; tamanho: Tamanho; className: string; neutro: React.ReactNode }) {
  const base = `inline-flex shrink-0 items-center justify-center align-middle font-bold leading-none ${caixa[tamanho]} ${className}`
  if (!banco) {
    return <span aria-hidden="true" data-banco="" className={`${base} bg-slate-100 text-slate-600`}>{neutro}</span>
  }
  const logo = LOGOS[banco.chave]
  if (logo) {
    return (
      <span aria-hidden="true" data-banco={banco.chave} data-logo="" className={`${base} overflow-hidden bg-white ring-1 ring-slate-200`}>
        <img src={logo} alt="" className="h-full w-full object-contain p-0.5" />
      </span>
    )
  }
  const longa = banco.sigla.length > 2
  return (
    <span aria-hidden="true" data-banco={banco.chave} data-sigla={banco.sigla}
      style={{ backgroundColor: banco.cor, color: banco.texto }}
      className={`${base} tracking-tight after:content-[attr(data-sigla)] ${longa ? 'after:scale-[.8]' : ''}`} />
  )
}

/**
 * Selo da conta: o banco escolhido na conta (ou, sem escolha, o citado no nome) ou o ícone neutro de conta.
 * Decorativo: o nome da conta sempre aparece em texto ao lado. A sigla vem do CSS (`data-sigla`), não é texto da página,
 * então não entra em busca, cópia nem leitor de tela.
 */
export function IconeConta({ nome, tipo, banco, tamanho = 'normal', className = '' }: {
  nome: string; tipo: TipoConta; banco?: string | null; tamanho?: Tamanho; className?: string
}) {
  return <Selo banco={bancoEscolhidoOuDoNome(banco, nome, tipo)} tamanho={tamanho} className={className} neutro={<IconeContas />} />
}

/** Selo do emissor do cartão: o banco escolhido, ou o citado no nome do cartão, ou o ícone neutro de cartão. */
export function IconeEmissor({ nome, emissor, tamanho = 'normal', className = '' }: {
  nome: string; emissor?: string | null; tamanho?: Tamanho; className?: string
}) {
  return <Selo banco={bancoEscolhidoOuDoNome(emissor, nome, 'checking')} tamanho={tamanho} className={className} neutro={<IconeCartoes />} />
}

/** Bandeira do cartão (Visa, Mastercard...) em miniatura; sem bandeira escolhida não mostra nada. */
export function BandeiraCartao({ bandeira, className = '' }: { bandeira?: string | null; className?: string }) {
  const b = BANDEIRAS.find((x) => x.chave === bandeira)
  const arquivo = b ? LOGOS_BANDEIRA[b.chave] : undefined
  if (!b || !arquivo) return null
  return <img src={arquivo} alt="" aria-hidden="true" data-bandeira={b.chave} className={`h-5 w-auto shrink-0 rounded-sm ${className}`} />
}
