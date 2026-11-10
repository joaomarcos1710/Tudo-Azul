import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { Selecao } from '../components/ui/Selecao'
import { Chip, Chips, GrupoFiltro, TelaFiltros } from '../components/ui/TelaFiltros'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { useFamilia } from '../lib/FamiliaContext'
import { aceitaLancamento, hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { currentMonth } from '../lib/format'
import { limitesDoMes, somarMeses } from '../lib/lancamentos'
import { formatBRL, formatDate, parseBRL } from '../lib/format'
import type { Cents } from '../lib/format'
import { valoresOcultos } from '../lib/privacidade'
import { mensagemErroBanco } from '../lib/erros'
import { corDoValor } from '../lib/cores'
import { COR_GRADE, COR_LINHA, COR_TEXTO_EIXO } from '../components/graficos/cores'
import {
  LIQUIDEZES, MACROS, SUGESTOES_SUBCLASSE, TIPOS_PROVENTO, anularOperacaoInvestimento, arquivarAtivoInvestimento, criarAtivoInvestimento, definirLiquidezAtivo, definirSubclasseAtivo, listarLiquidezInvestimentos, editarAtivoInvestimento, excluirAtivoComHistorico, excluirAtivoInvestimento,
  listarAlocacaoInvestimentos, listarAtivosInvestimento, listarExtratoAtivo, listarCarteiraInvestimentos, listarHistoricoInvestimentos, listarProventosPorAtivo, macroDaClasse,
  reativarAtivoInvestimento, registrarAvaliacaoInvestimento, registrarOperacaoInvestimento, registrarProventoInvestimento,
} from '../lib/investimentos'
import type {
  AtivoInvestimento, ClasseAtivo, HistoricoInvestimento, LinhaAlocacao, LinhaExtratoAtivo, LinhaLiquidez, Liquidez, MoedaInvestimento, PosicaoInvestimento, ProventoAtivo,
  TipoOperacaoInvestimento, TipoProvento, TotalInvestimento,
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
  // vazio também quando o banco ainda não tem a migration 034: a seção de alocação só some, o resto da tela segue
  const [alocacao, setAlocacao] = useState<LinhaAlocacao[]>([])
  // vazio quando o banco ainda não tem a migration da liquidez: o bloco some, o resto da tela segue
  const [liquidez, setLiquidez] = useState<LinhaLiquidez[]>([])
  const [filtroMacro, setFiltroMacro] = useState('')
  const [filtroSub, setFiltroSub] = useState('')
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [editandoSub, setEditandoSub] = useState<string | null>(null)
  const [editandoAtivo, setEditandoAtivo] = useState<AtivoInvestimento | null>(null)
  const [extratoDe, setExtratoDe] = useState<string | null>(null)
  const [proventos, setProventos] = useState<ProventoAtivo[]>([])
  const [contas, setContas] = useState<Conta[]>([])
  const [novoProvento, setNovoProvento] = useState(false)
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
      try { setAlocacao(await listarAlocacaoInvestimentos(familia.id, hojeSP())) } catch { setAlocacao([]) }
      try { setLiquidez(await listarLiquidezInvestimentos(familia.id, hoje)) } catch { setLiquidez([]) }
      // proventos: 12 meses para trás e 6 para frente (os planejados). Sem a migration 035, a seção só some.
      try {
        const mes = currentMonth()
        setProventos(await listarProventosPorAtivo(familia.id, limitesDoMes(somarMeses(mes, -11))[0], limitesDoMes(somarMeses(mes, 6))[1]))
      } catch { setProventos([]) }
      try { setContas((await listarContas(familia.id)).contas) } catch { setContas([]) }
    } catch (e) {
      setErro(mensagemErroBanco(e))
    } finally {
      setCarregando(false)
    }
  }, [familia?.id])

  useEffect(() => { void carregar() }, [carregar])
  const familiaId = familia?.id ?? ''
  if (!familiaId) return null

  async function salvarAtivo(d: { nome: string; ticker: string; classe: ClasseAtivo; moeda: MoedaInvestimento; subclasse: string; liquidez: Liquidez }) {
    try {
      const { subclasse, liquidez: liq, ...ativo } = d
      const id = await criarAtivoInvestimento({ familiaId, ...ativo })
      setNovoAtivo(false)
      let avisoSub = ''
      if (subclasse.trim()) {
        try { await definirSubclasseAtivo(id, subclasse) } catch (e) {
          avisoSub = `Ativo cadastrado, mas a subclasse não foi salva: ${mensagemErroBanco(e)}`
        }
      }
      // o ativo nasce líquido no banco; só o restrito precisa da segunda chamada
      if (liq === 'restricted') {
        try { await definirLiquidezAtivo(id, liq) } catch (e) {
          avisoSub = `Ativo cadastrado como líquido: não foi possível marcar como restrito. ${mensagemErroBanco(e)}`
        }
      }
      await carregar() // recarregar limpa o erro; por isso o aviso da subclasse entra depois
      if (avisoSub) setErro(avisoSub)
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }
  async function salvarProvento(d: {
    ativoId: string; tipo: TipoProvento; data: string; valor: Cents; contaId: string; status: 'paid' | 'planned'; observacao: string
  }) {
    try {
      await registrarProventoInvestimento(d)
      setNovoProvento(false)
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }
  async function acaoNoAtivo(acao: () => Promise<void>) {
    try {
      await acao()
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }
  // o erro sobe para o formulário (que fica aberto e o mostra perto dos campos, não no topo da página)
  async function salvarEdicaoAtivo(d: { ativoId: string; nome: string; ticker: string; classe: ClasseAtivo }) {
    await editarAtivoInvestimento(d)
    setEditandoAtivo(null)
    await carregar()
  }
  async function salvarSubclasse(ativoId: string, subclasse: string) {
    try {
      await definirSubclasseAtivo(ativoId, subclasse)
      setEditandoSub(null)
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
    if (!window.confirm(`Excluir o ativo “${nome}”? Se ele tiver histórico, vou pedir o nome para confirmar.`)) return
    setExcluindoId(id)
    try {
      try {
        await excluirAtivoInvestimento(id)
      } catch (e) {
        // 55000: o ativo tem histórico. Só sai junto com ele, digitando o nome (migration 050).
        if ((e as { code?: string })?.code !== '55000') throw e
        const digitado = window.prompt(
          `“${nome}” tem operações, avaliações ou proventos. Excluir apaga esse histórico para sempre ` +
          `(a receita dos proventos continua na conta). Para confirmar, digite o nome do ativo:`)
        if (digitado === null) return
        await excluirAtivoComHistorico(id, digitado)
      }
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
    finally { setExcluindoId(null) }
  }

  const ativosAtivos = ativos.filter((a) => a.ativo)
  // provento vira receita numa conta em reais (multimoeda F2: provento segue só em BRL; o banco também recusa): só ativos em BRL
  const ativosEmReais = ativosAtivos.filter((a) => a.moeda === 'BRL')
  const contasAtivas = contas.filter((c) => c.ativa && aceitaLancamento(c, 'cartao_divida_provento'))
  const porId = new Map(ativos.map((a) => [a.id, a]))
  const subclassesExistentes = [...new Set(ativos.map((a) => a.subclasse).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const posicoesFiltradas = posicoes.filter((p) =>
    (!filtroMacro || macroDaClasse(p.classe) === filtroMacro) && (!filtroSub || porId.get(p.assetId)?.subclasse === filtroSub))
  return (
    <>
      <CabecalhoPagina
        titulo="Investimentos"
        descricao="Acompanhe ativos, operações, custo médio e avaliações da carteira familiar."
        acoes={
          <div className="flex flex-wrap gap-2">
            <Button variante="secundario" onClick={() => setNovoAtivo(true)}>Novo ativo</Button>
            <Button variante="secundario" onClick={() => setNovoProvento(true)} disabled={ativosEmReais.length === 0}>Registrar provento</Button>
            <Button onClick={() => setNovaOperacao(true)} disabled={ativosAtivos.length === 0}>Registrar operação</Button>
          </div>
        }
      />
      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      <Aviso tipo="info">
        Nesta primeira etapa, o livro de investimentos registra compras, vendas e avaliações manuais em BRL, USD ou EUR. Os valores ficam separados por moeda. As operações ainda não movimentam as contas bancárias nem entram como receita ou despesa; a integração de caixa será feita numa etapa própria para evitar dupla contagem. Não há cotação automática nesta versão.
      </Aviso>

      {novoAtivo && <RolarAoAbrir><FormAtivo aoSalvar={salvarAtivo} aoCancelar={() => setNovoAtivo(false)} /></RolarAoAbrir>}
      {novaOperacao && (
        <RolarAoAbrir><FormOperacao ativos={ativosAtivos} aoSalvar={salvarOperacao} aoCancelar={() => setNovaOperacao(false)} /></RolarAoAbrir>
      )}
      {novoProvento && (
        <RolarAoAbrir><FormProvento ativos={ativosEmReais} contas={contasAtivas} aoSalvar={salvarProvento} aoCancelar={() => setNovoProvento(false)} /></RolarAoAbrir>
      )}
      {novaAvaliacao && (
        <RolarAoAbrir><FormAvaliacao ativos={ativosAtivos} aoSalvar={salvarAvaliacao} aoCancelar={() => setNovaAvaliacao(false)} /></RolarAoAbrir>
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
                <p className="text-sm font-medium text-slate-500">Valor de mercado em {t.moeda}</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{moeda(t.valorAtual, t.moeda)}</p>
                {/* uma grade só para os dois pares: os rótulos ficam na mesma coluna e os valores terminam na mesma borda direita */}
                <dl className="mt-3 grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1 text-sm">
                  <dt className="text-slate-500">Custo de aquisição</dt>
                  <dd className="m-0 text-right font-bold tabular-nums">{moeda(t.custoTotal, t.moeda)}</dd>
                  <dt className="text-slate-500">Resultado não realizado</dt>
                  <dd className={`m-0 text-right font-bold tabular-nums ${corDoValor(t.resultado)}`}>{moeda(t.resultado, t.moeda)}</dd>
                </dl>
              </Card>
            ))}
          </div>
        )}
      </section>

      {liquidez.length > 0 && (
        <section className="mt-8" aria-labelledby="titulo-liquidez-investimentos">
          <h2 id="titulo-liquidez-investimentos" className="mb-1 text-lg font-semibold">Por liquidez</h2>
          <p className="mb-3 text-sm text-slate-500">Líquido dá para resgatar ou vender. Restrito (previdência, FGTS) conta no patrimônio, mas não é dinheiro disponível.</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {([...new Set(liquidez.map((l) => l.moeda))] as MoedaInvestimento[]).map((codigo) => (
              <Card key={codigo}>
                <p className="text-sm font-medium text-slate-500">{codigo}</p>
                <dl className="mt-2 grid grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1 text-sm">
                  {LIQUIDEZES.map(([chave]) => (
                    <div key={chave} className="contents">
                      <dt className="text-slate-500">{chave === 'liquid' ? 'Líquido' : 'Restrito'}</dt>
                      <dd className="m-0 text-right font-bold tabular-nums">{moeda(liquidez.find((l) => l.moeda === codigo && l.liquidez === chave)?.valor ?? (0 as Cents), codigo)}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            ))}
          </div>
        </section>
      )}

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

      {alocacao.length > 0 && <SecaoAlocacao linhas={alocacao} />}
      {proventos.length > 0 && <SecaoProventos linhas={proventos} />}

      <section className="mt-8" aria-labelledby="titulo-posicoes">
        <h2 id="titulo-posicoes" className="mb-3 text-lg font-semibold">Ativos e posições</h2>
        {posicoes.length > 0 && (
          // filtros na tela cheia compartilhada (pedido do dono, 10/11/2026, como em Lançamentos); aqui só o botão e os selos.
          // Filtra só a lista na tela: nenhum valor muda e nada é pedido ao banco, então cada toque vale na hora.
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setFiltrosAbertos(true)} aria-haspopup="dialog" aria-expanded={filtrosAbertos}
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-azul hover:bg-azul-claro">
              Filtrar{(filtroMacro || filtroSub) && <span className="ml-1.5 rounded-full bg-azul px-1.5 text-xs text-white">{[filtroMacro, filtroSub].filter(Boolean).length}</span>}
            </button>
            {filtroMacro && (
              <button type="button" onClick={() => setFiltroMacro('')} aria-label={`Tirar o filtro ${MACROS.find((m) => m.chave === filtroMacro)?.rotulo}`}
                className="inline-flex min-h-9 items-center gap-1 rounded-full bg-azul-claro px-3 text-xs font-semibold text-marinho">
                {MACROS.find((m) => m.chave === filtroMacro)?.rotulo}<span aria-hidden="true">×</span>
              </button>
            )}
            {filtroSub && (
              <button type="button" onClick={() => setFiltroSub('')} aria-label={`Tirar o filtro ${filtroSub}`}
                className="inline-flex min-h-9 items-center gap-1 rounded-full bg-azul-claro px-3 text-xs font-semibold text-marinho">
                {filtroSub}<span aria-hidden="true">×</span>
              </button>
            )}
          </div>
        )}
        {filtrosAbertos && (
          <TelaFiltros titulo="Filtrar posições" aoFechar={() => setFiltrosAbertos(false)}
            acaoPrincipal={{ rotulo: 'Filtrar', nomeAcessivel: 'Filtrar: ver as posições', aoAcionar: () => setFiltrosAbertos(false) }}
            rodape={<button type="button" onClick={() => { setFiltroMacro(''); setFiltroSub('') }} disabled={!filtroMacro && !filtroSub}
              className="min-h-11 text-sm font-semibold text-azul hover:underline disabled:text-slate-400 disabled:no-underline">Limpar filtros</button>}>
            <GrupoFiltro titulo="Macroclasse">
              <Chips>
                {MACROS.map((m) => (
                  <Chip key={m.chave} pressionado={filtroMacro === m.chave} onClick={() => setFiltroMacro(filtroMacro === m.chave ? '' : m.chave)}>{m.rotulo}</Chip>
                ))}
              </Chips>
            </GrupoFiltro>
            {subclassesExistentes.length > 0 && (
              <GrupoFiltro titulo="Subclasse">
                <Chips>
                  {subclassesExistentes.map((x) => (
                    <Chip key={x} pressionado={filtroSub === x} onClick={() => setFiltroSub(filtroSub === x ? '' : x)}>{x}</Chip>
                  ))}
                </Chips>
              </GrupoFiltro>
            )}
          </TelaFiltros>
        )}
        {posicoes.length > 0 && posicoesFiltradas.length === 0 && (
          <p className="text-sm text-slate-600">Nenhuma posição com esse filtro.</p>
        )}
        {posicoesFiltradas.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {posicoesFiltradas.map((p) => <li key={p.assetId}><Card><Posicao p={p} /></Card></li>)}
          </ul>
        ) : !carregando && ativos.length > 0 && posicoes.length === 0 ? (
          <EmptyState titulo="Ativos cadastrados, sem posição" descricao="Registre uma compra para que a posição apareça aqui." acao={<Button onClick={() => setNovaOperacao(true)}>Registrar compra</Button>} />
        ) : null}
      </section>

      <section className="mt-8" aria-labelledby="titulo-cadastro-ativos">
        <h2 id="titulo-cadastro-ativos" className="mb-3 text-lg font-semibold">Ativos cadastrados</h2>
        {ativos.length === 0 ? <p className="text-sm text-slate-500">Nenhum ativo cadastrado.</p> : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200">
            {ativos.map((a) => {
              const comPosicao = posicoes.some((p) => p.assetId === a.id)
              // posição aberta = aparece em "Ativos e posições"; ativo sem ela (zerado ou nunca comprado) pode ser arquivado
              const situacao = !a.ativo ? 'Arquivado' : comPosicao ? 'Posição aberta' : 'Sem posição'
              const semHistorico = a.quantidadeOperacoes === 0 && a.quantidadeAvaliacoes === 0 && a.quantidadeProventos === 0
              return (
                <li key={a.id} className={`flex flex-wrap items-center justify-between gap-2 p-3 ${a.ativo ? '' : 'opacity-70'}`}>
                  <div><p className="font-medium">{a.nome}{a.ticker ? ` · ${a.ticker}` : ''}</p><p className="text-xs text-slate-500">{classes.find(([v]) => v === a.classe)?.[1] ?? a.classe} · {a.moeda} · {a.subclasse ?? 'sem subclasse'}{a.liquidez === 'restricted' ? ' · restrito' : ''}</p></div>
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="mr-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{situacao}</span>
                    <Button compacto variante="fantasma" onClick={() => setEditandoAtivo(a)} aria-label={`Editar ${a.nome}`}>Editar</Button>
                    <Button compacto variante="fantasma" aria-expanded={extratoDe === a.id} onClick={() => setExtratoDe(extratoDe === a.id ? null : a.id)} aria-label={`Extrato de ${a.nome}`}>Extrato</Button>
                    <Button compacto variante="fantasma" onClick={() => setEditandoSub(editandoSub === a.id ? null : a.id)}>Subclasse de {a.nome}</Button>
                    <Button compacto variante="fantasma" aria-label={a.liquidez === 'restricted' ? `Marcar ${a.nome} como líquido` : `Marcar ${a.nome} como restrito`}
                      onClick={() => void acaoNoAtivo(() => definirLiquidezAtivo(a.id, a.liquidez === 'restricted' ? 'liquid' : 'restricted'))}>
                      {a.liquidez === 'restricted' ? 'Marcar como líquido' : 'Marcar como restrito'}
                    </Button>
                    {a.ativo && !comPosicao && (
                      <Button compacto variante="fantasma" onClick={() => void acaoNoAtivo(() => arquivarAtivoInvestimento(a.id))} aria-label={`Arquivar ${a.nome}`}>Arquivar</Button>
                    )}
                    {!a.ativo && (
                      <Button compacto variante="fantasma" onClick={() => void acaoNoAtivo(() => reativarAtivoInvestimento(a.id))} aria-label={`Reativar ${a.nome}`}>Reativar</Button>
                    )}
                    {semHistorico ? (
                      <Button compacto variante="secundario" type="button" carregando={excluindoId === a.id} aria-label={`Excluir ${a.nome}`}
                        onClick={() => void excluirAtivo(a.id, a.nome)}>Excluir</Button>
                    ) : <span className="text-xs text-slate-500">Histórico protegido</span>}
                  </span>
                  {editandoAtivo?.id === a.id && (
                    <div className="w-full">
                      <FormEditarAtivo ativo={a} aoSalvar={salvarEdicaoAtivo} aoCancelar={() => setEditandoAtivo(null)} />
                    </div>
                  )}
                  {extratoDe === a.id && familia?.id && (
                    <div className="w-full">
                      <ExtratoAtivo familiaId={familia.id} ativo={a} aoMudar={carregar} aoFechar={() => setExtratoDe(null)} />
                    </div>
                  )}
                  {editandoSub === a.id && <EditorSubclasse ativo={a} aoSalvar={(v) => salvarSubclasse(a.id, v)} aoCancelar={() => setEditandoSub(null)} />}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

/** Alocação por moeda: macroclasse e subclasse. Valores e percentuais vêm do banco (investment_allocation). */
function SecaoAlocacao({ linhas }: { linhas: LinhaAlocacao[] }) {
  const moedasPresentes = [...new Set(linhas.map((l) => l.moeda))]
  return (
    <section className="mt-8" aria-labelledby="titulo-alocacao">
      <h2 id="titulo-alocacao" className="mb-1 text-lg font-semibold">Alocação da carteira</h2>
      <p className="mb-3 text-sm text-slate-500">
        Percentuais sobre o total de cada moeda, calculados no banco. Fundos e “outros” ficam à parte porque podem ser de renda fixa ou variável.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {moedasPresentes.map((m) => {
          const deste = linhas.filter((l) => l.moeda === m)
          const macros = deste.filter((l) => l.nivel === 'macro')
          return (
            <Card key={m}>
              <h3 className="mb-2 font-semibold">Em {m}</h3>
              <ul className="flex flex-col gap-2">
                {macros.map((mac) => (
                  <li key={mac.macro}>
                    <div className="flex flex-wrap justify-between gap-2 text-sm">
                      <strong>{MACROS.find((x) => x.chave === mac.macro)?.rotulo ?? mac.macro}</strong>
                      <span className="tabular-nums">{moeda(mac.valor, m)} · {mac.percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
                    </div>
                    <ul className="mt-1 border-l-2 border-slate-100 pl-3">
                      {deste.filter((l) => l.nivel === 'subclass' && l.macro === mac.macro).map((sub) => (
                        <li key={sub.subclasse ?? '∅'} className="flex flex-wrap justify-between gap-2 text-sm text-slate-600">
                          <span>{sub.subclasse ?? 'Sem subclasse'}</span>
                          <span className="tabular-nums">{moeda(sub.valor, m)} · {sub.percentual.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

/** Proventos por ativo (12 meses para trás, 6 para frente). Os valores vêm do banco, somados dos próprios lançamentos. */
function SecaoProventos({ linhas }: { linhas: ProventoAtivo[] }) {
  return (
    <section className="mt-8" aria-labelledby="titulo-proventos">
      <h2 id="titulo-proventos" className="mb-1 text-lg font-semibold">Proventos recebidos</h2>
      <p className="mb-3 text-sm text-slate-500">
        Últimos 12 meses, mais o que está planejado nos próximos 6. Cada provento é uma receita na conta e também aparece em Lançamentos e no Calendário.
      </p>
      <ul className="flex flex-col gap-2">
        {linhas.map((l) => (
          <li key={l.assetId}>
            <Card>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">{l.nome}</p>
                <p className="tabular-nums"><span className="text-sm text-slate-500">Recebido </span><strong>{moeda(l.recebido, l.moeda)}</strong></p>
              </div>
              <p className="mt-1 text-sm text-slate-500">
                {l.previsto > 0 ? `Planejado: ${moeda(l.previsto, l.moeda)}` : 'Nada planejado'}
                {l.ultimoRecebimento ? ` · último em ${new Date(l.ultimoRecebimento + 'T12:00:00').toLocaleDateString('pt-BR')}` : ''}
              </p>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  )
}

function FormProvento({ ativos, contas, aoSalvar, aoCancelar }: {
  ativos: AtivoInvestimento[]
  contas: Conta[]
  aoSalvar: (d: { ativoId: string; tipo: TipoProvento; data: string; valor: Cents; contaId: string; status: 'paid' | 'planned'; observacao: string }) => Promise<void>
  aoCancelar: () => void
}) {
  const [ativoId, setAtivoId] = useState(ativos[0]?.id ?? '')
  const [tipo, setTipo] = useState<TipoProvento>('dividend')
  const [data, setData] = useState(hojeSP())
  const [valorTexto, setValorTexto] = useState('')
  const [contaId, setContaId] = useState(contas[0]?.id ?? '')
  const [status, setStatus] = useState<'paid' | 'planned'>('paid')
  const [observacao, setObservacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const valor = parseBRL(valorTexto)
  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!ativoId || !contaId || !data || valor === null || valor <= 0) { setErro('Confira ativo, conta, data e o valor líquido recebido.'); return }
    if (status === 'paid' && data > hojeSP()) { setErro('Provento pago não pode ter data futura: marque como planejado.'); return }
    setErro(''); setEnviando(true)
    try { await aoSalvar({ ativoId, tipo, data, valor, contaId, status, observacao }) }
    finally { setEnviando(false) }
  }
  return <Card className="mb-5"><h2 className="mb-3 text-lg font-semibold">Registrar provento</h2>
    <form onSubmit={(e) => void enviar(e)} className="grid gap-3 md:grid-cols-2">
      {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
      <Selecao rotulo="Ativo" valor={ativoId} aoMudar={setAtivoId} opcoes={ativos.map((a) => [a.id, a.nome])} />
      <Selecao rotulo="Tipo" valor={tipo} aoMudar={(v) => setTipo(v as TipoProvento)} opcoes={TIPOS_PROVENTO.map((t) => [t.chave, t.rotulo])} />
      <Field rotulo="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
      <Field rotulo="Valor líquido recebido (R$)" inputMode="decimal" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} placeholder="Ex.: 120,50" />
      <Selecao rotulo="Conta que recebe" valor={contaId} aoMudar={setContaId} opcoes={contas.map((c) => [c.id, c.nome])} />
      <Selecao rotulo="Situação" valor={status} aoMudar={(v) => setStatus(v as 'paid' | 'planned')} opcoes={[['paid', 'Já recebido'], ['planned', 'Planejado']]} />
      <Field rotulo="Observação (opcional)" value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} />
      <p className="text-sm text-slate-600 md:col-span-2">
        Informe o valor <strong>líquido</strong>, o que caiu na conta (no JCP, já sem o imposto retido). O provento entra como receita na categoria Rendimentos e muda o saldo da conta.
        Só ativos em reais por enquanto.
      </p>
      <div className="flex gap-2 md:col-span-2"><Button type="submit" carregando={enviando}>Registrar provento</Button><Button variante="secundario" onClick={aoCancelar}>Cancelar</Button></div>
    </form>
  </Card>
}

const rotuloLinhaExtrato: Record<LinhaExtratoAtivo['tipo'], string> = {
  buy: 'Compra', sell: 'Venda', valuation: 'Avaliação', distribution: 'Provento',
}

/** Extrato do ativo dentro da própria linha. Valores e saldo de quantidade vêm do banco; anular pede motivo. */
function ExtratoAtivo({ familiaId, ativo, aoMudar, aoFechar }: {
  familiaId: string
  ativo: AtivoInvestimento
  aoMudar: () => Promise<void>
  aoFechar: () => void
}) {
  const [linhas, setLinhas] = useState<LinhaExtratoAtivo[] | null>(null)
  const [erro, setErro] = useState('')
  const [anulando, setAnulando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)

  const ler = useCallback(async () => {
    try { setLinhas(await listarExtratoAtivo(familiaId, ativo.id)) }
    catch (e) { setLinhas([]); setErro(mensagemErroBanco(e)) }
  }, [familiaId, ativo.id])
  useEffect(() => { void ler() }, [ler])

  async function confirmarAnulacao(e: FormEvent, id: string) {
    e.preventDefault()
    if (motivo.trim().length < 3 || motivo.trim().length > 200) { setErro('Informe o motivo da exclusão (3 a 200 caracteres).'); return }
    setErro(''); setEnviando(true)
    try {
      await anularOperacaoInvestimento(id, motivo)
      setAnulando(null); setMotivo('')
      await ler()
      await aoMudar()
    } catch (err) { setErro(mensagemErroBanco(err)) }
    finally { setEnviando(false) }
  }

  return (
    <Card className="mt-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Extrato de {ativo.nome}</h3>
        <Button compacto variante="secundario" onClick={aoFechar}>Fechar extrato</Button>
      </div>
      {erro && <div className="mb-2"><Aviso tipo="erro">{erro}</Aviso></div>}
      {linhas === null ? <p className="text-sm text-slate-500">Carregando…</p>
        : linhas.length === 0 ? <p className="text-sm text-slate-500">Nenhum movimento neste ativo.</p> : (
        <ul className="divide-y divide-slate-200" aria-label={`Movimentos de ${ativo.nome}`}>
          {linhas.map((l) => {
            const operacao = l.tipo === 'buy' || l.tipo === 'sell'
            return (
              <li key={l.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className={l.anulada ? 'text-slate-500 line-through' : ''}>
                    <p className="font-medium">{rotuloLinhaExtrato[l.tipo]} · {formatDate(l.data)}</p>
                    {operacao && l.quantidade && l.precoUnitario && (
                      <p className="text-xs text-slate-600">{quantidade(l.quantidade)} × {preco(l.precoUnitario, ativo.moeda)}{l.taxa ? ` · taxa ${moeda(l.taxa, ativo.moeda)}` : ''}</p>
                    )}
                    {l.tipo === 'valuation' && l.precoUnitario && (
                      <p className="text-xs text-slate-600">Preço {preco(l.precoUnitario, ativo.moeda)}{l.fonte ? ` · ${l.fonte}` : ''}</p>
                    )}
                    {l.tipo === 'distribution' && (
                      <p className="text-xs text-slate-600">{TIPOS_PROVENTO.find((t) => t.chave === l.tipoProvento)?.rotulo ?? 'Provento'} · {l.statusProvento === 'planned' ? <span className="font-medium text-agendado">Planejado</span> : 'Recebido'}</p>
                    )}
                  </div>
                  <div className="text-right">
                    {l.valor !== null && <p className={`font-semibold ${l.anulada ? 'text-slate-500 line-through' : ''}`}>{moeda(l.valor, ativo.moeda)}</p>}
                    {l.saldoQuantidade !== null && <p className="text-xs text-slate-500">Saldo: {quantidade(l.saldoQuantidade)}</p>}
                  </div>
                </div>
                {l.anulada && (
                  <p className="mt-1 text-xs"><span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">Anulada</span>{l.motivoAnulacao ? ` Motivo: ${l.motivoAnulacao}` : ''}</p>
                )}
                {operacao && !l.anulada && anulando !== l.id && (
                  <div className="mt-1">
                    <Button compacto variante="discreto" aria-label={`Excluir ${rotuloLinhaExtrato[l.tipo].toLowerCase()} de ${formatDate(l.data)}`}
                      onClick={() => { setAnulando(l.id); setMotivo(''); setErro('') }}>Excluir</Button>
                  </div>
                )}
                {anulando === l.id && (
                  <form className="mt-2 grid gap-2" onSubmit={(e) => void confirmarAnulacao(e, l.id)}>
                    <Field rotulo="Motivo da exclusão" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
                    <p className="text-xs text-slate-600">A operação não é apagada: fica no extrato como anulada, com o motivo, e sai da posição e do custo.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" variante="perigo" carregando={enviando}>Confirmar exclusão</Button>
                      <Button variante="secundario" onClick={() => { setAnulando(null); setErro('') }}>Cancelar</Button>
                    </div>
                  </form>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function FormEditarAtivo({ ativo, aoSalvar, aoCancelar }: {
  ativo: AtivoInvestimento
  aoSalvar: (d: { ativoId: string; nome: string; ticker: string; classe: ClasseAtivo }) => Promise<void>
  aoCancelar: () => void
}) {
  const [nome, setNome] = useState(ativo.nome)
  const [ticker, setTicker] = useState(ativo.ticker ?? '')
  const [classe, setClasse] = useState<ClasseAtivo>(ativo.classe)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim()) { setErro('Informe o nome do ativo.'); return }
    setErro(''); setEnviando(true)
    try { await aoSalvar({ ativoId: ativo.id, nome, ticker, classe }) }
    catch (err) { setErro(mensagemErroBanco(err)) }
    finally { setEnviando(false) }
  }
  return (
    <Card className="mb-5">
      <h2 className="mb-3 text-lg font-semibold">Editar {ativo.nome}</h2>
      <form onSubmit={(e) => void enviar(e)} className="grid gap-3 md:grid-cols-2">
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo="Nome do ativo" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} />
        <Field rotulo="Ticker ou código (opcional)" value={ticker} onChange={(e) => setTicker(e.target.value)} maxLength={20} />
        <Selecao rotulo="Classe" valor={classe} aoMudar={(v) => setClasse(v as ClasseAtivo)} opcoes={classes} />
        <p className="self-end text-sm text-slate-600">Moeda: <strong>{ativo.moeda}</strong> (não muda: as operações já estão nela).</p>
        <p className="text-sm text-slate-600 md:col-span-2">Mudar a classe só muda em qual grupo o ativo aparece na alocação; nenhum valor é alterado.</p>
        <div className="flex gap-2 md:col-span-2"><Button type="submit" carregando={enviando}>Salvar</Button><Button variante="secundario" onClick={aoCancelar}>Cancelar</Button></div>
      </form>
    </Card>
  )
}

function EditorSubclasse({ ativo, aoSalvar, aoCancelar }: { ativo: AtivoInvestimento; aoSalvar: (v: string) => Promise<void>; aoCancelar: () => void }) {
  const [valor, setValor] = useState(ativo.subclasse ?? '')
  const [enviando, setEnviando] = useState(false)
  const lista = `sugestoes-subclasse-${ativo.id}`
  return (
    <form className="flex w-full flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setEnviando(true); void aoSalvar(valor).finally(() => setEnviando(false)) }}>
      <Field rotulo={`Subclasse de ${ativo.nome} (vazio limpa)`} value={valor} onChange={(e) => setValor(e.target.value)} maxLength={40} list={lista} />
      <datalist id={lista}>{SUGESTOES_SUBCLASSE[ativo.classe].map((x) => <option key={x} value={x} />)}</datalist>
      <Button type="submit" carregando={enviando}>Salvar subclasse</Button>
      <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
    </form>
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
        <line x1={esquerda} x2={largura - direita} y1={y(maximo * f)} y2={y(maximo * f)} stroke={COR_GRADE} />
        <text x={esquerda - 7} y={y(maximo * f) + 4} textAnchor="end" fontSize="10" fill={COR_TEXTO_EIXO}>{rotulo(maximo * f)}</text>
      </g>)}
      {caminho && <path d={caminho} fill="none" stroke={COR_LINHA} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
      {pontos.map((p, i) => <g key={p.mes}>
        <circle cx={x(i)} cy={y(p.valorAtual)} r="3.5" fill={COR_LINHA} />
        {(i === 0 || i === pontos.length - 1 || i % 3 === 0) && <text x={x(i)} y={altura - 8} textAnchor="middle" fontSize="10" fill={COR_TEXTO_EIXO}>
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
        <div><p className="text-xs text-slate-500">Resultado não realizado</p><p className={`font-semibold tabular-nums ${corDoValor(p.resultado)}`}>{moeda(p.resultado, p.moeda)}</p></div>
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
  aoSalvar: (d: { nome: string; ticker: string; classe: ClasseAtivo; moeda: MoedaInvestimento; subclasse: string; liquidez: Liquidez }) => Promise<void>
  aoCancelar: () => void
}) {
  const [subclasse, setSubclasse] = useState('')
  const [liquidez, setLiquidez] = useState<Liquidez>('liquid')
  const [nome, setNome] = useState('')
  const [ticker, setTicker] = useState('')
  // sem classe pré-escolhida: começar em "Renda fixa" fez um FII ser gravado como renda fixa (o dono não trocou o campo)
  const [classe, setClasse] = useState<ClasseAtivo | ''>('')
  const [moedaAtivo, setMoedaAtivo] = useState<MoedaInvestimento>('BRL')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim()) { setErro('Informe o nome do ativo.'); return }
    if (!classe) { setErro('Escolha a classe do ativo (ex.: FIIs / REITs para fundo imobiliário, Renda fixa para CDB e Tesouro).'); return }
    setEnviando(true); setErro('')
    try { await aoSalvar({ nome, ticker, classe, moeda: moedaAtivo, subclasse, liquidez }) }
    finally { setEnviando(false) }
  }
  return <Card className="mb-5"><h2 className="mb-3 text-lg font-semibold">Cadastrar ativo</h2>
    <form onSubmit={(e) => void enviar(e)} className="grid gap-3 md:grid-cols-2">
      {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
      <Field rotulo="Nome do ativo" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} placeholder="Ex.: Tesouro Selic 2029" />
      <Field rotulo="Ticker ou código (opcional)" value={ticker} onChange={(e) => setTicker(e.target.value)} maxLength={20} placeholder="Ex.: PETR4, IVVB11, BTC" />
      <Selecao rotulo="Classe" valor={classe} aoMudar={(v) => setClasse(v as ClasseAtivo | '')} opcoes={classes} todos="Escolha a classe" />
      <Selecao rotulo="Moeda do ativo" valor={moedaAtivo} aoMudar={(v) => setMoedaAtivo(v as MoedaInvestimento)} opcoes={moedas} />
      <Field rotulo="Subclasse (opcional)" value={subclasse} onChange={(e) => setSubclasse(e.target.value)} maxLength={40} list="sugestoes-subclasse-novo" placeholder="Ex.: Tesouro Direto, CDB, FIIs" />
      <Selecao rotulo="Liquidez" valor={liquidez} aoMudar={(v) => setLiquidez(v === 'restricted' ? 'restricted' : 'liquid')} opcoes={LIQUIDEZES} />
      <datalist id="sugestoes-subclasse-novo">{(classe ? SUGESTOES_SUBCLASSE[classe] : []).map((x) => <option key={x} value={x} />)}</datalist>
      <div className="flex gap-2 md:col-span-2"><Button type="submit" carregando={enviando}>Salvar ativo</Button><Button variante="secundario" onClick={aoCancelar}>Cancelar</Button></div>
    </form>
  </Card>
}

/** Os formulários de cadastro abrem no topo da página; quem tocou num botão lá embaixo (ex.: "Registrar compra"
 * em "Ativos e posições", no celular) não via nada acontecer. Ao abrir, a tela rola até o formulário. */
function RolarAoAbrir({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) }, [])
  return <div ref={ref} className="scroll-mt-4">{children}</div>
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
