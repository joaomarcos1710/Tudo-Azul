import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card, CardTitle } from '../components/ui/Card'
import { Field } from '../components/ui/Field'
import { IconeConta } from '../components/ui/IconeConta'
import { useFamilia } from '../lib/FamiliaContext'
import { conciliar, desfazerUltimaConciliacao, movimentosAte, saldoNaData, ultimasConciliacoes } from '../lib/conciliacao'
import type { Conciliacao, Movimento } from '../lib/conciliacao'
import { hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { asCents, formatBRL, formatDate, parseBRL } from '../lib/format'
import type { Cents } from '../lib/format'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'

/**
 * Conferir a conta com o extrato do banco (critério 1 do corte do Organizze).
 * O saldo do app e os movimentos vêm do banco; a tela só compara com o número do extrato.
 * Depois de concluir, o período até a data fica travado no banco até "Desfazer".
 */
export default function Conferir() {
  const { contaId = '' } = useParams()
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [conta, setConta] = useState<Conta | null>(null)
  const [data, setData] = useState(hojeSP())
  const [extratoTexto, setExtratoTexto] = useState('')
  const [saldoApp, setSaldoApp] = useState<Cents | null>(null)
  const [movimentos, setMovimentos] = useState<Movimento[] | null>(null)
  const [historico, setHistorico] = useState<Conciliacao[]>([])
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [enviando, setEnviando] = useState(false)
  // descarta respostas de uma data anterior que cheguem depois (evita "Zero ✓" da data errada)
  const pedido = useRef(0)
  const [desfazendo, setDesfazendo] = useState(false)

  const carregar = useCallback(async () => {
    const meu = ++pedido.current // antes de qualquer retorno: data apagada invalida a consulta em voo
    setSaldoApp(null)
    setMovimentos(null)
    if (!familiaId || !contaId || !data) return
    try {
      const [contas, saldo, movs, hist] = await Promise.all([
        listarContas(familiaId), saldoNaData(familiaId, contaId, data), movimentosAte(contaId, data), ultimasConciliacoes(contaId),
      ])
      if (meu !== pedido.current) return
      setConta(contas.contas.find((c) => c.id === contaId) ?? null)
      setSaldoApp(saldo)
      setMovimentos(movs)
      setHistorico(hist)
      setErro('')
    } catch (err) {
      if (meu === pedido.current) setErro(mensagemErroBanco(err))
    }
  }, [familiaId, contaId, data])

  useEffect(() => { void carregar() }, [carregar])

  const extrato = parseBRL(extratoTexto)
  // comparação de dois valores exatos em centavos (não é relatório: o saldo do app vem do banco,
  // e o banco recalcula e recusa se não bater)
  const diferenca: Cents | null = extrato !== null && saldoApp !== null ? asCents(extrato - saldoApp) : null
  const pendentes = movimentos?.filter((m) => !m.conferido) ?? []
  const travadaAte = historico[0]?.data ?? null

  async function concluir(e: FormEvent) {
    e.preventDefault()
    if (extrato === null || diferenca !== 0) return
    setEnviando(true)
    setErro('')
    try {
      await conciliar(contaId, data, extrato)
      setSucesso(`Conta conferida em ${formatDate(data)}: o saldo bate com o extrato. O período até essa data ficou travado.`)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  async function desfazer() {
    if (!travadaAte || desfazendo) return
    if (!window.confirm(`Desfazer a conciliação de ${formatDate(travadaAte)}? O período volta a poder ser editado e as marcas de "Conferido" dessa conciliação somem.`)) return
    // o RPC desfaz "a última": um segundo toque durante a chamada desfaria a conciliação anterior à que a pessoa viu
    setDesfazendo(true)
    try {
      await desfazerUltimaConciliacao(contaId)
      setSucesso('')
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setDesfazendo(false)
    }
  }

  if (!familiaId) return null
  return (
    <>
      <CabecalhoPagina titulo={<span className="flex items-center gap-3">{conta && <IconeConta nome={conta.nome} tipo={conta.tipo} />}<span>Conferir {conta?.nome ?? 'conta'}</span></span>} voltar={{ para: '/contas', rotulo: 'Contas' }}
        descricao={<>
          Compare com o extrato do banco. Quando a diferença for zero, conclua: o período até a data fica <strong>travado</strong>{' '}
          (nada que mude o saldo pode ser lançado, editado ou excluído nele) até você desfazer a conciliação.
        </>} />

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      {sucesso && <div className="mb-4"><Aviso tipo="sucesso">{sucesso}</Aviso></div>}
      {travadaAte && !sucesso && (
        <div className="mb-4"><Aviso tipo="info">Conta conciliada até {formatDate(travadaAte)}. Para conferir de novo, escolha uma data posterior.</Aviso></div>
      )}

      <Card className="mb-4">
        <form onSubmit={concluir} className="grid gap-4 md:grid-cols-3" noValidate>
          <Field rotulo="Data do extrato" type="date" max={hojeSP()} value={data}
            onChange={(e) => { setData(e.target.value); setSucesso('') }} erro={!data ? 'Informe a data.' : undefined} />
          <Field rotulo="Saldo no extrato (R$)" inputMode="decimal" placeholder="Ex.: 5.249,60" value={extratoTexto}
            onChange={(e) => { setExtratoTexto(e.target.value); setSucesso('') }}
            erro={extratoTexto && extrato === null ? 'Valor inválido. Exemplo: 5.249,60 ou -120,00' : undefined} />
          <div className="flex flex-col justify-end">
            <Button type="submit" carregando={enviando} disabled={diferenca !== 0}>Concluir conciliação</Button>
          </div>
        </form>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
          <div>
            <dt className="text-slate-500">Saldo no app {data ? `em ${formatDate(data)}` : ''}</dt>
            <dd className="tabular-nums text-lg font-semibold">{saldoApp === null ? '—' : formatBRL(saldoApp)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Diferença (extrato − app)</dt>
            <dd className={`tabular-nums text-lg font-semibold ${diferenca === null ? '' : diferenca === 0 ? 'text-positivo' : 'text-negativo'}`}>
              {diferenca === null ? '—' : diferenca === 0 ? 'Zero ✓' : formatBRL(diferenca)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Ainda não conferidos</dt>
            <dd className="text-lg font-semibold">{movimentos === null ? '—' : pendentes.length}</dd>
          </div>
        </dl>
        {diferenca !== null && diferenca !== 0 && (
          <p className="mt-3 text-sm text-slate-600">
            Procure no extrato um lançamento que falta no app, está duplicado, com valor diferente, ou ainda como <strong>Planejado</strong>
            (planejado não conta no saldo).
          </p>
        )}
      </Card>

      <Card semPadding>
        <div className="px-5 pt-5"><CardTitle>{data ? `Movimentos até ${formatDate(data)}` : 'Movimentos'}</CardTitle></div>
        {movimentos === null ? <p className="px-5 pb-5 text-sm text-slate-600" role="status">{data ? 'Carregando…' : 'Informe a data.'}</p> : (
          <ul className="divide-y divide-slate-100">
            {movimentos.map((m) => (
              <li key={`${m.origem}-${m.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {m.descricao}
                    {m.conferido && m.origem !== 'opening' && (
                      <span className="ml-2 rounded bg-pago-fundo px-2 py-0.5 text-xs font-medium text-pago">Conferido</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500">{formatDate(m.data)}{m.origem === 'debt' && ' · cartão/dívida'}</p>
                </div>
                <span className={`tabular-nums font-semibold ${m.origem === 'opening' ? '' : m.valor < 0 ? 'text-negativo' : 'text-positivo'}`}>
                  {m.origem === 'opening' ? formatBRL(m.valor) : `${m.valor < 0 ? '−' : '+'}${formatBRL(asCents(Math.abs(m.valor)) as Cents)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {historico.length > 0 && (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Conciliações</CardTitle>
            <Button variante="fantasma" onClick={desfazer} carregando={desfazendo}>Desfazer a de {formatDate(historico[0].data)}</Button>
          </div>
          <ul className="flex flex-col gap-1 text-sm text-slate-600">
            {historico.map((h) => (
              <li key={h.criadaEm}>{formatDate(h.data)} · extrato {formatBRL(h.saldoExtrato)} · {h.lancamentos} lançamento(s) marcados nesta conferência</li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
