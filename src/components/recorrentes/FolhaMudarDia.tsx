import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Aviso } from '../ui/Aviso'
import { Button } from '../ui/Button'
import { Folha } from '../ui/Folha'
import { Selecao } from '../ui/Selecao'
import { mensagemErroBanco } from '../../lib/erros'
import { formatDate } from '../../lib/format'
import type { Recorrencia } from '../../lib/recorrencias'
import { diasDoMes, listarOcorrenciasMoviveis, mudarODiaDaquiPraFrente } from '../../lib/recorrenciasDia'
import type { OcorrenciaMovivel } from '../../lib/recorrenciasDia'

/**
 * "Mudar o dia daqui pra frente" de um recorrente mensal: a pessoa escolhe a partir de qual cobrança e o dia novo. O banco muda
 * essa cobrança e as seguintes que ainda seguem a regra; o que já foi pago ou lançado na fatura não muda (ver recorrenciasDia.ts).
 */
export function FolhaMudarDia({ recorrencia: r, aoConcluir, aoCancelar }: {
  recorrencia: Recorrencia
  /** Chamada depois de gravar; `aviso` só vem quando algo da regra precisa de atenção. */
  aoConcluir: (aviso?: string) => Promise<void>
  aoCancelar: () => void
}) {
  const [ocorrencias, setOcorrencias] = useState<OcorrenciaMovivel[] | null>(null)
  const [escolhida, setEscolhida] = useState('')
  const [dia, setDia] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    let vivo = true
    listarOcorrenciasMoviveis(r)
      .then((lista) => {
        if (!vivo) return
        setOcorrencias(lista)
        if (lista[0]) { setEscolhida(lista[0].id); setDia(String(Number(lista[0].data.slice(8)))) }
      })
      .catch((e) => { if (vivo) { setOcorrencias([]); setErro(mensagemErroBanco(e)) } })
    return () => { vivo = false }
  }, [r])

  const ocorrencia = ocorrencias?.find((o) => o.id === escolhida)
  const dias = ocorrencia ? diasDoMes(ocorrencia.data) : []
  const mudou = ocorrencia !== undefined && Number(dia) !== Number(ocorrencia.data.slice(8))

  function escolher(id: string) {
    setEscolhida(id)
    const o = ocorrencias?.find((x) => x.id === id)
    if (o) setDia(String(Math.min(Number(dia) || 1, diasDoMes(o.data).length)))
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!ocorrencia || !mudou) return
    setErro('')
    setEnviando(true)
    try {
      const { naturezaPerdida } = await mudarODiaDaquiPraFrente(r, ocorrencia, Number(dia))
      await aoConcluir(naturezaPerdida ? `O dia mudou, mas a natureza de "${r.descricao}" não foi mantida. Edite o recorrente para escolher de novo.` : undefined)
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Folha titulo={`Mudar o dia · ${r.descricao}`} aoFechar={aoCancelar} centro>
      {ocorrencias === null && !erro && <p role="status" className="text-sm text-slate-600">Carregando as próximas cobranças…</p>}
      {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}
      {ocorrencias !== null && ocorrencias.length === 0 && !erro && (
        <p className="text-sm text-slate-700">
          Não há cobranças futuras para mudar. Aparecem aqui as dos próximos 12 meses que ainda não foram pagas nem lançadas na fatura
          e que ninguém corrigiu à mão.
        </p>
      )}
      {ocorrencias !== null && ocorrencias.length > 0 && (
        <form onSubmit={salvar} className="flex flex-col gap-4" noValidate>
          <Selecao rotulo="A partir de" valor={escolhida} aoMudar={escolher}
            opcoes={ocorrencias.map((o): [string, string] => [o.id, formatDate(o.data)])} />
          <Selecao rotulo="Novo dia" valor={dia} aoMudar={setDia} opcoes={dias.map((d): [string, string] => [String(d), `Dia ${d}`])} />
          <p className="text-sm text-slate-600">
            Essa cobrança e as seguintes passam para o dia escolhido. O que já foi pago ou lançado na fatura e o que você corrigiu à mão
            continuam como estão.
            {r.tipo === 'card' && ' Na assinatura de cartão, o recorrente atual termina na véspera e um novo começa no dia escolhido.'}
            {' '}O dia só vale até o último dia do mês escolhido.
          </p>
          {!mudou && <p role="status" className="text-sm text-slate-600">Escolha um dia diferente do atual.</p>}
          <div className="flex gap-2">
            <Button type="submit" carregando={enviando} disabled={!mudou}>Mudar o dia</Button>
            <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
          </div>
        </form>
      )}
      {ocorrencias !== null && ocorrencias.length === 0 && (
        <div className="mt-4"><Button variante="secundario" onClick={aoCancelar}>Fechar</Button></div>
      )}
    </Folha>
  )
}
