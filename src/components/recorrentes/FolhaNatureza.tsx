import { useState } from 'react'
import type { FormEvent } from 'react'
import { Aviso } from '../ui/Aviso'
import { Button } from '../ui/Button'
import { Folha } from '../ui/Folha'
import { mensagemErroBanco } from '../../lib/erros'
import { definirNaturezaRecorrencia, naturezasDoTipo, rotuloNatureza } from '../../lib/recorrencias'
import type { NaturezaRecorrencia, Recorrencia } from '../../lib/recorrencias'

/**
 * Corrigir a natureza de um recorrente (pedido do dono, 14/11/2026). É a única edição que Recorrentes aceita: só classifica, não
 * muda valor, data nem lançamento. "Deixar o app sugerir" tira a marcação; sem natureza, o fixo × variável vem do histórico.
 */
export function FolhaNatureza({ recorrencia: r, aoConcluir, aoCancelar }: {
  recorrencia: Recorrencia
  aoConcluir: () => Promise<void>
  aoCancelar: () => void
}) {
  const [escolhida, setEscolhida] = useState<NaturezaRecorrencia | ''>(r.nature ?? '')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const opcoes = naturezasDoTipo(r.tipo)
  const mudou = escolhida !== (r.nature ?? '')

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!mudou) { aoCancelar(); return }
    setErro('')
    setEnviando(true)
    try {
      await definirNaturezaRecorrencia(r.id, escolhida || null)
      await aoConcluir()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Folha titulo={`Natureza · ${r.descricao}`} aoFechar={aoCancelar} centro>
      <form onSubmit={salvar} className="flex flex-col gap-4" noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Esta cobrança é…</legend>
          {opcoes.map((n) => (
            <label key={n} className="flex min-h-11 items-center gap-3 text-sm">
              <input type="radio" name="natureza" className="h-5 w-5" checked={escolhida === n} onChange={() => setEscolhida(n)} />
              {rotuloNatureza[n]}
            </label>
          ))}
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="radio" name="natureza" className="h-5 w-5" checked={escolhida === ''} onChange={() => setEscolhida('')} />
            {r.tipo === 'income' ? 'Sem natureza' : 'Deixar o app sugerir'}
          </label>
        </fieldset>
        {r.tipo !== 'income' && (
          <p className="text-sm text-slate-600">
            Custo fixo e assinatura contam como <strong>fixo</strong>; gasto variável conta como <strong>variável</strong> no topo da página.
            Sem escolha, o app decide pelo histórico (valor sempre igual = fixo; valores diferentes = variável).
            Isso só classifica: valor, data e lançamentos não mudam.
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" carregando={enviando} disabled={!mudou}>Salvar</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Folha>
  )
}
