import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { Selecao } from '../components/ui/Selecao'
import { useFamilia } from '../lib/FamiliaContext'
import {
  cobrarFaturasFechadas, criarCartao, definirCiclo, listarCartoes, listarFaturas, listarItens,
  pagarFatura, registrarCompra, situacaoFatura,
} from '../lib/cartoes'
import type { Cartao, Fatura, ItemFatura } from '../lib/cartoes'
import { listarCategorias } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import { hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { asCents, formatBRL, formatDate, formatMonth, parseBRL } from '../lib/format'
import type { Cents } from '../lib/format'

type Painel =
  | { tipo: 'novo' }
  | { tipo: 'ciclo'; cartao: Cartao }
  | { tipo: 'compra'; cartao: Cartao }
  | { tipo: 'pagar'; cartao: Cartao }

const dias: [string, string][] = Array.from({ length: 31 }, (_, i) => [String(i + 1), `Dia ${i + 1}`])

export default function Cartoes() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [cartoes, setCartoes] = useState<Cartao[] | null>(null)
  const [contas, setContas] = useState<Conta[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [erro, setErro] = useState('')
  const [painel, setPainel] = useState<Painel | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)
  // muda a cada gravação para as faturas abertas recarregarem
  const [versao, setVersao] = useState(0)

  const carregar = useCallback(async () => {
    if (!familiaId) return
    try {
      // cobra o que já fechou antes de mostrar: os valores da tela ficam em dia
      await cobrarFaturasFechadas()
      const [c, cs, cats] = await Promise.all([listarCartoes(familiaId), listarContas(familiaId), listarCategorias(familiaId)])
      setCartoes(c)
      setContas(cs.contas)
      setCategorias(cats)
      setErro('')
      setVersao((v) => v + 1)
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }, [familiaId])

  useEffect(() => { void carregar() }, [carregar])

  async function aoSalvar() {
    setPainel(null)
    await carregar()
  }

  if (!familia) return null
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Cartões</h1>
        {painel === null && <Button onClick={() => setPainel({ tipo: 'novo' })}>Novo cartão</Button>}
      </div>

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}

      {painel?.tipo === 'novo' && <FormCartao aoSalvar={aoSalvar} aoCancelar={() => setPainel(null)} />}
      {painel?.tipo === 'ciclo' && <FormCiclo cartao={painel.cartao} aoSalvar={aoSalvar} aoCancelar={() => setPainel(null)} />}
      {painel?.tipo === 'compra' && (
        <FormCompra cartao={painel.cartao} categorias={categorias} aoSalvar={aoSalvar} aoCancelar={() => setPainel(null)} />
      )}
      {painel?.tipo === 'pagar' && (
        <FormPagar cartao={painel.cartao} contas={contas} aoSalvar={aoSalvar} aoCancelar={() => setPainel(null)} />
      )}

      {cartoes === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}

      {cartoes?.length === 0 && painel === null && (
        <EmptyState
          titulo="Nenhum cartão ainda"
          descricao="Cadastre o cartão com o dia de fechamento e de vencimento. Cada compra entra na fatura certa e vira despesa no mês do fechamento."
          acao={<Button onClick={() => setPainel({ tipo: 'novo' })}>Cadastrar o primeiro cartão</Button>}
        />
      )}

      <ul className="flex flex-col gap-4">
        {cartoes?.map((c) => (
          <li key={c.id}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{c.nome}</p>
                  {c.fechamento !== null ? (
                    <p className="text-sm text-slate-500">Fecha dia {c.fechamento} · vence dia {c.vencimento}</p>
                  ) : (
                    <p className="text-sm text-planejado">Defina o dia de fechamento e de vencimento para lançar compras.</p>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-slate-500">Fatura a pagar</dt>
                    <dd className={`tabular-nums text-lg font-semibold ${c.divida > 0 ? 'text-negativo' : ''}`}>{formatBRL(c.divida)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Parcelas futuras</dt>
                    <dd className="tabular-nums text-lg font-semibold text-planejado">{formatBRL(c.compromissos)}</dd>
                  </div>
                </dl>
              </div>
              {c.credito > 0 && <p className="mt-2 text-sm text-positivo">Crédito a receber: {formatBRL(c.credito)}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => setPainel({ tipo: 'compra', cartao: c })} disabled={c.fechamento === null || painel !== null}>Nova compra</Button>
                <Button variante="secundario" onClick={() => setPainel({ tipo: 'pagar', cartao: c })} disabled={c.divida <= 0 || painel !== null}>Pagar fatura</Button>
                <Button variante="fantasma" onClick={() => setAberto(aberto === c.id ? null : c.id)} aria-expanded={aberto === c.id}>
                  {aberto === c.id ? 'Ocultar faturas' : 'Ver faturas'}
                </Button>
                <Button variante="fantasma" onClick={() => setPainel({ tipo: 'ciclo', cartao: c })} disabled={painel !== null}>
                  {c.fechamento === null ? 'Definir fechamento' : 'Alterar dias'}
                </Button>
              </div>
              {aberto === c.id && <Faturas cartaoId={c.id} versao={versao} categorias={categorias} />}
            </Card>
          </li>
        ))}
      </ul>
    </>
  )
}

const rotuloSituacao = {
  aberta: { texto: 'Aberta', estilo: 'bg-planejado-fundo text-planejado' },
  fechada: { texto: 'Fechada', estilo: 'bg-red-50 text-negativo' },
  paga: { texto: 'Paga', estilo: 'bg-pago-fundo text-pago' },
}

function Faturas({ cartaoId, versao, categorias }: { cartaoId: string; versao: number; categorias: Categoria[] }) {
  const [faturas, setFaturas] = useState<Fatura[] | null>(null)
  const [mes, setMes] = useState<string | null>(null)
  const [itens, setItens] = useState<ItemFatura[] | null>(null)
  const [erro, setErro] = useState('')
  const hoje = hojeSP()

  useEffect(() => {
    listarFaturas(cartaoId)
      .then((f) => {
        setFaturas(f)
        // abre a primeira fatura ainda não paga (ou a última, se todas pagas)
        setMes((atual) => atual ?? (f.find((x) => situacaoFatura(x, hoje) !== 'paga') ?? f[f.length - 1])?.mes ?? null)
      })
      .catch((err) => setErro(mensagemErroBanco(err)))
  }, [cartaoId, versao, hoje])

  useEffect(() => {
    if (!mes) return
    setItens(null)
    listarItens(cartaoId, mes).then(setItens).catch((err) => setErro(mensagemErroBanco(err)))
  }, [cartaoId, mes, versao])

  const nomeCategoria = new Map(categorias.map((c) => [c.id, c.nome]))
  if (erro) return <div className="mt-4"><Aviso tipo="erro">{erro}</Aviso></div>
  if (!faturas) return <p className="mt-4 text-sm text-slate-600" role="status">Carregando faturas…</p>
  if (faturas.length === 0) return <p className="mt-4 text-sm text-slate-500">Nenhuma compra lançada neste cartão.</p>

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Faturas">
        {faturas.map((f) => {
          const s = rotuloSituacao[situacaoFatura(f, hoje)]
          return (
            <button key={f.mes} type="button" role="tab" aria-selected={mes === f.mes} onClick={() => setMes(f.mes)}
              className={`min-w-32 shrink-0 rounded-lg border px-3 py-2 text-left text-sm ${mes === f.mes ? 'border-azul bg-azul-claro' : 'border-slate-200'}`}>
              <span className="block font-semibold capitalize">{formatMonth(f.mes)}</span>
              <span className="block tabular-nums">{formatBRL(f.total)}</span>
              <span className={`mt-1 inline-block rounded px-1.5 text-xs font-medium ${s.estilo}`}>{s.texto}</span>
            </button>
          )
        })}
      </div>
      {mes && (() => {
        const f = faturas.find((x) => x.mes === mes)!
        return (
          <section aria-label={`Fatura de ${formatMonth(mes)}`} className="mt-3">
            <p className="text-sm text-slate-600">
              Fecha em {formatDate(f.fechamento)}{f.vencimento && <> · vence em {formatDate(f.vencimento)}</>}
              {f.pago > 0 && <> · pago {formatBRL(f.pago)}</>}
            </p>
            {f.aCobrar > 0 && f.cobrado > 0 && (
              <p className="text-xs text-planejado">Ainda vai entrar nesta fatura: {formatBRL(f.aCobrar)}</p>
            )}
            {itens === null ? <p className="mt-2 text-sm text-slate-600" role="status">Carregando…</p> : (
              <ul className="mt-2 divide-y divide-slate-100">
                {itens.map((i) => (
                  <li key={i.parcelaId} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {i.descricao}{i.deParcelas > 1 && <span className="text-slate-500"> · {i.parcela}/{i.deParcelas}</span>}
                      </p>
                      <p className="text-xs text-slate-500">
                        {i.dataCompra && <>compra em {formatDate(i.dataCompra)} · </>}{nomeCategoria.get(i.categoriaId) ?? 'Sem categoria'}
                        {i.falta > 0 && ' · a cobrar no fechamento'}
                      </p>
                    </div>
                    <span className="tabular-nums font-semibold text-negativo">−{formatBRL(i.valor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })()}
    </div>
  )
}

interface PropsBase { aoSalvar: () => Promise<void>; aoCancelar: () => void }

function useEnvio(aoSalvar: () => Promise<void>) {
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  async function enviar(acao: () => Promise<void>) {
    setErro('')
    setEnviando(true)
    try {
      await acao()
      await aoSalvar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }
  return { erro, enviando, enviar }
}

function Botoes({ rotulo, enviando, aoCancelar }: { rotulo: string; enviando: boolean; aoCancelar: () => void }) {
  return (
    <div className="flex gap-2 md:col-span-2">
      <Button type="submit" carregando={enviando}>{rotulo}</Button>
      <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
    </div>
  )
}

function FormCartao({ aoSalvar, aoCancelar }: PropsBase) {
  const [nome, setNome] = useState('')
  const [fechamento, setFechamento] = useState('')
  const [vencimento, setVencimento] = useState('')
  const [saldoTexto, setSaldoTexto] = useState('0,00')
  const [tentou, setTentou] = useState(false)
  const { erro, enviando, enviar } = useEnvio(aoSalvar)
  const saldo = parseBRL(saldoTexto)
  const erroSaldo = tentou && (saldo === null || saldo < 0) ? 'Valor inválido. Exemplo: 1.250,50' : undefined

  function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (!nome.trim() || !fechamento || !vencimento || saldo === null || saldo < 0) return
    void enviar(async () => { await criarCartao({ nome, fechamento: Number(fechamento), vencimento: Number(vencimento), saldoAtual: saldo }) })
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">Novo cartão</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo="Nome" maxLength={60} placeholder="Ex.: Nubank João" value={nome} onChange={(e) => setNome(e.target.value)}
          erro={tentou && !nome.trim() ? 'Informe o nome do cartão.' : undefined} />
        <Field rotulo="Faturas fechadas e não pagas hoje (R$)" inputMode="decimal" value={saldoTexto}
          onChange={(e) => setSaldoTexto(e.target.value)} erro={erroSaldo} />
        <Selecao rotulo="Dia do fechamento" valor={fechamento} aoMudar={setFechamento} opcoes={dias} todos="Escolha…" />
        <Selecao rotulo="Dia do vencimento" valor={vencimento} aoMudar={setVencimento} opcoes={dias} todos="Escolha…" />
        {tentou && (!fechamento || !vencimento) && <p role="alert" className="text-sm text-negativo md:col-span-2">Escolha o dia de fechamento e o de vencimento.</p>}
        <p className="text-sm text-slate-600 md:col-span-2">
          As compras da <strong>fatura aberta</strong> (e as parcelas que ainda vão vir) você lança depois, em <strong>Nova compra</strong>:
          assim cada uma cai no mês certo.
        </p>
        <Botoes rotulo="Cadastrar cartão" enviando={enviando} aoCancelar={aoCancelar} />
      </form>
    </Card>
  )
}

function FormCiclo({ cartao, aoSalvar, aoCancelar }: PropsBase & { cartao: Cartao }) {
  const [fechamento, setFechamento] = useState(cartao.fechamento ? String(cartao.fechamento) : '')
  const [vencimento, setVencimento] = useState(cartao.vencimento ? String(cartao.vencimento) : '')
  const { erro, enviando, enviar } = useEnvio(aoSalvar)

  function salvar(e: FormEvent) {
    e.preventDefault()
    if (!fechamento || !vencimento) return
    void enviar(() => definirCiclo(cartao.id, Number(fechamento), Number(vencimento)))
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">Fechamento e vencimento · {cartao.nome}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Selecao rotulo="Dia do fechamento" valor={fechamento} aoMudar={setFechamento} opcoes={dias} todos="Escolha…" />
        <Selecao rotulo="Dia do vencimento" valor={vencimento} aoMudar={setVencimento} opcoes={dias} todos="Escolha…" />
        <p className="text-sm text-slate-600 md:col-span-2">Vale para as próximas compras. Parcelas já lançadas continuam nas faturas em que estão.</p>
        <Botoes rotulo="Salvar" enviando={enviando} aoCancelar={aoCancelar} />
      </form>
    </Card>
  )
}

function FormCompra({ cartao, categorias, aoSalvar, aoCancelar }: PropsBase & { cartao: Cartao; categorias: Categoria[] }) {
  const hoje = hojeSP()
  const [andamento, setAndamento] = useState(false)
  const [descricao, setDescricao] = useState('')
  const [valorTexto, setValorTexto] = useState('')
  const [parcelasTexto, setParcelasTexto] = useState('1')
  const [data, setData] = useState(hoje)
  const [categoriaId, setCategoriaId] = useState('')
  const [tentou, setTentou] = useState(false)
  const { erro, enviando, enviar } = useEnvio(aoSalvar)

  const valor = parseBRL(valorTexto)
  const parcelas = Number(parcelasTexto)
  const parcelasOk = Number.isInteger(parcelas) && parcelas >= 1 && parcelas <= 72
  // em andamento: o valor informado é o de cada parcela que ainda falta
  const total: Cents | null = valor === null || !parcelasOk ? null : andamento ? asCents(valor * parcelas) : valor
  const despesas = categorias.filter((c) => c.tipo === 'expense' && c.ativa)

  const erroValor = tentou && (valor === null || valor <= 0 || total === null) ? 'Valor inválido. Exemplo: 1.250,50' : undefined
  const erroParcelas = tentou && !parcelasOk ? 'De 1 a 72 parcelas.' : undefined

  function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (!descricao.trim() || total === null || total <= 0 || !parcelasOk || !categoriaId || (!andamento && !data)) return
    void enviar(() => registrarCompra(cartao.id, { descricao, data: andamento ? hoje : data, total, parcelas, categoriaId }))
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">Nova compra · {cartao.nome}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <fieldset className="flex flex-wrap gap-4 md:col-span-2">
          <legend className="mb-1 text-sm font-medium">Tipo de compra</legend>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="modo" checked={!andamento} onChange={() => setAndamento(false)} /> Compra nova
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="modo" checked={andamento} onChange={() => setAndamento(true)} /> Parcelamento já em andamento
          </label>
        </fieldset>
        <Field rotulo="Descrição" maxLength={80} placeholder="Ex.: TV da sala" value={descricao} onChange={(e) => setDescricao(e.target.value)}
          erro={tentou && !descricao.trim() ? 'Informe a descrição.' : undefined} />
        <Selecao rotulo="Categoria" valor={categoriaId} aoMudar={setCategoriaId} todos="Escolha…"
          opcoes={despesas.map((c) => [c.id, c.paiId ? `↳ ${c.nome}` : c.nome])} />
        {tentou && !categoriaId && <p role="alert" className="text-sm text-negativo md:col-span-2">Escolha a categoria.</p>}
        <Field rotulo={andamento ? 'Valor de cada parcela (R$)' : 'Valor total (R$)'} inputMode="decimal" value={valorTexto}
          onChange={(e) => setValorTexto(e.target.value)} erro={erroValor} />
        <Field rotulo={andamento ? 'Parcelas que ainda faltam (incluindo a da fatura aberta)' : 'Parcelas'} type="number" min={1} max={72}
          inputMode="numeric" value={parcelasTexto} onChange={(e) => setParcelasTexto(e.target.value)} erro={erroParcelas} />
        {!andamento && (
          <Field rotulo="Data da compra" type="date" value={data} onChange={(e) => setData(e.target.value)} erro={tentou && !data ? 'Informe a data.' : undefined} />
        )}
        <p className="text-sm text-slate-600 md:col-span-2">
          {andamento
            ? 'As parcelas restantes entram a partir da fatura aberta, uma por mês.'
            : `Compra antes do dia ${cartao.fechamento} entra na fatura deste mês; no dia do fechamento ou depois, na seguinte. Cada parcela vira despesa no mês da fatura.`}
          {total !== null && parcelasOk && parcelas > 1 && <> Total: <strong className="tabular-nums">{formatBRL(total)}</strong>.</>}
        </p>
        <Botoes rotulo="Lançar compra" enviando={enviando} aoCancelar={aoCancelar} />
      </form>
    </Card>
  )
}

function FormPagar({ cartao, contas, aoSalvar, aoCancelar }: PropsBase & { cartao: Cartao; contas: Conta[] }) {
  const ativas = contas.filter((c) => c.ativa)
  const [contaId, setContaId] = useState(ativas[0]?.id ?? '')
  const [valorTexto, setValorTexto] = useState(formatBRL(cartao.divida).replace('R$ ', ''))
  const [data, setData] = useState(hojeSP())
  const [fatura, setFatura] = useState<Fatura | null>(null)
  const [tentou, setTentou] = useState(false)
  const { erro, enviando, enviar } = useEnvio(aoSalvar)

  useEffect(() => {
    const hoje = hojeSP()
    // fatura mais antiga já fechada e não paga: é a que o pagamento quita
    listarFaturas(cartao.id).then((fs) => setFatura(fs.find((f) => situacaoFatura(f, hoje) === 'fechada') ?? null)).catch(() => setFatura(null))
  }, [cartao.id])

  const valor = parseBRL(valorTexto)
  const erroValor = tentou && (valor === null || valor <= 0) ? 'Valor inválido.' : undefined

  function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (!contaId || valor === null || valor <= 0 || !data) return
    void enviar(() => pagarFatura(cartao.id, { contaId, data, valor, faturaId: fatura?.faturaId ?? null }))
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">Pagar fatura · {cartao.nome}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Selecao rotulo="Pagar com a conta" valor={contaId} aoMudar={setContaId} opcoes={ativas.map((c) => [c.id, c.nome])} todos="Escolha…" />
        <Field rotulo="Valor (R$)" inputMode="decimal" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} erro={erroValor} />
        <Field rotulo="Data do pagamento" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <p className="text-sm text-slate-600 md:col-span-2">
          {fatura ? <>Quita a fatura de <strong className="capitalize">{formatMonth(fatura.mes)}</strong>. </> : null}
          O pagamento sai da conta e reduz a dívida do cartão. Não é despesa: as compras já contaram no mês de cada fatura.
        </p>
        <Botoes rotulo="Registrar pagamento" enviando={enviando} aoCancelar={aoCancelar} />
      </form>
    </Card>
  )
}
