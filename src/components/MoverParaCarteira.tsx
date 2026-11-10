import { useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Aviso } from './ui/Aviso'
import { Button } from './ui/Button'
import { Folha } from './ui/Folha'
import { CLASSES_ATIVO, SUGESTOES_SUBCLASSE, moverContaParaCarteira } from '../lib/investimentos'
import type { ClasseAtivo, Liquidez } from '../lib/investimentos'
import type { Conta, TipoConta } from '../lib/contas'
import { formatBRL } from '../lib/format'
import { mensagemErroBanco } from '../lib/erros'

/** Tipos de conta que guardam dinheiro aplicado: só esses oferecem "Mover para a carteira". */
export const TIPOS_MOVER_PARA_CARTEIRA: readonly TipoConta[] = ['fixed_income', 'variable_income', 'crypto']

/** Conta de investimento antiga, ativa, em reais e com saldo: pode virar ativo da carteira. */
export function podeMoverParaCarteira(c: Conta): boolean {
  return c.ativa && (c.moeda ?? 'BRL') === 'BRL' && TIPOS_MOVER_PARA_CARTEIRA.includes(c.tipo) && c.saldo !== null && c.saldo > 0
}

const classePadrao: Partial<Record<TipoConta, ClasseAtivo>> = { fixed_income: 'fixed_income', crypto: 'crypto' }

/**
 * Leva o saldo de uma conta antiga de investimento para a carteira (migration 100, decisão do dono de 10/11/2026).
 * Tudo acontece no banco, numa operação só: o ativo nasce com o saldo de hoje, a conta zera por transferência (sem
 * despesa) e é arquivada. O saldo mostrado aqui é só para conferir; o valor usado é o do banco.
 */
export function MoverParaCarteira({ conta, aoConcluir, aoCancelar }: { conta: Conta; aoConcluir: () => void; aoCancelar: () => void }) {
  const [nome, setNome] = useState(conta.nome)
  const [classe, setClasse] = useState<ClasseAtivo | ''>(classePadrao[conta.tipo] ?? '')
  const [liquidez, setLiquidez] = useState<Liquidez>('liquid')
  const [subclasse, setSubclasse] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const id = useId()

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim()) { setErro('Informe o nome do ativo.'); return }
    if (!classe) { setErro('Escolha a classe do ativo.'); return }
    setErro(''); setEnviando(true)
    try {
      await moverContaParaCarteira({ contaId: conta.id, nome, classe, liquidez, subclasse })
      aoConcluir()
    } catch (e2) { setErro(mensagemErroBanco(e2)) } finally { setEnviando(false) }
  }

  const aba = (ativa: boolean) => `min-h-11 min-w-0 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors ${ativa ? 'bg-azul-claro text-azul' : 'text-slate-600 hover:bg-slate-50'}`
  const linha = 'flex min-h-14 items-center justify-between gap-3 px-4'
  const controle = 'min-h-11 min-w-0 flex-1 rounded-md bg-transparent px-1 text-right text-base text-slate-700 focus:outline focus:outline-2 focus:outline-azul'
  return (
    <Folha titulo={`Mover para a carteira · ${conta.nome}`} aoFechar={aoCancelar} rodape={<>
      <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
      <Button type="submit" form={id} carregando={enviando}>Mover para a carteira</Button>
    </>}>
      <form id={id} onSubmit={(e) => void enviar(e)} className="flex flex-col gap-4" noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="rounded-xl bg-fundo p-4">
          <p className="text-sm text-slate-600">Saldo de hoje</p>
          <p className="text-3xl font-bold tabular-nums text-marinho">{conta.saldo === null ? '—' : formatBRL(conta.saldo)}</p>
          <p className="mt-2 text-sm text-slate-600">
            Esse saldo vira um ativo na carteira de investimentos. A conta fica zerada, sem despesa, e é arquivada. O patrimônio não muda.
          </p>
        </div>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          <div className={linha}>
            <label htmlFor={`${id}-nome`} className="shrink-0 text-base text-marinho">Nome do ativo</label>
            <input id={`${id}-nome`} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} className={controle} />
          </div>
          <div className={linha}>
            <label htmlFor={`${id}-classe`} className="shrink-0 text-base text-marinho">Classe</label>
            <select id={`${id}-classe`} value={classe} onChange={(e) => setClasse(e.target.value as ClasseAtivo | '')} className={controle}>
              <option value="">Escolha a classe</option>
              {CLASSES_ATIVO.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </div>
          <div className={linha}>
            <label htmlFor={`${id}-sub`} className="shrink-0 text-base text-marinho">Subclasse (opcional)</label>
            <input id={`${id}-sub`} value={subclasse} onChange={(e) => setSubclasse(e.target.value)} maxLength={40} list={`${id}-sugestoes`} className={controle} />
          </div>
        </div>
        <datalist id={`${id}-sugestoes`}>{(classe ? SUGESTOES_SUBCLASSE[classe] : []).map((x) => <option key={x} value={x} />)}</datalist>
        <div role="radiogroup" aria-label="Liquidez" className="flex gap-1 rounded-xl bg-slate-100 p-1">
          <button type="button" role="radio" aria-checked={liquidez === 'liquid'} onClick={() => setLiquidez('liquid')} className={aba(liquidez === 'liquid')}>Líquido</button>
          <button type="button" role="radio" aria-checked={liquidez === 'restricted'} onClick={() => setLiquidez('restricted')} className={aba(liquidez === 'restricted')}>Restrito</button>
        </div>
        <p className="text-sm text-slate-600">Depois, atualize o valor em Investimentos, por "Registrar avaliação".</p>
      </form>
    </Folha>
  )
}
