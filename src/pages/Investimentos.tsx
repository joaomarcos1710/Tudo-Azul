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
import { hojeSP } from '../lib/contas'
import { formatBRL, parseBRL } from '../lib/format'
import type { Cents } from '../lib/format'
import { valoresOcultos } from '../lib/privacidade'
import { mensagemErroBanco } from '../lib/erros'
import {
  criarAtivoInvestimento, excluirAtivoInvestimento, listarAtivosInvestimento, listarCarteiraInvestimentos,
  listarHistoricoInvestimentos, registrarAvaliacaoInvestimento, registrarOperacaoInvestimento,
} from '../lib/investimentos'
import type {
  AtivoInvestimento, ClasseAtivo, MoedaInvestimento, PosicaoInvestimento,
  HistoricoInvestimento, TipoOperacaoInvestimento, TotalInvestimento,
} from '../lib/investimentos'

const classes: [ClasseAtivo, string][] = [
  ['fixed_income', 'Renda fixa'], ['equity', 'Ações'], ['fund', 'Fundos de investimento'],
  ['reit', 'FIIs / REITs'], ['etf', 'ETFs'], ['crypto', 'Criptoativos'], ['other', 'Outros'],
]
const moedas: [MoedaInvestimento, string][] = [['BRL', 'Real (BRL)'], ['USD', 'Dólar (USD)'], ['EUR', 'Euro (EUR)']]

function moeda(valor: Cents, codigo: MoedaInvestimento): string {
  if (valoresOcultos()) return '••••'
  if (codigo === 'BRL') return formatBRL(valor)
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: codigo }).format(valor / 100)
}
function quantidade(valor: string): string {
  const n = Number(valor)
  return Number.isFinite(n) ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 }).format(n) : valor
}
function preco(valor: string, codigo: MoedaInvestimento): string {
  if (valoresOcultos()) return '••••'
  const n = Number(valor)
  return Number.isFinite(n)
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: codigo, maximumFractionDigits: 8 }).format(n)
    : valor
}

