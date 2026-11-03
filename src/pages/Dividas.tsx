import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { Selecao } from '../components/ui/Selecao'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { useFamilia } from '../lib/FamiliaContext'
import { hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { listarCategorias } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import { asCents, formatBRL, formatBRLCampo, parseBRL } from '../lib/format'
import type { Cents } from '../lib/format'
import { mensagemErroBanco } from '../lib/erros'
import {
  criarDivida, definirTermosDivida, listarDividas, registrarPagamentoDivida,
} from '../lib/dividas'
import type { Divida, TipoDivida } from '../lib/dividas'

function taxaBps(texto: string): number | null {
  const valor = texto.trim().replace(',', '.')
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(valor)) return null
  const percentual = Number(valor)
  return Number.isFinite(percentual) && percentual >= 0 && percentual <= 100 ? Math.round(percentual * 100) : null
}

export default function Dividas() {
  const { familia } = useFamilia()
  const [dividas, setDividas] = useState<Divida[] | null>(null)
  const [contas, setContas] = useState<Conta[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [erro, setErro] = useState('')
  const [nova, setNova] = useState(false)
  const [pagando, setPagando] = useState<Divida | null>(null)
  const [termos, setTermos] = useState<Divida | null>(null)

  const carregar = useCallback(async () => {
    if (!familia?.id) return
    try {
      const [lista, contasAtuais, cats] = await Promise.all([
        listarDividas(familia.id, hojeSP()),
        listarContas(familia.id),
        listarCategorias(familia.id),
      ])
      setDividas(lista)
      setContas(contasAtuais.contas.filter((c) => c.ativa))
      setCategorias(cats.filter((c) => c.tipo === 'expense' && c.ativa))
      setErro('')
    } catch (e) {
      setErro(mensagemErroBanco(e))
    }
  }, [familia?.id])

  useEffect(() => { void carregar() }, [carregar])

  async function salvarNova(d: { nome: string; tipo: TipoDivida; dataReferencia: string; saldoReferencia: Cents }) {
    if (!familia?.id) return
    try {
      await criarDivida(d)
      setNova(false)
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }

  async function salvarPagamento(d: Parameters<typeof registrarPagamentoDivida>[0]) {
    try {
      await registrarPagamentoDivida(d)
      setPagando(null)
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }

  async function salvarTermos(id: string, taxa: number, minimo: Cents) {
    try {
      await definirTermosDivida(id, taxa, minimo)
      setTermos(null)
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }

  if (!familia) return null

  return (
    <>
      <CabecalhoPagina
        titulo="Dívidas e empréstimos"
        descricao="Acompanhe o saldo devedor real e registre os pagamentos de empréstimos e financiamentos."
        acoes={!nova && <Button onClick={() => setNova(true)}>Nova dívida</Button>}
      />

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      <Aviso tipo="info">
        Nesta etapa, dívidas e pagamentos são registrados em reais. O saldo oficial continua vindo do motor financeiro existente.
      </Aviso>

      {nova && (
        <FormNovaDivida aoSalvar={salvarNova} aoCancelar={() => setNova(false)} />
      )}

      {pagando && (
        <FormPagamento
          divida={pagando}
          contas={contas}
          categorias={categorias}
          aoSalvar={salvarPagamento}
          aoCancelar={() => setPagando(null)}
        />
      )}

      {termos && (
        <FormTermos divida={termos} aoSalvar={salvarTermos} aoCancelar={() => setTermos(null)} />
      )}

      {dividas === null && !erro && <p role="status" className="text-sm text-slate-600">Carregando dívidas…</p>}

      {dividas?.length === 0 && !nova && (
        <EmptyState
          titulo="Nenhum empréstimo ou financiamento cadastrado"
          descricao="Cadastre o saldo devedor atual de um empréstimo ou financiamento. Cartões continuam sendo gerenciados na tela Cartões."
          acao={<Button onClick={() => setNova(true)}>Cadastrar dívida</Button>}
        />
      )}

      {dividas && dividas.length > 0 && (
        <>
          <section className="mb-8" aria-labelledby="titulo-dividas-ativas">
            <h2 id="titulo-dividas-ativas" className="mb-3 text-lg font-semibold">Empréstimos e financiamentos</h2>
            <ul className="flex flex-col gap-3">
              {dividas.map((d) => (
                <li key={d.id}>
                  <Card>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{d.nome}</p>
                        <p className="text-sm text-slate-500">{d.tipo === 'loan' ? 'Empréstimo' : 'Financiamento'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-slate-500">Saldo devedor</p>
                        <p className="text-xl font-bold tabular-nums">{formatBRL(d.saldo)}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-3">
                      <div>
                        <p className="text-xs text-slate-500">Compromissos futuros</p>
                        <p className="font-semibold tabular-nums">{formatBRL(d.compromissos)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Taxa mensal informada</p>
                        <p className="font-semibold">{(d.taxaMensalBps / 100).toFixed(2).replace('.', ',')}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Pagamento mínimo</p>
                        <p className="font-semibold tabular-nums">{formatBRL(d.pagamentoMinimo)}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button compacto onClick={() => setPagando(d)}>Registrar pagamento</Button>
                      <Button compacto variante="secundario" onClick={() => setTermos(d)}>Parâmetros da dívida</Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  )
}

function FormNovaDivida({ aoSalvar, aoCancelar }: {
  aoSalvar: (d: { nome: string; tipo: TipoDivida; dataReferencia: string; saldoReferencia: Cents }) => Promise<void>
  aoCancelar: () => void
}) {
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<TipoDivida>('loan')
  const [data, setData] = useState(hojeSP())
  const [saldoTexto, setSaldoTexto] = useState('')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const saldo = parseBRL(saldoTexto)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim() || !data || saldo === null || saldo < 0) {
      setErro('Informe nome, data e um saldo devedor válido, igual ou maior que zero.')
      return
    }
    setErro('')
    setEnviando(true)
    try { await aoSalvar({ nome, tipo, dataReferencia: data, saldoReferencia: saldo }) }
    finally { setEnviando(false) }
  }

  return (
    <Card className="mb-5">
      <h2 className="mb-3 text-lg font-semibold">Cadastrar empréstimo ou financiamento</h2>
      <form onSubmit={(e) => void enviar(e)} className="grid gap-3 md:grid-cols-2">
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo="Nome" placeholder="Ex.: Financiamento do imóvel" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} />
        <Selecao rotulo="Modalidade" valor={tipo} aoMudar={(v) => setTipo(v as TipoDivida)} opcoes={[['loan', 'Empréstimo'], ['financing', 'Financiamento']]} />
        <Field rotulo="Saldo devedor atual (R$)" inputMode="decimal" placeholder="Ex.: 85.000,00" value={saldoTexto} onChange={(e) => setSaldoTexto(e.target.value)} />
        <Field rotulo="Data de referência do saldo" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <p className="text-sm text-slate-600 md:col-span-2">Use o saldo devedor informado pelo banco na data escolhida. Não informe a soma das parcelas futuras.</p>
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando}>Cadastrar</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Card>
  )
}

function FormTermos({ divida, aoSalvar, aoCancelar }: {
  divida: Divida
  aoSalvar: (id: string, taxa: number, minimo: Cents) => Promise<void>
  aoCancelar: () => void
}) {
  const [taxaTexto, setTaxaTexto] = useState((divida.taxaMensalBps / 100).toFixed(2).replace('.', ','))
  const [minimoTexto, setMinimoTexto] = useState(formatBRLCampo(divida.pagamentoMinimo))
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  async function enviar(e: FormEvent) {
    e.preventDefault()
    const taxa = taxaBps(taxaTexto)
    const minimo = parseBRL(minimoTexto)
    if (taxa === null || minimo === null || minimo < 0) {
      setErro('Informe uma taxa mensal entre 0 e 100% e um pagamento mínimo válido.')
      return
    }
    setErro('')
    setEnviando(true)
    try { await aoSalvar(divida.id, taxa, minimo) }
    finally { setEnviando(false) }
  }
  return (
    <Card className="mb-5">
      <h2 className="mb-3 text-lg font-semibold">Parâmetros: {divida.nome}</h2>
      <form onSubmit={(e) => void enviar(e)} className="grid gap-3 md:grid-cols-2">
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo="Taxa de juros mensal (%)" inputMode="decimal" placeholder="Ex.: 1,50" value={taxaTexto} onChange={(e) => setTaxaTexto(e.target.value)} />
        <Field rotulo="Pagamento mínimo mensal (R$)" inputMode="decimal" value={minimoTexto} onChange={(e) => setMinimoTexto(e.target.value)} />
        <p className="text-sm text-slate-600 md:col-span-2">A taxa é armazenada em pontos-base. O pagamento mínimo considera o valor total da prestação, incluindo juros.</p>
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando}>Salvar parâmetros</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Card>
  )
}

function FormPagamento({ divida, contas, categorias, aoSalvar, aoCancelar }: {
  divida: Divida
  contas: Conta[]
  categorias: Categoria[]
  aoSalvar: (d: Parameters<typeof registrarPagamentoDivida>[0]) => Promise<void>
  aoCancelar: () => void
}) {
  const [data, setData] = useState(hojeSP())
  const [contaId, setContaId] = useState(contas[0]?.id ?? '')
  const [totalTexto, setTotalTexto] = useState('')
  const [jurosTexto, setJurosTexto] = useState('0,00')
  const [tarifaTexto, setTarifaTexto] = useState('0,00')
  const [categoriaId, setCategoriaId] = useState(categorias[0]?.id ?? '')
  const [extra, setExtra] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const total = parseBRL(totalTexto)
  const juros = parseBRL(jurosTexto)
  const tarifa = parseBRL(tarifaTexto)
  const principal = total !== null && juros !== null && tarifa !== null ? asCents(total - juros - tarifa) : null
  const precisaCategoria = (juros ?? 0) > 0 || (tarifa ?? 0) > 0

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!data || !contaId || total === null || total <= 0 || juros === null || juros < 0 ||
        tarifa === null || tarifa < 0 || principal === null || principal < 0 ||
        (precisaCategoria && !categoriaId)) {
      setErro('Confira a conta, a data e os valores. Juros e tarifas não podem superar o pagamento total.')
      return
    }
    setErro('')
    setEnviando(true)
    try {
      await aoSalvar({
        dividaId: divida.id, data, contaId, principal, juros, tarifa,
        categoriaId: precisaCategoria ? categoriaId : null, extra,
      })
    } finally { setEnviando(false) }
  }

  return (
    <Card className="mb-5">
      <h2 className="mb-3 text-lg font-semibold">Registrar pagamento: {divida.nome}</h2>
      {contas.length === 0 && <Aviso tipo="erro">Cadastre ou reative uma conta antes de registrar o pagamento.</Aviso>}
      <form onSubmit={(e) => void enviar(e)} className="grid gap-3 md:grid-cols-2">
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo="Data do pagamento" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <Selecao rotulo="Conta de saída" valor={contaId} aoMudar={setContaId} todos="Selecione a conta"
          opcoes={contas.map((c) => [c.id, c.nome])} />
        <Field rotulo="Valor total pago (R$)" inputMode="decimal" placeholder="Ex.: 1.250,00" value={totalTexto} onChange={(e) => setTotalTexto(e.target.value)} />
        <Field rotulo="Juros incluídos (R$)" inputMode="decimal" value={jurosTexto} onChange={(e) => setJurosTexto(e.target.value)} />
        <Field rotulo="Tarifas incluídas (R$)" inputMode="decimal" value={tarifaTexto} onChange={(e) => setTarifaTexto(e.target.value)} />
        <Selecao rotulo="Categoria para juros/tarifas" valor={categoriaId} aoMudar={setCategoriaId} todos={precisaCategoria ? 'Selecione a categoria' : 'Não necessária'}
          opcoes={categorias.map((c) => [c.id, c.nome])} desabilitado={!precisaCategoria} />
        <p className="text-sm text-slate-600 md:col-span-2">
          Principal a amortizar: <strong>{principal === null || principal < 0 ? '—' : formatBRL(principal)}</strong>. O pagamento reduz o saldo devedor pelo principal; juros e tarifas são custos separados.
        </p>
        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} />
          Amortização extraordinária de principal
        </label>
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando} disabled={contas.length === 0}>Registrar pagamento</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Card>
  )
}
