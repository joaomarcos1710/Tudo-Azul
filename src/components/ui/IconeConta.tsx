import { bancoDaConta } from '../../lib/bancos'
import type { TipoConta } from '../../lib/contas'
import { IconeContas } from '../layout/icons'

type Tamanho = 'mini' | 'pequeno' | 'normal'

const caixa: Record<Tamanho, string> = {
  mini: 'h-4 w-4 rounded text-[7px] [&>svg]:h-2.5 [&>svg]:w-2.5',
  pequeno: 'h-7 w-7 rounded-md text-[10px] [&>svg]:h-4 [&>svg]:w-4',
  normal: 'h-10 w-10 rounded-lg text-sm [&>svg]:h-5 [&>svg]:w-5',
}

/**
 * Selo da conta: o banco citado no nome (sigla sobre a cor dele) ou, sem banco, o ícone neutro de conta.
 * Decorativo: o nome da conta sempre aparece em texto ao lado. A sigla vem do CSS (`data-sigla`), não é texto da página,
 * então não entra em busca, cópia nem leitor de tela.
 */
export function IconeConta({ nome, tipo, tamanho = 'normal', className = '' }: {
  nome: string; tipo: TipoConta; tamanho?: Tamanho; className?: string
}) {
  const banco = bancoDaConta(nome, tipo)
  const base = `inline-flex shrink-0 items-center justify-center align-middle font-bold leading-none ${caixa[tamanho]} ${className}`
  if (!banco) {
    return <span aria-hidden="true" data-banco="" className={`${base} bg-slate-100 text-slate-600`}><IconeContas /></span>
  }
  const longa = banco.sigla.length > 2
  return (
    <span aria-hidden="true" data-banco={banco.chave} data-sigla={banco.sigla}
      style={{ backgroundColor: banco.cor, color: banco.texto }}
      className={`${base} tracking-tight after:content-[attr(data-sigla)] ${longa ? 'after:scale-[.8]' : ''}`} />
  )
}