export default function Investimentos() {
  const { familia } = useFamilia()
  const [ativos, setAtivos] = useState<AtivoInvestimento[]>([])
  const [posicoes, setPosicoes] = useState<PosicaoInvestimento[]>([])
  const [totais, setTotais] = useState<TotalInvestimento[]>([])
  const [historico, setHistorico] = useState<HistoricoInvestimento[]>([])
  const [excluindoId, setExcluindoId] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [novoAtivo, setNovoAtivo] = useState(false)
  const [novaOperacao, setNovaOperacao] = useState(false)
  const [novaAvaliacao, setNovaAvaliacao] = useState(false)

  const carregar = useCallback(async () => {
    if (!familia?.id) return
    setCarregando(true)
    try {
      const hoje = hojeSP()
      const [lista, carteira, serie] = await Promise.all([
        listarAtivosInvestimento(familia.id),
        listarCarteiraInvestimentos(familia.id, hoje),
        listarHistoricoInvestimentos(familia.id, inicioHistorico(hoje), hoje).catch(() => []),
      ])
      setAtivos(lista)
      setPosicoes(carteira.posicoes)
      setTotais(carteira.totais)
      setHistorico(serie)
      setErro('')
    } catch (e) {
      setErro(mensagemErroBanco(e))
    } finally {
      setCarregando(false)
    }
  }, [familia?.id])

  useEffect(() => { void carregar() }, [carregar])
  const familiaId = familia?.id ?? ''
  if (!familiaId) return null

  async function salvarAtivo(d: { nome: string; ticker: string; classe: ClasseAtivo; moeda: MoedaInvestimento }) {
    try {
      await criarAtivoInvestimento({ familiaId, ...d })
      setNovoAtivo(false)
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }
  async function salvarOperacao(d: {
    ativoId: string; data: string; tipo: TipoOperacaoInvestimento; quantidade: string;
    precoUnitario: string; tarifas: Cents; observacao: string
  }) {
    try {
      await registrarOperacaoInvestimento(d)
      setNovaOperacao(false)
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }
  async function salvarAvaliacao(d: { ativoId: string; data: string; precoUnitario: string; fonte: string }) {
    try {
      await registrarAvaliacaoInvestimento(d)
      setNovaAvaliacao(false)
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }

  async function excluirAtivo(id: string, nome: string) {
    if (!window.confirm(`Excluir o ativo “${nome}”? Só é possível excluir ativos sem operações ou avaliações.`)) return
    setExcluindoId(id)
    try {
      await excluirAtivoInvestimento(id)
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
    finally { setExcluindoId(null) }
  }

  const ativosAtivos = ativos.filter((a) => a.ativo)
  return (
    <>
      <CabecalhoPagina
        titulo="Investimentos"
        descricao="Acompanhe ativos, operações, custo médio e avaliações da carteira familiar."
        acoes={
          <div className="flex flex-wrap gap-2">
            <Button variante="secundario" onClick={() => setNovoAtivo(true)}>Novo ativo</Button>
            <Button onClick={() => setNovaOperacao(true)} disabled={ativosAtivos.length === 0}>Registrar operação</Button>
          </div>
        }
      />
      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      <Aviso tipo="info">
        Cadastre o ativo e depois registre uma compra para que ele passe a compor o saldo investido. Ativos sem operações ou avaliações podem ser excluídos. O livro registra compras, vendas e avaliações manuais em BRL, USD ou EUR, sempre separados por moeda. As operações não movimentam as contas bancárias nem entram como receita ou despesa nesta etapa. Não há cotação automática.
      </Aviso>

      {novoAtivo && <FormAtivo aoSalvar={salvarAtivo} aoCancelar={() => setNovoAtivo(false)} />}
      {novaOperacao && (
        <FormOperacao ativos={ativosAtivos} aoSalvar={salvarOperacao} aoCancelar={() => setNovaOperacao(false)} />
      )}
      {novaAvaliacao && (
        <FormAvaliacao ativos={ativosAtivos} aoSalvar={salvarAvaliacao} aoCancelar={() => setNovaAvaliacao(false)} />
      )}

      <section className="mt-6" aria-labelledby="titulo-totais-investimentos">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="titulo-totais-investimentos" className="text-lg font-semibold">Resumo da carteira</h2>
            <p className="text-sm text-slate-500">Consolidado calculado no banco, sem conversão entre moedas.</p>
          </div>
          <Button compacto variante="secundario" onClick={() => setNovaAvaliacao(true)} disabled={ativosAtivos.length === 0}>Registrar avaliação</Button>
        </div>
        {carregando && <p role="status" className="text-sm text-slate-500">Atualizando carteira…</p>}
        {!carregando && totais.length === 0 && (
          <EmptyState titulo="Sua carteira ainda está vazia" descricao="Cadastre um ativo e registre uma compra para começar a acompanhar sua posição." acao={<Button onClick={() => setNovoAtivo(true)}>Cadastrar primeiro ativo</Button>} />
        )}
        {totais.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {totais.map((t) => (
              <Card key={t.moeda}>
                <p className="text-sm font-medium text-slate-500">Patrimônio em {t.moeda}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{moeda(t.valorAtual, t.moeda)}</p>
                <div className="mt-3 flex justify-between gap-2 text-sm">
                  <span className="text-slate-500">Custo de aquisição</span>
                  <strong className="tabular-nums">{moeda(t.custoTotal, t.moeda)}</strong>
                </div>
                <div className="mt-1 flex justify-between gap-2 text-sm">
                  <span className="text-slate-500">Resultado não realizado</span>
                  <strong className="tabular-nums">{moeda(t.resultado, t.moeda)}</strong>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8" aria-labelledby="titulo-evolucao-investimentos">
        <h2 id="titulo-evolucao-investimentos" className="mb-1 text-lg font-semibold">Evolução dos investimentos</h2>
        <p className="mb-3 text-sm text-slate-500">Valor estimado no fechamento de cada mês, por moeda, nos últimos 12 meses. Registre avaliações periódicas para acompanhar a valorização real.</p>
        {historico.some((p) => p.valorAtual > 0) ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {([...new Set(historico.filter((p) => p.valorAtual > 0).map((p) => p.moeda))] as MoedaInvestimento[]).map((codigo) => (
              <GraficoHistorico key={codigo} moedaCodigo={codigo} pontos={historico.filter((p) => p.moeda === codigo)} />
            ))}
          </div>
        ) : <p className="rounded-lg border border-dashed border-slate-300 p-5 text-sm text-slate-500">
          O gráfico aparecerá depois da primeira compra registrada. Para acompanhar a valorização, registre avaliações periódicas do ativo.
        </p>}
      </section>

      <section className="mt-8" aria-labelledby="titulo-posicoes">
        <h2 id="titulo-posicoes" className="mb-3 text-lg font-semibold">Ativos e posições</h2>
        {posicoes.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {posicoes.map((p) => <li key={p.assetId}><Card><Posicao p={p} /></Card></li>)}
          </ul>
        ) : !carregando && ativos.length > 0 ? (
          <EmptyState titulo="Ativos cadastrados, sem posição" descricao="Registre uma compra para que a posição apareça aqui." acao={<Button onClick={() => setNovaOperacao(true)}>Registrar compra</Button>} />
        ) : null}
      </section>

      <section className="mt-8" aria-labelledby="titulo-cadastro-ativos">
        <h2 id="titulo-cadastro-ativos" className="mb-3 text-lg font-semibold">Ativos cadastrados</h2>
        {ativos.length === 0 ? <p className="text-sm text-slate-500">Nenhum ativo cadastrado.</p> : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {ativos.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div><p className="font-medium">{a.nome}{a.ticker ? ` · ${a.ticker}` : ''}</p><p className="text-xs text-slate-500">{classes.find(([v]) => v === a.classe)?.[1] ?? a.classe} · {a.moeda}</p></div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{a.ativo ? 'Ativo' : 'Arquivado'}</span>
                  {a.quantidadeOperacoes === 0 && a.quantidadeAvaliacoes === 0 ? (
                    <Button compacto variante="secundario" type="button" carregando={excluindoId === a.id}
                      onClick={() => void excluirAtivo(a.id, a.nome)}>Excluir</Button>
                  ) : <span className="text-xs text-slate-500">Histórico protegido</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function inicioHistorico(hoje: string): string {
  const ano = Number(hoje.slice(0, 4))
  const mes = Number(hoje.slice(5, 7)) - 1
  const inicio = new Date(Date.UTC(ano, mes - 11, 1))
  return `${inicio.getUTCFullYear()}-${String(inicio.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function GraficoHistorico({ moedaCodigo, pontos }: { moedaCodigo: MoedaInvestimento; pontos: HistoricoInvestimento[] }) {
  const largura = 640, altura = 210, esquerda = 58, direita = 14, topo = 14, base = 32
  const valores = pontos.map((p) => p.valorAtual)
  const maximo = Math.max(1, ...valores)
  const x = (i: number) => esquerda + (pontos.length <= 1 ? 0 : i / (pontos.length - 1) * (largura - esquerda - direita))
  const y = (v: number) => topo + (1 - v / maximo) * (altura - topo - base)
  const caminho = pontos.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.valorAtual).toFixed(1)}`).join(' ')
  const rotulo = (valor: number) => moeda(valor as Cents, moedaCodigo)
  return <Card>
    <h3 className="mb-2 font-semibold">Evolução em {moedaCodigo}</h3>
    <svg viewBox={`0 0 ${largura} ${altura}`} className="h-auto w-full" role="img"
      aria-label={`Gráfico de evolução do investimento em ${moedaCodigo}`}>
      {[0, 0.5, 1].map((f) => <g key={f}>
        <line x1={esquerda} x2={largura - direita} y1={y(maximo * f)} y2={y(maximo * f)} stroke="#e2e8f0" />
        <text x={esquerda - 7} y={y(maximo * f) + 4} textAnchor="end" fontSize="10" fill="#64748b">{rotulo(maximo * f)}</text>
      </g>)}
      {caminho && <path d={caminho} fill="none" stroke="#1476d4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
      {pontos.map((p, i) => <g key={p.mes}>
        <circle cx={x(i)} cy={y(p.valorAtual)} r="3.5" fill="#1476d4" />
        {(i === 0 || i === pontos.length - 1 || i % 3 === 0) && <text x={x(i)} y={altura - 8} textAnchor="middle" fontSize="10" fill="#64748b">
          {new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${p.mes}T12:00:00Z`))}
        </text>}
      </g>)}
    </svg>
    <p className="mt-1 text-xs text-slate-500">Último valor: <strong>{rotulo(pontos[pontos.length - 1]?.valorAtual ?? 0)}</strong></p>
  </Card>
}

function Posicao({ p }: { p: PosicaoInvestimento }) {
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-semibold">{p.nome}{p.ticker ? ` · ${p.ticker}` : ''}</p><p className="text-sm text-slate-500">{classes.find(([v]) => v === p.classe)?.[1] ?? p.classe} · {p.moeda}</p></div>
        <div className="text-right"><p className="text-xs text-slate-500">Valor de mercado estimado</p><p className="text-xl font-bold tabular-nums">{moeda(p.valorAtual, p.moeda)}</p></div>
      </div>
      <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-xs text-slate-500">Quantidade</p><p className="font-semibold tabular-nums">{quantidade(p.quantidade)}</p></div>
        <div><p className="text-xs text-slate-500">Custo médio por unidade</p><p className="font-semibold tabular-nums">{preco(p.custoMedio, p.moeda)}</p></div>
        <div><p className="text-xs text-slate-500">Preço de referência</p><p className="font-semibold tabular-nums">{preco(p.precoAtual, p.moeda)}</p></div>
        <div><p className="text-xs text-slate-500">Resultado não realizado</p><p className="font-semibold tabular-nums">{moeda(p.resultado, p.moeda)}</p></div>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        {p.dataAvaliacao
          ? `Avaliação em ${new Date(p.dataAvaliacao + 'T12:00:00').toLocaleDateString('pt-BR')} · Fonte: ${p.fonteAvaliacao}`
          : 'Sem avaliação manual: o valor de referência usa o custo médio de aquisição.'}
      </p>
    </>
  )
}

function FormAtivo({ aoSalvar, aoCancelar }: {
  aoSalvar: (d: { nome: string; ticker: string; classe: ClasseAtivo; moeda: MoedaInvestimento }) => Promise<void>
  aoCancelar: () => void
}) {
  const [nome, setNome] = useState('')
  const [ticker, setTicker] = useState('')
  const [classe, setClasse] = useState<ClasseAtivo>('fixed_income')
  const [moedaAtivo, setMoedaAtivo] = useState<MoedaInvestimento>('BRL')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim()) { setErro('Informe o nome do ativo.'); return }
    setEnviando(true); setErro('')
    try { await aoSalvar({ nome, ticker, classe, moeda: moedaAtivo }) }
    finally { setEnviando(false) }
  }
  return <Card className="mb-5"><h2 className="mb-3 text-lg font-semibold">Cadastrar ativo</h2>
    <form onSubmit={(e) => void enviar(e)} className="grid gap-3 md:grid-cols-2">
      {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
      <Field rotulo="Nome do ativo" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} placeholder="Ex.: Tesouro Selic 2029" />
      <Field rotulo="Ticker ou código (opcional)" value={ticker} onChange={(e) => setTicker(e.target.value)} maxLength={20} placeholder="Ex.: PETR4, IVVB11, BTC" />
      <Selecao rotulo="Classe" valor={classe} aoMudar={(v) => setClasse(v as ClasseAtivo)} opcoes={classes} />
      <Selecao rotulo="Moeda do ativo" valor={moedaAtivo} aoMudar={(v) => setMoedaAtivo(v as MoedaInvestimento)} opcoes={moedas} />
      <div className="flex gap-2 md:col-span-2"><Button type="submit" carregando={enviando}>Salvar ativo</Button><Button variante="secundario" onClick={aoCancelar}>Cancelar</Button></div>
    </form>
  </Card>
}

function FormOperacao({ ativos, aoSalvar, aoCancelar }: {
  ativos: AtivoInvestimento[]
  aoSalvar: (d: { ativoId: string; data: string; tipo: TipoOperacaoInvestimento; quantidade: string; precoUnitario: string; tarifas: Cents; observacao: string }) => Promise<void>
  aoCancelar: () => void
}) {
  const [ativoId, setAtivoId] = useState(ativos[0]?.id ?? '')
  const [data, setData] = useState(hojeSP())
  const [tipo, setTipo] = useState<TipoOperacaoInvestimento>('buy')
  const [qtd, setQtd] = useState('')
  const [precoTexto, setPrecoTexto] = useState('')
  const [tarifaTexto, setTarifaTexto] = useState('0,00')
  const [observacao, setObservacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const tarifas = parseBRL(tarifaTexto)
  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!ativoId || !data || !/^\d{1,12}(?:[.,]\d{1,12})?$/.test(qtd.trim()) || Number(qtd.replace(',', '.')) <= 0 ||
        !/^\d{1,12}(?:[.,]\d{1,10})?$/.test(precoTexto.trim()) || Number(precoTexto.replace(',', '.')) <= 0 ||
        tarifas === null || tarifas < 0) { setErro('Confira ativo, data, quantidade, preço unitário e tarifas.'); return }
    setErro(''); setEnviando(true)
    try { await aoSalvar({ ativoId, data, tipo, quantidade: qtd, precoUnitario: precoTexto, tarifas, observacao }) }
    finally { setEnviando(false) }
  }
  const ativo = ativos.find((a) => a.id === ativoId)
  return <Card className="mb-5"><h2 className="mb-3 text-lg font-semibold">Registrar compra ou venda</h2>
    <form onSubmit={(e) => void enviar(e)} className="grid gap-3 md:grid-cols-2">
      {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
      <Selecao rotulo="Ativo" valor={ativoId} aoMudar={setAtivoId} opcoes={ativos.map((a) => [a.id, `${a.nome} · ${a.moeda}`])} />
      <Selecao rotulo="Operação" valor={tipo} aoMudar={(v) => setTipo(v as TipoOperacaoInvestimento)} opcoes={[['buy', 'Compra'], ['sell', 'Venda']]} />
      <Field rotulo="Data da operação" type="date" value={data} onChange={(e) => setData(e.target.value)} />
      <Field rotulo="Quantidade" inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} placeholder="Ex.: 10,5" />
      <Field rotulo={`Preço por unidade (${ativo?.moeda ?? ''})`} inputMode="decimal" value={precoTexto} onChange={(e) => setPrecoTexto(e.target.value)} placeholder="Ex.: 25,75" />
      <Field rotulo={`Tarifas (${ativo?.moeda ?? ''})`} inputMode="decimal" value={tarifaTexto} onChange={(e) => setTarifaTexto(e.target.value)} />
      <Field rotulo="Observação (opcional)" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} />
      <p className="text-sm text-slate-600 md:col-span-2">A venda não pode superar a quantidade disponível. As tarifas de compra integram o custo de aquisição médio.</p>
      <div className="flex gap-2 md:col-span-2"><Button type="submit" carregando={enviando}>Registrar operação</Button><Button variante="secundario" onClick={aoCancelar}>Cancelar</Button></div>
    </form>
  </Card>
}

function FormAvaliacao({ ativos, aoSalvar, aoCancelar }: {
  ativos: AtivoInvestimento[]
  aoSalvar: (d: { ativoId: string; data: string; precoUnitario: string; fonte: string }) => Promise<void>
  aoCancelar: () => void
}) {
  const [ativoId, setAtivoId] = useState(ativos[0]?.id ?? '')
  const [data, setData] = useState(hojeSP())
  const [precoTexto, setPrecoTexto] = useState('')
  const [fonte, setFonte] = useState('Informado manualmente')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const ativo = ativos.find((a) => a.id === ativoId)
  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!ativoId || !data || !/^\d{1,12}(?:[.,]\d{1,10})?$/.test(precoTexto.trim()) || Number(precoTexto.replace(',', '.')) <= 0 || !fonte.trim()) {
      setErro('Informe ativo, data, preço unitário e fonte da avaliação.'); return
    }
    setErro(''); setEnviando(true)
    try { await aoSalvar({ ativoId, data, precoUnitario: precoTexto, fonte }) }
    finally { setEnviando(false) }
  }
  return <Card className="mb-5"><h2 className="mb-3 text-lg font-semibold">Registrar avaliação manual</h2>
    <form onSubmit={(e) => void enviar(e)} className="grid gap-3 md:grid-cols-2">
      {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
      <Selecao rotulo="Ativo" valor={ativoId} aoMudar={setAtivoId} opcoes={ativos.map((a) => [a.id, `${a.nome} · ${a.moeda}`])} />
      <Field rotulo="Data da avaliação" type="date" value={data} onChange={(e) => setData(e.target.value)} />
      <Field rotulo={`Preço atual por unidade (${ativo?.moeda ?? ''})`} inputMode="decimal" value={precoTexto} onChange={(e) => setPrecoTexto(e.target.value)} placeholder="Ex.: 31,42" />
      <Field rotulo="Fonte" value={fonte} onChange={(e) => setFonte(e.target.value)} maxLength={80} placeholder="Ex.: extrato da corretora" />
      <p className="text-sm text-slate-600 md:col-span-2">A avaliação guarda um histórico imutável. O preço informado é por unidade, não o valor total da posição.</p>
      <div className="flex gap-2 md:col-span-2"><Button type="submit" carregando={enviando}>Salvar avaliação</Button><Button variante="secundario" onClick={aoCancelar}>Cancelar</Button></div>
    </form>
  </Card>
}
