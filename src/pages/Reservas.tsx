import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card, CardTitle } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { useFamilia } from '../lib/FamiliaContext'
import { asCents, formatDate, formatMoeda, parseBRL } from '../lib/format'
import { hojeSP } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { criarReserva, listarReservas, registrarAlocacaoReserva } from '../lib/reservas'
import type { Reserva } from '../lib/reservas'

const campo = 'mt-1 min-h-11 w-full rounded-[14px] border border-slate-300 bg-white px-3 text-sm text-marinho outline-none transition focus:border-azul focus:ring-2 focus:ring-azul/15'
const rotulo = 'block text-sm font-medium text-slate-700'

function nomeStatus(status: Reserva['status']): string {
  if (status === 'completed') return 'Concluída'
  if (status === 'archived') return 'Arquivada'
  return 'Ativa'
}

export default function Reservas() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  const [nome, setNome] = useState('')
  const [moeda, setMoeda] = useState('BRL')
  const [metaTexto, setMetaTexto] = useState('')
  const [dataMeta, setDataMeta] = useState('')

  const [reservaId, setReservaId] = useState('')
  const [tipoMovimento, setTipoMovimento] = useState<'aporte' | 'resgate'>('aporte')
  const [valorTexto, setValorTexto] = useState('')
  const [dataMovimento, setDataMovimento] = useState(hojeSP())
  const [descricao, setDescricao] = useState('')
  const [chaveIdempotencia, setChaveIdempotencia] = useState<string | null>(null)

  const reservaSelecionada = useMemo(
    () => reservas.find((r) => r.id === reservaId) ?? reservas.find((r) => r.status !== 'archived') ?? null,
    [reservas, reservaId],
  )

  const recarregar = useCallback(async () => {
    if (!familiaId) return
    setCarregando(true)
    try {
      const lista = await listarReservas(familiaId)
      setReservas(lista)
      setReservaId((atual) => lista.some((r) => r.id === atual) ? atual : (lista.find((r) => r.status !== 'archived')?.id ?? ''))
      setErro('')
    } catch (e) {
      setErro(mensagemErroBanco(e))
    } finally {
      setCarregando(false)
    }
  }, [familiaId])

  useEffect(() => { void recarregar() }, [recarregar])

  async function salvarReserva(e: FormEvent) {
    e.preventDefault()
    if (!familiaId) return
    const nomeLimpo = nome.trim()
    const meta = metaTexto.trim() ? parseBRL(metaTexto) : null
    if (!nomeLimpo) { setErro('Informe o nome da reserva.'); return }
    if (metaTexto.trim() && (meta === null || meta <= 0)) { setErro('Informe uma meta válida e maior que zero.'); return }
    setSalvando(true)
    setErro('')
    try {
      await criarReserva(familiaId, nomeLimpo, moeda, meta, dataMeta || null)
      setNome('')
      setMetaTexto('')
      setDataMeta('')
      await recarregar()
    } catch (e) {
      setErro(mensagemErroBanco(e))
    } finally {
      setSalvando(false)
    }
  }

  async function salvarMovimento(e: FormEvent) {
    e.preventDefault()
    if (!reservaSelecionada) { setErro('Cadastre ou selecione uma reserva.'); return }
    const valorDigitado = parseBRL(valorTexto)
    if (valorDigitado === null || valorDigitado <= 0) { setErro('Informe um valor maior que zero.'); return }
    if (reservaSelecionada.status === 'archived') { setErro('Uma reserva arquivada não pode receber movimentações.'); return }
    if (tipoMovimento === 'aporte' && reservaSelecionada.status !== 'active') {
      setErro('Reservas concluídas não recebem novos aportes. Resgates continuam disponíveis.')
      return
    }
    const valor = asCents(tipoMovimento === 'resgate' ? -valorDigitado : valorDigitado)
    if (valor === null) { setErro('Valor fora do limite permitido.'); return }
    const chave = chaveIdempotencia ?? crypto.randomUUID()
    setChaveIdempotencia(chave)
    setSalvando(true)
    setErro('')
    try {
      await registrarAlocacaoReserva(reservaSelecionada.id, valor, dataMovimento, descricao, chave)
      setChaveIdempotencia(null)
      setValorTexto('')
      setDescricao('')
      await recarregar()
    } catch (e) {
      // Mantém a chave para que uma tentativa repetida após timeout seja idempotente.
      setErro(mensagemErroBanco(e))
    } finally {
      setSalvando(false)
    }
  }

  if (!familiaId) return null

  return (
    <>
      <CabecalhoPagina titulo="Reservas" descricao="Organize objetivos com envelopes virtuais e acompanhe cada aporte e resgate." />
      <Aviso tipo="info">
        As reservas são compromissos virtuais: aportes e resgates não movimentam suas contas bancárias. Reservas em BRL são descontadas do Dinheiro Livre; envelopes em USD e EUR ficam separados por moeda, sem conversão automática. O saldo só volta ao Dinheiro Livre após um resgate explícito.
      </Aviso>
      {erro && <div className="mt-4"><Aviso tipo="erro">{erro}</Aviso></div>}

      <Card className="mt-4">
        <CardTitle>Criar reserva</CardTitle>
        <form onSubmit={salvarReserva} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={rotulo}>
            Nome da reserva
            <input className={campo} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Viagem, emergência, carro" required />
          </label>
          <label className={rotulo}>
            Moeda
            <select className={campo} value={moeda} onChange={(e) => setMoeda(e.target.value)}>
              <option value="BRL">Real (BRL)</option>
              <option value="USD">Dólar (USD)</option>
              <option value="EUR">Euro (EUR)</option>
            </select>
          </label>
          <label className={rotulo}>
            Meta (opcional)
            <input className={campo} value={metaTexto} onChange={(e) => setMetaTexto(e.target.value)} inputMode="decimal" placeholder="0,00" />
          </label>
          <label className={rotulo}>
            Data da meta (opcional)
            <input className={campo} type="date" value={dataMeta} onChange={(e) => setDataMeta(e.target.value)} />
          </label>
          <div className="sm:col-span-2">
            <Button type="submit" carregando={salvando}>Criar reserva</Button>
          </div>
        </form>
      </Card>

      <Card className="mt-4">
        <CardTitle>Registrar aporte ou resgate</CardTitle>
        {reservas.length === 0
          ? <p className="text-sm text-slate-500">Crie uma reserva para começar a organizar seus objetivos.</p>
          : <form onSubmit={salvarMovimento} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className={rotulo}>
              Reserva
              <select className={campo} value={reservaSelecionada?.id ?? ''} onChange={(e) => { setReservaId(e.target.value); setChaveIdempotencia(null) }}>
                {reservas.map((r) => <option key={r.id} value={r.id}>{r.nome} · {r.moeda} · {nomeStatus(r.status)}</option>)}
              </select>
            </label>
            <label className={rotulo}>
              Movimento
              <select className={campo} value={tipoMovimento} onChange={(e) => { setTipoMovimento(e.target.value as 'aporte' | 'resgate'); setChaveIdempotencia(null) }}>
                <option value="aporte">Aporte</option>
                <option value="resgate">Resgate</option>
              </select>
            </label>
            <label className={rotulo}>
              Valor {reservaSelecionada ? `(${reservaSelecionada.moeda})` : ''}
              <input className={campo} value={valorTexto} onChange={(e) => { setValorTexto(e.target.value); setChaveIdempotencia(null) }} inputMode="decimal" placeholder="0,00" required />
            </label>
            <label className={rotulo}>
              Data
              <input className={campo} type="date" value={dataMovimento} onChange={(e) => { setDataMovimento(e.target.value); setChaveIdempotencia(null) }} required />
            </label>
            <label className={rotulo + ' sm:col-span-2'}>
              Descrição (opcional)
              <input className={campo} value={descricao} maxLength={200} onChange={(e) => { setDescricao(e.target.value); setChaveIdempotencia(null) }} placeholder="Ex.: aporte mensal" />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" carregando={salvando} disabled={!reservaSelecionada || reservaSelecionada.status === 'archived' || (tipoMovimento === 'aporte' && reservaSelecionada.status !== 'active')}>
                Registrar {tipoMovimento}
              </Button>
            </div>
          </form>}
      </Card>

      <section className="mt-6" aria-label="Envelopes da família">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-marinho">Seus envelopes</h2>
          <Button variante="secundario" compacto onClick={() => void recarregar()} carregando={carregando}>Atualizar</Button>
        </div>
        {carregando
          ? <p role="status" className="text-sm text-slate-500">Carregando reservas…</p>
          : reservas.length === 0
            ? <EmptyState titulo="Nenhuma reserva criada" descricao="Crie seu primeiro envelope para separar o dinheiro destinado a um objetivo." />
            : <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {reservas.map((r) => (
                <Card key={r.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold text-marinho">{r.nome}</h3>
                      <p className="mt-1 text-xs text-slate-500">{nomeStatus(r.status)} · {r.moeda}</p>
                    </div>
                    <p className="shrink-0 tabular-nums text-xl font-bold text-marinho">{formatMoeda(r.saldo, r.moeda)}</p>
                  </div>
                  {r.meta !== null && <p className="mt-2 text-xs text-slate-500">Meta: {formatMoeda(r.meta, r.moeda)}{r.dataMeta ? ` até ${formatDate(r.dataMeta)}` : ''}</p>}
                  <div className="mt-3 border-t border-slate-100 pt-2">
                    <p className="mb-1 text-xs font-semibold text-slate-500">Movimentos recentes</p>
                    {r.movimentos.length === 0
                      ? <p className="py-2 text-sm text-slate-400">Nenhum aporte ou resgate registrado.</p>
                      : <ul className="divide-y divide-slate-100">
                        {r.movimentos.map((m) => (
                          <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                            <span className="min-w-0">
                              <span className="block truncate font-medium text-marinho">{m.descricao || (m.valor > 0 ? 'Aporte' : 'Resgate')}</span>
                              <span className="block text-xs text-slate-500">{formatDate(m.data)}</span>
                            </span>
                            <span className={'shrink-0 tabular-nums font-semibold ' + (m.valor > 0 ? 'text-lucro' : 'text-slate-700')}>{formatMoeda(m.valor, r.moeda)}</span>
                          </li>
                        ))}
                      </ul>}
                    {r.movimentos.length === 20 && <p className="mt-1 text-xs text-slate-400">Exibindo os 20 movimentos mais recentes. O saldo considera o histórico completo.</p>}
                  </div>
                </Card>
              ))}
            </div>}
      </section>
    </>
  )
}
