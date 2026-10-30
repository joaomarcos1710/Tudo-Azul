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
  criarDivida, definirTermosDivida, definirContratoDivida, listarDividas, listarParcelasDivida,
  registrarPagamentoDivida, registrarPagamentoParcela, simularQuitacao,
} from '../lib/dividas'
import type {
  DadosContratoDivida, Divida, ParcelaDivida, ResultadoQuitacao, TipoDivida,
} from '../lib/dividas'

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
  const [contrato, setContrato] = useState<Divida | null>(null)
  const [parcelaSelecionada, setParcelaSelecionada] = useState<ParcelaDivida | null>(null)
  const [parcelas, setParcelas] = useState<ParcelaDivida[]>([])
  const [orcamentoTexto, setOrcamentoTexto] = useState('')

  const carregar = useCallback(async () => {
    if (!familia?.id) return
    try {
      const hoje = hojeSP()
      const [lista, contasAtuais, cats, agenda] = await Promise.all([
        listarDividas(familia.id, hoje),
        listarContas(familia.id),
        listarCategorias(familia.id),
        listarParcelasDivida(familia.id, hoje, '2100-01-01'),
      ])
      setDividas(lista)
      setParcelas(agenda.slice(0, 12))
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

  async function salvarContrato(id: string, dados: DadosContratoDivida) {
    try {
      await definirContratoDivida(id, dados)
      setContrato(null)
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }

  async function salvarPagamentoAgendado(d: Parameters<typeof registrarPagamentoParcela>[0]) {
    try {
      await registrarPagamentoParcela(d)
      setParcelaSelecionada(null)
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }

  if (!familia) return null

  const orcamento = parseBRL(orcamentoTexto)
  const simulacaoSnowball = dividas && orcamento !== null ? simularQuitacao(dividas, orcamento, 'snowball') : null
  const simulacaoAvalanche = dividas && orcamento !== null ? simularQuitacao(dividas, orcamento, 'avalanche') : null

  return (
    <>
      <CabecalhoPagina
        titulo="Dívidas e empréstimos"
        descricao="Acompanhe o saldo devedor real, registre pagamentos e compare estratégias de quitação."
        acoes={!nova && <Button onClick={() => setNova(true)}>Nova dívida</Button>}
      />

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      <Aviso tipo="info">
        Nesta etapa, dívidas e pagamentos são registrados em reais. O saldo oficial continua vindo do motor financeiro existente. A simulação é uma estimativa e não altera contratos nem lançamentos.
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

      {contrato && (
        <FormContrato divida={contrato} contas={contas} aoSalvar={salvarContrato} aoCancelar={() => setContrato(null)} />
      )}

      {parcelaSelecionada && dividas && (
        <FormPagamento
          divida={dividas.find((d) => d.id === parcelaSelecionada.dividaId)!}
          contas={contas}
          categorias={categorias}
          parcela={parcelaSelecionada}
          aoSalvar={salvarPagamento}
          aoSalvarParcela={salvarPagamentoAgendado}
          aoCancelar={() => setParcelaSelecionada(null)}
        />
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
                      {d.parcelasRestantes !== null && (
                        <div>
                          <p className="text-xs text-slate-500">Parcelas restantes</p>
                          <p className="font-semibold">{d.parcelasRestantes} de {d.parcelasOriginais}</p>
                        </div>
                      )}
                      {d.valorParcela !== null && (
                        <div>
                          <p className="text-xs text-slate-500">Prestação contratual</p>
                          <p className="font-semibold tabular-nums">{formatBRL(d.valorParcela)}</p>
                        </div>
                      )}
                      {d.diaPagamento !== null && (
                        <div>
                          <p className="text-xs text-slate-500">Vencimento</p>
                          <p className="font-semibold">Dia {d.diaPagamento}</p>
                        </div>
                      )}
                      {d.credor && (
                        <div>
                          <p className="text-xs text-slate-500">Credor</p>
                          <p className="font-semibold">{d.credor}</p>
                        </div>
                      )}
                      {d.numeroContrato && (
                        <div>
                          <p className="text-xs text-slate-500">Contrato</p>
                          <p className="font-semibold">{d.numeroContrato}</p>
                        </div>
                      )}
                      {d.formaPagamento && (
                        <div>
                          <p className="text-xs text-slate-500">Forma de pagamento</p>
                          <p className="font-semibold">
                            {d.formaPagamento === 'account_debit' ? 'Débito automático' :
                              d.formaPagamento === 'boleto' ? 'Boleto' :
                                d.formaPagamento === 'payroll' ? 'Consignado' : 'Manual'}
                          </p>
                        </div>
                      )}
                      {d.formaPagamento === 'account_debit' && (
                        <div>
                          <p className="text-xs text-slate-500">Conta de pagamento</p>
                          <p className="font-semibold">{contas.find((c) => c.id === d.contaPagamentoId)?.nome ?? 'Conta não encontrada'}</p>
                        </div>
                      )}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(d.parcelasRestantes === null || d.parcelasRestantes === 0) && <Button compacto onClick={() => setPagando(d)}>Registrar pagamento</Button>}
                      <Button compacto variante="secundario" onClick={() => setTermos(d)}>Parâmetros da dívida</Button>
                      <Button compacto variante="secundario" onClick={() => setContrato(d)}>Contrato e parcelas</Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          </section>

          {parcelas.length > 0 && (
            <section className="mb-8" aria-labelledby="titulo-agenda-dividas">
              <h2 id="titulo-agenda-dividas" className="mb-3 text-lg font-semibold">Próximas parcelas</h2>
              <Card>
                <ul className="divide-y divide-slate-100">
                  {parcelas.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="font-medium">{p.nomeDivida} · parcela {p.numero}</p>
                        <p className="text-xs text-slate-500">
                          Vencimento {p.vencimento.split('-').reverse().join('/')} · {
                            p.formaPagamento === 'account_debit' ? 'Débito em conta' :
                            p.formaPagamento === 'boleto' ? 'Boleto' :
                            p.formaPagamento === 'payroll' ? 'Consignado' : 'Manual'
                          }
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <strong className="tabular-nums">{formatBRL(p.valor)}</strong>
                        <Button compacto onClick={() => setParcelaSelecionada(p)}>Baixar parcela</Button>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-slate-500">Parcelas futuras são compromissos planejados. Elas não reduzem o saldo da conta nem o saldo devedor até a confirmação do pagamento.</p>
              </Card>
            </section>
          )}

          <section aria-labelledby="titulo-simulador">
            <div className="mb-3">
              <h2 id="titulo-simulador" className="text-lg font-semibold">Simulador de quitação</h2>
              <p className="mt-1 text-sm text-slate-600">
                Informe quanto a família consegue destinar por mês. O simulador paga os mínimos de todas as dívidas e direciona o excedente conforme Snowball ou Avalanche.
              </p>
            </div>
            <Card>
              <div className="mb-4 max-w-sm">
                <Field
                  rotulo="Orçamento mensal total (R$)"
                  inputMode="decimal"
                  placeholder="Ex.: 2.500,00"
                  value={orcamentoTexto}
                  onChange={(e) => setOrcamentoTexto(e.target.value)}
                  erro={orcamentoTexto && orcamento === null ? 'Informe um valor válido.' : undefined}
                />
              </div>
              <p className="mb-4 text-xs text-slate-500">
                Configure a taxa mensal e o pagamento mínimo de cada dívida em “Parâmetros da dívida”. Se os dados estiverem zerados ou desatualizados, a estimativa pode ficar otimista.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <ResultadoSimulacao resultado={simulacaoSnowball} titulo="Snowball" explicacao="Prioriza o menor saldo primeiro." />
                <ResultadoSimulacao resultado={simulacaoAvalanche} titulo="Avalanche" explicacao="Prioriza a maior taxa mensal primeiro." />
              </div>
            </Card>
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


function primeiroVencimento(dia: number): string {
  const [ano, mes] = hojeSP().split('-').map(Number)
  const proximo = new Date(Date.UTC(ano, mes, 1))
  const y = proximo.getUTCFullYear()
  const m = proximo.getUTCMonth() + 1
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`
}

function FormContrato({ divida, contas, aoSalvar, aoCancelar }: {
  divida: Divida
  contas: Conta[]
  aoSalvar: (id: string, dados: DadosContratoDivida) => Promise<void>
  aoCancelar: () => void
}) {
  const diaInicial = divida.diaPagamento ?? 10
  const [credor, setCredor] = useState(divida.credor ?? '')
  const [numero, setNumero] = useState(divida.numeroContrato ?? '')
  const [originais, setOriginais] = useState(String(divida.parcelasOriginais ?? 60))
  const [restantes, setRestantes] = useState(String(divida.parcelasRestantes ?? 60))
  const [valor, setValor] = useState(divida.valorParcela === null ? '' : formatBRLCampo(divida.valorParcela))
  const [dia, setDia] = useState(String(diaInicial))
  const [forma, setForma] = useState<NonNullable<Divida['formaPagamento']>>(divida.formaPagamento ?? 'account_debit')
  const [conta, setConta] = useState(divida.contaPagamentoId ?? contas[0]?.id ?? '')
  const [primeiro, setPrimeiro] = useState(divida.primeiraDataVencimento ?? primeiroVencimento(diaInicial))
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    const nOriginais = Number(originais)
    const nRestantes = Number(restantes)
    const valorCents = parseBRL(valor)
    const nDia = Number(dia)
    if (!Number.isInteger(nOriginais) || nOriginais < 1 || nOriginais > 1200 ||
        !Number.isInteger(nRestantes) || nRestantes < 0 || nRestantes > nOriginais ||
        valorCents === null || valorCents <= 0 || !Number.isInteger(nDia) || nDia < 1 || nDia > 31 ||
        !primeiro || (forma === 'account_debit' && !conta)) {
      setErro('Confira o prazo, o valor da prestação, o dia de vencimento e a conta de débito.')
      return
    }
    setErro('')
    setEnviando(true)
    try {
      await aoSalvar(divida.id, {
        credor, numeroContrato: numero, parcelasOriginais: nOriginais, parcelasRestantes: nRestantes,
        valorParcela: valorCents, diaPagamento: nDia, formaPagamento: forma,
        contaPagamentoId: forma === 'account_debit' ? conta : null,
        primeiraDataVencimento: primeiro,
      })
    } finally { setEnviando(false) }
  }

  return (
    <Card className="mb-5">
      <h2 className="mb-3 text-lg font-semibold">Contrato e parcelas: {divida.nome}</h2>
      <form onSubmit={(e) => void enviar(e)} className="grid gap-3 md:grid-cols-2">
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo="Credor / instituição" value={credor} onChange={(e) => setCredor(e.target.value)} maxLength={100} placeholder="Ex.: Banco" />
        <Field rotulo="Número do contrato (opcional)" value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={80} />
        <Field rotulo="Prazo original (parcelas)" type="number" value={originais} onChange={(e) => setOriginais(e.target.value)} min={1} max={1200} />
        <Field rotulo="Parcelas restantes" type="number" value={restantes} onChange={(e) => setRestantes(e.target.value)} min={0} max={1200} />
        <Field rotulo="Valor da prestação (R$)" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex.: 1.250,00" />
        <Field rotulo="Dia de vencimento" type="number" value={dia} onChange={(e) => {
          setDia(e.target.value)
          const n = Number(e.target.value)
          if (Number.isInteger(n) && n >= 1 && n <= 31) setPrimeiro(primeiroVencimento(n))
        }} min={1} max={31} />
        <Field rotulo="Data do próximo vencimento" type="date" value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} />
        <Selecao rotulo="Forma de pagamento" valor={forma} aoMudar={(v) => setForma(v as NonNullable<Divida['formaPagamento']>)} opcoes={[
          ['account_debit', 'Débito automático em conta'], ['boleto', 'Boleto'], ['payroll', 'Consignado / desconto em folha'], ['manual', 'Pagamento manual'],
        ]} />
        {forma === 'account_debit' && (
          <Selecao rotulo="Conta do débito automático" valor={conta} aoMudar={setConta} todos="Selecione a conta"
            opcoes={contas.map((c) => [c.id, c.nome])} />
        )}
        {forma === 'payroll' && (
          <p className="text-sm text-slate-600 md:col-span-2">O consignado será exibido como compromisso. Ao confirmar a parcela, o saldo da dívida será atualizado sem criar uma segunda saída bancária.</p>
        )}
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando}>Salvar contrato e gerar parcelas</Button>
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

function FormPagamento({ divida, contas, categorias, aoSalvar, aoCancelar, parcela, aoSalvarParcela }: {
  divida: Divida
  contas: Conta[]
  categorias: Categoria[]
  aoSalvar: (d: Parameters<typeof registrarPagamentoDivida>[0]) => Promise<void>
  aoCancelar: () => void
  parcela?: ParcelaDivida
  aoSalvarParcela?: (d: Parameters<typeof registrarPagamentoParcela>[0]) => Promise<void>
}) {
  const consignado = parcela?.formaPagamento === 'payroll'
  const [data, setData] = useState(hojeSP())
  const [contaId, setContaId] = useState(parcela?.contaPagamentoId ?? contas[0]?.id ?? '')
  const [totalTexto, setTotalTexto] = useState(parcela ? formatBRLCampo(parcela.valor) : '')
  const [jurosTexto, setJurosTexto] = useState('0,00')
  const [tarifaTexto, setTarifaTexto] = useState('0,00')
  const [categoriaId, setCategoriaId] = useState(categorias[0]?.id ?? '')
  const [extra, setExtra] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const total = parseBRL(totalTexto)
  const juros = consignado ? asCents(0)! : parseBRL(jurosTexto)
  const tarifa = consignado ? asCents(0)! : parseBRL(tarifaTexto)
  const principal = total !== null && juros !== null && tarifa !== null ? asCents(total - juros - tarifa) : null
  const precisaCategoria = !consignado && ((juros ?? 0) > 0 || (tarifa ?? 0) > 0)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!data || (!consignado && !contaId) || total === null || total <= 0 || juros === null || juros < 0 ||
        tarifa === null || tarifa < 0 || principal === null || principal < 0 ||
        (precisaCategoria && !categoriaId)) {
      setErro('Confira a conta, a data e os valores. Juros e tarifas não podem superar o pagamento.')
      return
    }
    setErro('')
    setEnviando(true)
    try {
      if (parcela && aoSalvarParcela) {
        await aoSalvarParcela({
          parcelaId: parcela.id, data, contaId: consignado ? null : contaId,
          principal, juros, tarifa, categoriaId: precisaCategoria ? categoriaId : null, extra,
        })
      } else {
        await aoSalvar({
          dividaId: divida.id, data, contaId, principal, juros, tarifa,
          categoriaId: precisaCategoria ? categoriaId : null, extra,
        })
      }
    } finally { setEnviando(false) }
  }

  return (
    <Card className="mb-5">
      <h2 className="mb-3 text-lg font-semibold">{parcela ? 'Baixar parcela' : 'Registrar pagamento'}: {divida.nome}</h2>
      {consignado ? (
        <Aviso tipo="info">Consignado: informe apenas o valor que efetivamente amortizou o saldo devedor. A baixa não cria uma segunda saída na conta, pois o salário pode já estar registrado líquido.</Aviso>
      ) : contas.length === 0 && <Aviso tipo="erro">Cadastre ou reative uma conta antes de registrar o pagamento.</Aviso>}
      <form onSubmit={(e) => void enviar(e)} className="grid gap-3 md:grid-cols-2">
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo="Data do pagamento" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        {!consignado && (
          <Selecao rotulo="Conta de saída" valor={contaId} aoMudar={setContaId} todos="Selecione a conta"
            opcoes={contas.map((c) => [c.id, c.nome])} />
        )}
        <Field rotulo={consignado ? 'Valor amortizado no saldo (R$)' : 'Valor total pago (R$)'} inputMode="decimal"
          placeholder="Ex.: 1.250,00" value={totalTexto} onChange={(e) => setTotalTexto(e.target.value)} />
        {!consignado && (
          <>
            <Field rotulo="Juros incluídos (R$)" inputMode="decimal" value={jurosTexto} onChange={(e) => setJurosTexto(e.target.value)} />
            <Field rotulo="Tarifas incluídas (R$)" inputMode="decimal" value={tarifaTexto} onChange={(e) => setTarifaTexto(e.target.value)} />
            <Selecao rotulo="Categoria para juros/tarifas" valor={categoriaId} aoMudar={setCategoriaId} todos={precisaCategoria ? 'Selecione a categoria' : 'Não necessária'}
              opcoes={categorias.map((c) => [c.id, c.nome])} desabilitado={!precisaCategoria} />
          </>
        )}
        <p className="text-sm text-slate-600 md:col-span-2">
          Principal a amortizar: <strong>{principal === null || principal < 0 ? '—' : formatBRL(principal)}</strong>.
          {!consignado && ' Juros e tarifas são custos separados.'}
        </p>
        {!consignado && (
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} />
            Amortização extraordinária de principal
          </label>
        )}
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando} disabled={!consignado && contas.length === 0}>Confirmar baixa</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Card>
  )
}

function ResultadoSimulacao({ resultado, titulo, explicacao }: {
  resultado: ResultadoQuitacao | null
  titulo: string
  explicacao: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h3 className="font-semibold">{titulo}</h3>
      <p className="mb-3 text-xs text-slate-500">{explicacao}</p>
      {!resultado && <p className="text-sm text-slate-500">Informe o orçamento mensal para calcular.</p>}
      {resultado && (
        <>
          {resultado.erro && <p className="mb-2 text-sm text-amber-700">{resultado.erro}</p>}
          {resultado.meses > 0 && <p className="text-2xl font-bold">{resultado.quitado ? `${resultado.meses} meses` : `Mais de ${resultado.meses} meses`}</p>}
          {resultado.jurosTotais !== null && <p className="mt-2 text-sm">Juros estimados: <strong>{formatBRL(resultado.jurosTotais)}</strong></p>}
          {resultado.totalPago !== null && <p className="text-sm">Total pago: <strong>{formatBRL(resultado.totalPago)}</strong></p>}
          {resultado.quitado && resultado.ordemQuitacao.length > 0 && (
            <p className="mt-2 text-xs text-slate-600">Ordem de quitação: {resultado.ordemQuitacao.join(' → ')}</p>
          )}
          {resultado.prioridadeInicial.length > 0 && (
            <p className="mt-2 text-xs text-slate-500">Prioridade inicial: {resultado.prioridadeInicial.join(' → ')}</p>
          )}
        </>
      )}
    </div>
  )
}
