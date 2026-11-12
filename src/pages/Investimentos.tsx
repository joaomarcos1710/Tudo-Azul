import { useCallback, useEffect, useId, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { Folha } from '../components/ui/Folha'
import { ComposicaoCarteira } from '../components/investimentos/ComposicaoCarteira'
import { TabelaPosicoes, corDoResultado } from '../components/investimentos/TabelaPosicoes'
import { NotaCarteira } from '../components/investimentos/NotaCarteira'
import { ResumoCarteira } from '../components/investimentos/ResumoCarteira'
import { CONTROLE_FOLHA, FormOperacao, GRANDE_FOLHA, LINHA_FOLHA, TITULO_FOLHA, gravarOperacao } from '../components/investimentos/FormOperacao'
import type { DadosOperacao } from '../components/investimentos/FormOperacao'
import { Selecao } from '../components/ui/Selecao'
import { Chip } from '../components/ui/TelaFiltros'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { useFamilia } from '../lib/FamiliaContext'
import { converterParaReais, textoCotacao } from '../lib/cambio'
import type { EmReais } from '../lib/cambio'
import { codigoDoErro, registrarFalhaConsulta } from '../lib/consultaOpcional'
import { aceitaLancamento, hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { currentMonth } from '../lib/format'
import { limitesDoMes, somarMeses } from '../lib/lancamentos'
import { formatBRL, formatDate, parseBRL, simboloMoeda } from '../lib/format'
import type { Cents } from '../lib/format'
import { valoresOcultos } from '../lib/privacidade'
import { mensagemErroBanco } from '../lib/erros'
import { COR_GRADE, COR_LINHA, COR_TEXTO_EIXO } from '../components/graficos/cores'
import {
  CATEGORIAS_NOVO_ATIVO, CLASSES_ATIVO, MACROS, SUGESTOES_SUBCLASSE, TIPOS_PROVENTO, anularOperacaoInvestimento, arquivarAtivoInvestimento, codigoDaBolsa, criarAtivoInvestimento, definirCotacaoBolsaAtivo, definirInstituicaoAtivo, definirLiquidezAtivo, definirSubclasseAtivo, listarAportesInvestimentos, listarInstituicoesInvestimentos, listarLiquidezInvestimentos, listarTotalProventos, editarAtivoInvestimento, excluirAtivoComHistorico, excluirAtivoInvestimento,
  listarAlocacaoInvestimentos, listarAtivosInvestimento, listarExtratoAtivo, listarCarteiraInvestimentos, listarHistoricoInvestimentos, listarProventosPorAtivo, macroDaClasse,
  reativarAtivoInvestimento, registrarAvaliacaoInvestimento, registrarAvaliacaoTotal, registrarProventoInvestimento,
} from '../lib/investimentos'
import type {
  AportesCarteira, AtivoInvestimento, ClasseAtivo, HistoricoInvestimento, LinhaAlocacao, LinhaExtratoAtivo, LinhaInstituicao, LinhaLiquidez, Liquidez, MoedaInvestimento, PosicaoInvestimento, ProventoAtivo,
  TipoOperacaoInvestimento, TipoProvento, TotalInvestimento, TotalProventos,
} from '../lib/investimentos'

const classes = CLASSES_ATIVO
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
  // (106) por instituição; vazio quando o banco ainda não tem a migration: a aba some, o resto da tela segue
  const [instituicoes, setInstituicoes] = useState<LinhaInstituicao[]>([])
  // false = o banco ainda não tem a migration 106: o campo Instituição não aparece (gravar daria erro depois de salvar o resto)
  const [bancoTemInstituicao, setBancoTemInstituicao] = useState(false)
  // aportes e resgates (migration 107); null = banco sem a função: cartões e tabela mostram o custo do que está investido
  const [aportes, setAportes] = useState<AportesCarteira | null>(null)
  // valor de cada moeda estrangeira em reais (PTAX, migration 108); vazio = sem cotação ou banco sem a função
  const [emReais, setEmReais] = useState<Map<string, EmReais>>(new Map())
  // proventos do mês corrente: por ativo (linha da tabela) e o total por moeda, do banco; null = não leu
  const [proventosMes, setProventosMes] = useState<ProventoAtivo[]>([])
  const [totalProventosMes, setTotalProventosMes] = useState<TotalProventos[] | null>(null)
  const [filtroMacro, setFiltroMacro] = useState('')
  const [filtroSub, setFiltroSub] = useState('')
  const [editandoSub, setEditandoSub] = useState<string | null>(null)
  const [editandoAtivo, setEditandoAtivo] = useState<AtivoInvestimento | null>(null)
  const [extratoDe, setExtratoDe] = useState<string | null>(null)
  const [proventos, setProventos] = useState<ProventoAtivo[]>([])
  const [contas, setContas] = useState<Conta[]>([])
  // saldo das contas de corretora ativas em reais (balance_totals_by_type, do banco); null = não leu
  const [paradoCorretora, setParadoCorretora] = useState<Cents | null>(null)
  const [novoProvento, setNovoProvento] = useState(false)
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [novoAtivo, setNovoAtivo] = useState(false)
  // false = fechado; 'buy'/'sell' = aberto já na aba (Investir, Resgatar); true = aberto em Compra
  const [novaOperacao, setNovaOperacao] = useState<boolean | TipoOperacaoInvestimento>(false)
  const [novaAvaliacao, setNovaAvaliacao] = useState(false)
  // ativo escolhido por um botão da linha da tabela (Aporte, Resgate, Atualizar valor, + Provento). Volta a vazio quando
  // nenhuma folha está aberta: os botões do topo (Investir, Resgatar…) abrem sem ativo escolhido, como antes.
  const [ativoDaLinha, setAtivoDaLinha] = useState<string | undefined>(undefined)
  useEffect(() => { if (!novaOperacao && !novoProvento && !novaAvaliacao) setAtivoDaLinha(undefined) }, [novaOperacao, novoProvento, novaAvaliacao])
  const acoesDaLinha = {
    aportar: (id: string) => { setAtivoDaLinha(id); setNovaOperacao('buy') },
    resgatar: (id: string) => { setAtivoDaLinha(id); setNovaOperacao('sell') },
    atualizar: (id: string) => { setAtivoDaLinha(id); setNovaAvaliacao(true) },
    provento: (id: string) => { setAtivoDaLinha(id); setNovoProvento(true) },
  }

  const carregar = useCallback(async () => {
    if (!familia?.id) return
    setCarregando(true)
    try {
      const hoje = hojeSP()
      // os aportes (migration 107) vêm junto com a carteira e entram na tela no mesmo instante: lidos depois, a tela
      // abria no custo e trocava para o líquido na frente do dono (revisão de dinheiro da #298).
      // atalho: carteira e aportes ainda são duas leituras; uma escrita de outra pessoa entre elas pode deixá-las
      // fora de compasso. `aportesNaTela` confere e, se não baterem, a tela inteira fica no custo até recarregar.
      // Melhorar quando a carteira vier numa função só do banco (ver 40 - Pendências).
      const [lista, carteira, serie, aportesLidos] = await Promise.all([
        listarAtivosInvestimento(familia.id),
        listarCarteiraInvestimentos(familia.id, hoje),
        listarHistoricoInvestimentos(familia.id, inicioHistorico(hoje), hoje).catch(() => []),
        listarAportesInvestimentos(familia.id, hoje).catch((e: unknown) => {
          // PGRST202 = banco ainda sem a migration 107 (esperado até ela ser aplicada); o resto vai ao Sentry
          if (codigoDoErro(e) !== 'PGRST202') void registrarFalhaConsulta('investment_contributions', e)
          return null
        }),
      ])
      setAtivos(lista)
      setPosicoes(carteira.posicoes)
      setTotais(carteira.totais)
      setAportes(aportesLidos)
      setHistorico(serie)
      setErro('')
      try { setAlocacao(await listarAlocacaoInvestimentos(familia.id, hojeSP())) } catch { setAlocacao([]) }
      try { setLiquidez(await listarLiquidezInvestimentos(familia.id, hoje)) } catch { setLiquidez([]) }
      try { setInstituicoes(await listarInstituicoesInvestimentos(familia.id, hoje)); setBancoTemInstituicao(true) }
      catch { setInstituicoes([]); setBancoTemInstituicao(false) }
      // proventos do mês corrente: por ativo (tabela de posições) e o total por moeda (cartão). Um não depende do outro:
      // sem a migration 106 o total não existe, mas a linha por ativo continua.
      const [de, ate] = limitesDoMes(currentMonth())
      try { setProventosMes(await listarProventosPorAtivo(familia.id, de, ate)) } catch { setProventosMes([]) }
      try { setTotalProventosMes(await listarTotalProventos(familia.id, de, ate)) } catch { setTotalProventosMes(null) }
      // proventos: 12 meses para trás e 6 para frente (os planejados). Sem a migration 035, a seção só some.
      try {
        const mes = currentMonth()
        setProventos(await listarProventosPorAtivo(familia.id, limitesDoMes(somarMeses(mes, -11))[0], limitesDoMes(somarMeses(mes, 6))[1]))
      } catch { setProventos([]) }
      try {
        const lidas = await listarContas(familia.id)
        setContas(lidas.contas)
        setParadoCorretora(lidas.porTipo?.find((t) => t.tipo === 'brokerage')?.totalAtivas ?? null)
      } catch { setContas([]); setParadoCorretora(null) }
      // "≈ R$" do valor de mercado de cada moeda estrangeira, convertido no banco. Por último e opcional: o resto da tela
      // não espera por ele, e sem ele o cartão segue igual.
      const estrangeiras = carteira.totais.filter((t) => t.moeda !== 'BRL')
      try {
        const conv = await converterParaReais(estrangeiras.map((t) => ({ moeda: t.moeda, valor: t.valorAtual })), hoje)
        setEmReais(new Map(conv.filter((x) => x.reais !== null).map((x) => [x.moeda, x])))
      } catch (e) {
        if (codigoDoErro(e) !== 'PGRST202') void registrarFalhaConsulta('fx_to_brl', e)
        setEmReais(new Map())
      }
    } catch (e) {
      setErro(mensagemErroBanco(e))
    } finally {
      setCarregando(false)
    }
  }, [familia?.id])

  useEffect(() => { void carregar() }, [carregar])
  const familiaId = familia?.id ?? ''
  if (!familiaId) return null

  async function salvarAtivo(d: { nome: string; ticker: string; classe: ClasseAtivo; moeda: MoedaInvestimento; subclasse: string; liquidez: Liquidez; instituicao: string; cotacaoBolsa: boolean }) {
    const { subclasse, liquidez: liq, instituicao, cotacaoBolsa, ...ativo } = d
    // se criar falhar, o erro sobe para a folha, que fica aberta; depois de criado, os avisos vão para a página
    const id = await criarAtivoInvestimento({ familiaId, ...ativo })
    setNovoAtivo(false)
    try {
      // cada complemento é uma chamada própria: o que falhar vira um aviso, e todos aparecem (não só o último)
      const avisos: string[] = []
      if (subclasse.trim()) {
        try { await definirSubclasseAtivo(id, subclasse) } catch (e) {
          avisos.push(`Ativo cadastrado, mas a subclasse não foi salva: ${mensagemErroBanco(e)}`)
        }
      }
      if (instituicao.trim()) {
        try { await definirInstituicaoAtivo(id, instituicao) } catch (e) {
          avisos.push(`Ativo cadastrado, mas a instituição não foi salva: ${mensagemErroBanco(e)}`)
        }
      }
      // o ativo nasce sem a cotação da bolsa; ligar é uma chamada própria (o banco confere se o ativo pode)
      if (cotacaoBolsa) {
        try { await definirCotacaoBolsaAtivo(id, true) } catch (e) {
          avisos.push(`Ativo cadastrado, mas sem acompanhar a cotação da bolsa: ${mensagemErroBanco(e)}`)
        }
      }
      // o ativo nasce líquido no banco; só o restrito precisa da segunda chamada
      if (liq === 'restricted') {
        try { await definirLiquidezAtivo(id, liq) } catch (e) {
          avisos.push(`Ativo cadastrado como líquido: não foi possível marcar como restrito. ${mensagemErroBanco(e)}`)
        }
      }
      await carregar() // recarregar limpa o erro; por isso os avisos entram depois
      if (avisos.length) setErro(avisos.join(' '))
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }
  async function salvarProvento(d: {
    ativoId: string; tipo: TipoProvento; data: string; valor: Cents; contaId: string; status: 'paid' | 'planned'; observacao: string
  }) {
    // o erro sobe para a folha, que fica aberta e o mostra junto dos campos
    await registrarProventoInvestimento(d)
    setNovoProvento(false)
    await carregar()
  }
  async function acaoNoAtivo(acao: () => Promise<void>) {
    try {
      await acao()
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }
  // o erro sobe para o formulário (que fica aberto e o mostra perto dos campos, não no topo da página)
  async function salvarEdicaoAtivo(d: { ativoId: string; nome: string; ticker: string; classe: ClasseAtivo; instituicao: string; cotacaoBolsa: boolean | null }) {
    const { instituicao, cotacaoBolsa, ...dados } = d
    await editarAtivoInvestimento(dados)
    // a instituição é uma segunda chamada, só quando mudou. Se ela falhar, nome, código e classe já foram gravados:
    // o formulário fecha, a lista recarrega e o aviso diz o que ficou de fora (não "falhou", que seria mentira)
    let aviso = ''
    if (instituicao.trim() !== (editandoAtivo?.instituicao ?? '')) {
      try { await definirInstituicaoAtivo(d.ativoId, instituicao) } catch (e) {
        aviso = `Ativo atualizado, mas a instituição não foi salva: ${mensagemErroBanco(e)}`
      }
    }
    // a cotação da bolsa também é uma chamada própria, só quando a escolha mudou (null = a opção não estava na tela)
    if (cotacaoBolsa !== null && cotacaoBolsa !== (editandoAtivo?.cotacaoBolsa ?? false)) {
      try { await definirCotacaoBolsaAtivo(d.ativoId, cotacaoBolsa) } catch (e) {
        aviso = `${aviso ? `${aviso} ` : ''}Ativo atualizado, mas a escolha da cotação da bolsa não foi salva: ${mensagemErroBanco(e)}`
      }
    }
    setEditandoAtivo(null)
    await carregar()
    if (aviso) setErro(aviso)
  }
  async function salvarSubclasse(ativoId: string, subclasse: string) {
    try {
      await definirSubclasseAtivo(ativoId, subclasse)
      setEditandoSub(null)
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }
  async function salvarOperacao(d: DadosOperacao) {
    // o erro sobe para a folha da operação, que fica aberta e o mostra junto dos campos
    // "só o valor" (migration 104): o banco converte o valor em unidades; aqui não há conta
    await gravarOperacao(d)
    setNovaOperacao(false)
    await carregar()
  }
  async function salvarAvaliacao(d: DadosAvaliacao) {
    if ('valor' in d) await registrarAvaliacaoTotal(d)
    else await registrarAvaliacaoInvestimento(d)
    setNovaAvaliacao(false)
    await carregar()
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
  // subclasses das posições à vista (da classe escolhida, ou de todas), para os chips de subclasse
  const subclassesDaLista = [...new Set(posicoes.filter((p) => !filtroMacro || macroDaClasse(p.classe) === filtroMacro)
    .map((p) => porId.get(p.assetId)?.subclasse).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  // banco ainda sem a migration 109: a coluna não veio em nenhum ativo. Sem nenhum ativo não dá para saber: a opção
  // aparece e, se o banco não a conhecer, o cadastro avisa que ficou sem ela
  const bancoTemCotacao = !ativos.some((a) => a.cotacaoBolsa === null)
  const instituicoesExistentes = [...new Set(ativos.map((a) => a.instituicao).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const proventoDoMesPorAtivo = new Map(proventosMes.map((x) => [x.assetId, x.recebido]))
  const proventosBRL = totalProventosMes === null ? null : totalProventosMes.find((t) => t.moeda === 'BRL') ?? null
  // Um critério só na tela inteira (cartões, frase e tabela): os aportes valem se cobrem todas as posições e se o valor
  // de cada moeda é o mesmo da carteira lida junto. Igualdade, não soma: nenhum dinheiro é calculado aqui.
  const aportesNaTela = aportes !== null
    && posicoes.every((p) => aportes.porAtivo.has(p.assetId))
    && totais.every((t) => aportes.totais.find((x) => x.moeda === t.moeda)?.valorAtual === t.valorAtual)
    ? aportes : null
  const posicoesFiltradas = posicoes.filter((p) =>
    (!filtroMacro || macroDaClasse(p.classe) === filtroMacro) && (!filtroSub || porId.get(p.assetId)?.subclasse === filtroSub))
  return (
    <>
      <CabecalhoPagina
        titulo="Investimentos"
        descricao="Acompanhe ativos, operações, custo médio e avaliações da carteira familiar."
        acoes={
          // uma ação principal (Registrar operação: primeira no celular, à direita no computador) e as outras em peso menor
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Button className="w-full sm:order-last sm:w-auto" onClick={() => setNovaOperacao(true)} disabled={ativosAtivos.length === 0}>Registrar operação</Button>
            <Button variante="fantasma" onClick={() => setNovoAtivo(true)}>Novo ativo</Button>
            <Button variante="fantasma" onClick={() => setNovoProvento(true)} disabled={ativosEmReais.length === 0}>Registrar provento</Button>
          </div>
        }
      />
      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      <NotaCarteira />

      {novoAtivo && <FormAtivo instituicoes={bancoTemInstituicao ? instituicoesExistentes : null} bancoTemCotacao={bancoTemCotacao} aoSalvar={salvarAtivo} aoCancelar={() => setNovoAtivo(false)} />}
      {novaOperacao && (
        <FormOperacao ativos={ativosAtivos} contas={contasAtivas} tipoInicial={novaOperacao === 'sell' ? 'sell' : 'buy'} ativoInicial={ativoDaLinha} aoSalvar={salvarOperacao} aoCancelar={() => setNovaOperacao(false)} />
      )}
      {novoProvento && (
        <FormProvento ativos={ativosEmReais} contas={contasAtivas} ativoInicial={ativoDaLinha} aoSalvar={salvarProvento} aoCancelar={() => setNovoProvento(false)} />
      )}
      {novaAvaliacao && (
        <FormAvaliacao ativos={ativosAtivos} quantidades={new Map(posicoes.map((p) => [p.assetId, p.quantidade]))} ativoInicial={ativoDaLinha} aoSalvar={salvarAvaliacao} aoCancelar={() => setNovaAvaliacao(false)} />
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
        {totais.filter((t) => t.moeda === 'BRL').map((t) => (
          <div key="BRL">
            <ResumoCarteira total={t} aportes={aportesNaTela?.totais.find((x) => x.moeda === 'BRL') ?? null} proventos={proventosBRL} formatar={(c) => moeda(c, 'BRL')} />
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button onClick={() => setNovaOperacao('buy')} disabled={ativosAtivos.length === 0}>Investir</Button>
              <Button variante="secundario" onClick={() => setNovaOperacao('sell')} disabled={ativosAtivos.length === 0}>Resgatar</Button>
              {paradoCorretora !== null && (
                <p className="text-sm text-slate-600">Parado na corretora: <strong className="tabular-nums text-marinho">{moeda(paradoCorretora, 'BRL')}</strong></p>
              )}
            </div>
          </div>
        ))}
        {totais.some((t) => t.moeda !== 'BRL') && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {totais.filter((t) => t.moeda !== 'BRL').map((t) => {
              // mesmo critério dos cartões em reais: com a migration 107, aportado líquido e rendimento total
              const ap = aportesNaTela?.totais.find((x) => x.moeda === t.moeda)
              const rendimento = ap ? ap.ganho : t.resultado
              return (
                <Card key={t.moeda}>
                  <p className="text-sm font-medium text-slate-500">Valor de mercado em {t.moeda}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{moeda(ap ? ap.valorAtual : t.valorAtual, t.moeda)}</p>
                  {emReais.get(t.moeda)?.valor === t.valorAtual && emReais.get(t.moeda)!.reais !== null && (
                    // só quando a conversão é do mesmo valor que está na tela (lidos juntos); fora do total em reais
                    <p className="text-sm text-slate-600">
                      ≈ <span className="tabular-nums font-semibold">{moeda(emReais.get(t.moeda)!.reais!, 'BRL')}</span>
                      <span className="block text-xs text-slate-500">{textoCotacao(emReais.get(t.moeda)!, simboloMoeda(t.moeda))}</span>
                    </p>
                  )}
                  <dl className="mt-3 grid max-w-md grid-cols-[1fr_auto] items-baseline gap-x-3 gap-y-1 text-sm">
                    <dt className="text-slate-500">Aportado</dt>
                    <dd className="m-0 text-right font-bold tabular-nums">{moeda(ap ? ap.liquido : t.custoTotal, t.moeda)}</dd>
                    <dt className="text-slate-500">Rendimento</dt>
                    <dd className={`m-0 text-right font-bold tabular-nums ${corDoResultado(rendimento)}`}>{moeda(rendimento, t.moeda)}</dd>
                  </dl>
                  {ap && ap.resgatado > 0 && (
                    <p className="mt-2 text-xs text-slate-500">Pôs {moeda(ap.aportado, t.moeda)} · tirou {moeda(ap.resgatado, t.moeda)}; o rendimento conta o que já foi resgatado</p>
                  )}
                  {!ap && <p className="mt-2 text-xs text-slate-500">Do que ainda está investido: o que já foi resgatado não entra.</p>}
                </Card>
              )
            })}
          </div>
        )}
      </section>

      <ComposicaoCarteira totais={totais} alocacao={alocacao} liquidez={liquidez} instituicoes={instituicoes} posicoes={posicoes} formatar={moeda} />

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

      {proventos.length > 0 && <SecaoProventos linhas={proventos} />}

      <section className="mt-8" aria-labelledby="titulo-posicoes">
        <h2 id="titulo-posicoes" className="text-lg font-semibold">Posições</h2>
        <p className="mb-3 text-sm text-slate-500">
          {aportesNaTela ? 'Quanto você pôs (menos o que tirou), quanto vale hoje e tudo o que rendeu.' : 'Do que está investido hoje: quanto custou, quanto vale e o rendimento.'}
        </p>
        {posicoes.length > 0 && (
          // filtros em chips na própria tela (pedido do dono, 10/11/2026, a partir de um desenho dele; antes ficavam atrás
          // do botão Filtrar). Filtram só a lista: nenhum valor muda e nada é pedido ao banco. O número é de posições.
          <div className="mb-3 flex flex-col gap-2">
            <div role="group" aria-label="Filtrar posições por classe" className="-mx-4 flex [&>button]:shrink-0 [&>button]:whitespace-nowrap gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
              <Chip pressionado={!filtroMacro && !filtroSub} onClick={() => { setFiltroMacro(''); setFiltroSub('') }}>Todos ({posicoes.length})</Chip>
              {MACROS.filter((m) => posicoes.some((p) => macroDaClasse(p.classe) === m.chave)).map((m) => (
                <Chip key={m.chave} pressionado={filtroMacro === m.chave}
                  onClick={() => { setFiltroMacro(filtroMacro === m.chave ? '' : m.chave); setFiltroSub('') }}>
                  {m.rotulo} ({posicoes.filter((p) => macroDaClasse(p.classe) === m.chave).length})
                </Chip>
              ))}
            </div>
            {subclassesDaLista.length > 1 && (
              <div role="group" aria-label="Filtrar posições por subclasse" className="-mx-4 flex [&>button]:shrink-0 [&>button]:whitespace-nowrap items-center gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
                <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">Subclasse</span>
                {subclassesDaLista.map((x) => (
                  <Chip key={x} pressionado={filtroSub === x} onClick={() => setFiltroSub(filtroSub === x ? '' : x)}>{x}</Chip>
                ))}
              </div>
            )}
          </div>
        )}
        {posicoes.length > 0 && posicoesFiltradas.length === 0 && (
          <p className="text-sm text-slate-600">Nenhuma posição com esse filtro.</p>
        )}
        {posicoesFiltradas.length > 0 ? (
          <TabelaPosicoes posicoes={posicoesFiltradas} ativos={ativos} totais={totais} aportes={aportesNaTela} proventosDoMes={proventoDoMesPorAtivo}
            filtrada={!!filtroMacro || !!filtroSub} acoes={acoesDaLinha} formatar={moeda} formatarPreco={preco} formatarQuantidade={quantidade} />
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
              // posição aberta = aparece em "Posições"; ativo sem ela (zerado ou nunca comprado) pode ser arquivado
              const situacao = !a.ativo ? 'Arquivado' : comPosicao ? 'Posição aberta' : 'Sem posição'
              const semHistorico = a.quantidadeOperacoes === 0 && a.quantidadeAvaliacoes === 0 && a.quantidadeProventos === 0
              return (
                <li key={a.id} className={`flex flex-wrap items-center justify-between gap-2 p-3 ${a.ativo ? '' : 'opacity-70'}`}>
                  <div><p className="font-medium">{a.nome}{a.ticker ? ` · ${a.ticker}` : ''}</p><p className="text-xs text-slate-500">{classes.find(([v]) => v === a.classe)?.[1] ?? a.classe} · {a.moeda} · {a.subclasse ?? 'sem subclasse'}{a.instituicao ? ` · ${a.instituicao}` : ''}{a.liquidez === 'restricted' ? ' · restrito' : ''}</p></div>
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
                      <FormEditarAtivo ativo={a} instituicoes={bancoTemInstituicao ? instituicoesExistentes : null} aoSalvar={salvarEdicaoAtivo} aoCancelar={() => setEditandoAtivo(null)} />
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

function FormProvento({ ativos, contas, ativoInicial, aoSalvar, aoCancelar }: {
  ativos: AtivoInvestimento[]
  /** ativo já escolhido (botão "+ Provento" da linha do ativo) */
  ativoInicial?: string
  contas: Conta[]
  aoSalvar: (d: { ativoId: string; tipo: TipoProvento; data: string; valor: Cents; contaId: string; status: 'paid' | 'planned'; observacao: string }) => Promise<void>
  aoCancelar: () => void
}) {
  const [ativoId, setAtivoId] = useState(ativos.some((a) => a.id === ativoInicial) ? ativoInicial! : ativos[0]?.id ?? '')
  const [tipo, setTipo] = useState<TipoProvento>('dividend')
  const [data, setData] = useState(hojeSP())
  const [valorTexto, setValorTexto] = useState('')
  const [contaId, setContaId] = useState(contas[0]?.id ?? '')
  const [status, setStatus] = useState<'paid' | 'planned'>('paid')
  const [observacao, setObservacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const id = useId()
  const valor = parseBRL(valorTexto)
  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!ativoId || !contaId || !data || valor === null || valor <= 0) { setErro('Confira ativo, conta, data e o valor líquido recebido.'); return }
    if (status === 'paid' && data > hojeSP()) { setErro('Provento pago não pode ter data futura: marque como planejado.'); return }
    setErro(''); setEnviando(true)
    try { await aoSalvar({ ativoId, tipo, data, valor, contaId, status, observacao }) }
    catch (e2) { setErro(mensagemErroBanco(e2)) }
    finally { setEnviando(false) }
  }
  const aba = (ativa: boolean) => `min-h-11 min-w-0 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors ${ativa ? 'bg-lucro text-white' : 'text-slate-600 hover:bg-white'}`
  return (
    <Folha titulo="Registrar provento" aoFechar={aoCancelar} rodape={<PeFolha idForm={id} rotulo="Registrar provento" enviando={enviando} aoCancelar={aoCancelar} />}>
      <form id={id} onSubmit={(e) => void enviar(e)} className="flex flex-col gap-4" noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div role="radiogroup" aria-label="Situação" className="flex gap-1 rounded-xl bg-slate-100 p-1">
          <button type="button" role="radio" aria-checked={status === 'paid'} onClick={() => setStatus('paid')} className={aba(status === 'paid')}>Já recebido</button>
          <button type="button" role="radio" aria-checked={status === 'planned'} onClick={() => setStatus('planned')} className={aba(status === 'planned')}>Planejado</button>
        </div>
        <div className="rounded-xl bg-fundo p-4">
          <label htmlFor={`${id}-ativo`} className="sr-only">Ativo</label>
          <select id={`${id}-ativo`} value={ativoId} onChange={(e) => setAtivoId(e.target.value)} className={TITULO_FOLHA}>
            {ativos.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
          </select>
          <div className="mt-2 flex items-baseline gap-1 text-lucro">
            <span aria-hidden="true" className="text-xl font-semibold">+R$</span>
            <label htmlFor={`${id}-valor`} className="sr-only">Valor líquido recebido (R$)</label>
            <input id={`${id}-valor`} inputMode="decimal" placeholder="0,00" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} className={`${GRANDE_FOLHA} text-lucro`} />
          </div>
          <p className="mt-1 text-sm text-slate-600">O valor <strong>líquido</strong>, o que caiu na conta (no JCP, já sem o imposto retido).</p>
        </div>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          <LinhaFolha id={`${id}-tipo`} rotulo="Tipo">
            <select id={`${id}-tipo`} value={tipo} onChange={(e) => setTipo(e.target.value as TipoProvento)} className={CONTROLE_FOLHA}>
              {TIPOS_PROVENTO.map((t) => <option key={t.chave} value={t.chave}>{t.rotulo}</option>)}
            </select>
          </LinhaFolha>
          <LinhaFolha id={`${id}-data`} rotulo="Data">
            <input id={`${id}-data`} type="date" value={data} onChange={(e) => setData(e.target.value)} className={`${CONTROLE_FOLHA} appearance-none`} />
          </LinhaFolha>
          <LinhaFolha id={`${id}-conta`} rotulo="Conta que recebe">
            <select id={`${id}-conta`} value={contaId} onChange={(e) => setContaId(e.target.value)} className={CONTROLE_FOLHA}>
              {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </LinhaFolha>
          <LinhaFolha id={`${id}-obs`} rotulo="Observação">
            <input id={`${id}-obs`} value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} placeholder="Opcional" className={CONTROLE_FOLHA} />
          </LinhaFolha>
        </div>
        <p className="text-sm text-slate-600">Entra como receita na categoria Rendimentos e muda o saldo da conta. Só ativos em reais por enquanto.</p>
      </form>
    </Folha>
  )
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
  const semCota = !ativo.ticker

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
                    {/* ativo sem cota (migration 104): unidade e preço são contas internas do banco, não se mostram;
                        o valor de cada linha (inclusive o total da avaliação) vem pronto do banco, à direita */}
                    {operacao && !semCota && l.quantidade && l.precoUnitario && (
                      <p className="text-xs text-slate-600">{quantidade(l.quantidade)} × {preco(l.precoUnitario, ativo.moeda)}{l.taxa ? ` · taxa ${moeda(l.taxa, ativo.moeda)}` : ''}</p>
                    )}
                    {l.tipo === 'valuation' && l.precoUnitario && (
                      <p className="text-xs text-slate-600">{semCota ? (l.fonte ?? '') : `Preço ${preco(l.precoUnitario, ativo.moeda)}${l.fonte ? ` · ${l.fonte}` : ''}`}</p>
                    )}
                    {l.tipo === 'distribution' && (
                      <p className="text-xs text-slate-600">{TIPOS_PROVENTO.find((t) => t.chave === l.tipoProvento)?.rotulo ?? 'Provento'} · {l.statusProvento === 'planned' ? <span className="font-medium text-agendado">Planejado</span> : 'Recebido'}</p>
                    )}
                  </div>
                  <div className="text-right">
                    {l.valor !== null && <p className={`font-semibold ${l.anulada ? 'text-slate-500 line-through' : ''}`}>{moeda(l.valor, ativo.moeda)}</p>}
                    {l.saldoQuantidade !== null && !semCota && <p className="text-xs text-slate-500">Saldo: {quantidade(l.saldoQuantidade)}</p>}
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
                    {/* a avaliação vale por unidade: sem as unidades desta operação, o valor do ativo muda numa proporção, não no valor dela */}
                    {linhas.some((x) => x.tipo === 'valuation' && x.data >= l.data) && (
                      <Aviso tipo="info">Este investimento tem avaliação depois desta operação. Ao excluir, o valor dele muda numa proporção, não exatamente no valor da operação: registre a avaliação de novo em seguida.</Aviso>
                    )}
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

function FormEditarAtivo({ ativo, instituicoes, aoSalvar, aoCancelar }: {
  ativo: AtivoInvestimento
  /** instituições já usadas em outros ativos, para sugerir a mesma grafia; null = banco sem a migration 106: o campo não aparece */
  instituicoes: string[] | null
  aoSalvar: (d: { ativoId: string; nome: string; ticker: string; classe: ClasseAtivo; instituicao: string; cotacaoBolsa: boolean | null }) => Promise<void>
  aoCancelar: () => void
}) {
  const [instituicao, setInstituicao] = useState(ativo.instituicao ?? '')
  const [cotacaoBolsa, setCotacaoBolsa] = useState(ativo.cotacaoBolsa === true)
  const lista = `sugestoes-instituicao-${ativo.id}`
  const [nome, setNome] = useState(ativo.nome)
  const [ticker, setTicker] = useState(ativo.ticker ?? '')
  const [classe, setClasse] = useState<ClasseAtivo>(ativo.classe)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  // null no ativo = banco sem a migration 109: a opção não aparece
  const podeBolsa = ativo.cotacaoBolsa !== null && codigoDaBolsa(ticker, classe, ativo.moeda) !== null
  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim()) { setErro('Informe o nome do ativo.'); return }
    setErro(''); setEnviando(true)
    // só manda a escolha quando a opção estava na tela; código que deixou de ser da bolsa não desliga nada sozinho
    try { await aoSalvar({ ativoId: ativo.id, nome, ticker, classe, instituicao, cotacaoBolsa: podeBolsa ? cotacaoBolsa : null }) }
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
        {instituicoes && <>
          <Field rotulo="Instituição (opcional; vazio limpa)" value={instituicao} onChange={(e) => setInstituicao(e.target.value)} maxLength={40} list={lista} />
          <datalist id={lista}>{instituicoes.map((x) => <option key={x} value={x} />)}</datalist>
        </>}
        {podeBolsa && <OpcaoCotacaoBolsa marcada={cotacaoBolsa} aoMudar={setCotacaoBolsa} className="md:col-span-2" />}
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

/** A escolha de acompanhar a cotação da bolsa (migration 109). Só aparece em ativo que pode: quem chama confere. */
function OpcaoCotacaoBolsa({ marcada, aoMudar, className = '' }: { marcada: boolean; aoMudar: (v: boolean) => void; className?: string }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-700 ${className}`}>
      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={marcada} onChange={(e) => aoMudar(e.target.checked)} />
      <span>
        <span className="font-semibold text-marinho">Acompanhar a cotação da bolsa</span>
        <span className="block text-slate-600">O valor passa a seguir o preço da B3, buscado todo dia útil (fonte: brapi). Lance sempre a quantidade de cotas e o preço; "só o valor" deixa de valer neste ativo.</span>
      </span>
    </label>
  )
}

function LinhaFolha({ id, rotulo, children }: { id: string; rotulo: string; children: ReactNode }) {
  return (
    <div className={LINHA_FOLHA}>
      <label htmlFor={id} className="shrink-0 text-base text-marinho">{rotulo}</label>
      {children}
    </div>
  )
}

/** Cancelar e a ação principal no pé da folha; o botão principal envia o formulário pelo id. */
function PeFolha({ idForm, rotulo, enviando, aoCancelar }: { idForm: string; rotulo: string; enviando: boolean; aoCancelar: () => void }) {
  return <>
    <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
    <Button type="submit" form={idForm} carregando={enviando}>{rotulo}</Button>
  </>
}

function FormAtivo({ instituicoes, bancoTemCotacao, aoSalvar, aoCancelar }: {
  /** instituições já usadas em outros ativos, para sugerir a mesma grafia; null = banco sem a migration 106: o campo não aparece */
  instituicoes: string[] | null
  /** false = banco sem a migration 109: a opção de acompanhar a bolsa não aparece */
  bancoTemCotacao: boolean
  aoSalvar: (d: { nome: string; ticker: string; classe: ClasseAtivo; moeda: MoedaInvestimento; subclasse: string; liquidez: Liquidez; instituicao: string; cotacaoBolsa: boolean }) => Promise<void>
  aoCancelar: () => void
}) {
  // ligada por padrão: ativo novo não tem lançamento, então a quantidade ainda vai ser digitada em cotas
  const [cotacaoBolsa, setCotacaoBolsa] = useState(true)
  const [subclasse, setSubclasse] = useState('')
  const [instituicao, setInstituicao] = useState('')
  const [liquidez, setLiquidez] = useState<Liquidez>('liquid')
  const [nome, setNome] = useState('')
  const [ticker, setTicker] = useState('')
  // sem categoria pré-escolhida: começar em "Renda fixa" fez um FII ser gravado como renda fixa (o dono não trocou o campo)
  const [categoria, setCategoria] = useState('')
  const [tipo, setTipo] = useState(0)
  const tipos = CATEGORIAS_NOVO_ATIVO.find((x) => x.chave === categoria)?.tipos ?? []
  const classe: ClasseAtivo | '' = tipos[tipo]?.classe ?? ''
  // trocar a categoria ou o tipo sugere a subclasse (e a moeda, em Internacionais); os dois campos continuam editáveis
  function escolherCategoria(chave: string) {
    const nova = CATEGORIAS_NOVO_ATIVO.find((x) => x.chave === chave)
    setCategoria(chave); setTipo(0)
    setSubclasse(nova?.tipos[0]?.subclasse ?? '')
    setMoedaAtivo(nova?.moeda ?? 'BRL')
  }
  function escolherTipo(i: number) { setTipo(i); setSubclasse(tipos[i]?.subclasse ?? '') }
  const [moedaAtivo, setMoedaAtivo] = useState<MoedaInvestimento>('BRL')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const id = useId()
  const podeBolsa = bancoTemCotacao && codigoDaBolsa(ticker, classe, moedaAtivo) !== null
  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!nome.trim()) { setErro('Informe o nome do ativo.'); return }
    if (!classe) { setErro('Escolha a categoria do ativo (ex.: Ativos Brasil para ação e FII, CDB/LCI/LCA/LC/RDB para renda fixa de banco).'); return }
    setEnviando(true); setErro('')
    // o erro do banco aparece aqui dentro: a folha cobre o aviso do topo da página
    try { await aoSalvar({ nome, ticker, classe, moeda: moedaAtivo, subclasse, liquidez, instituicao, cotacaoBolsa: podeBolsa && cotacaoBolsa }) }
    catch (e2) { setErro(mensagemErroBanco(e2)) }
    finally { setEnviando(false) }
  }
  const aba = (ativa: boolean) => `min-h-11 min-w-0 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors ${ativa ? 'bg-azul-claro text-azul' : 'text-slate-600 hover:bg-slate-50'}`
  return (
    <Folha titulo="Novo ativo" aoFechar={aoCancelar} rodape={<PeFolha idForm={id} rotulo="Salvar ativo" enviando={enviando} aoCancelar={aoCancelar} />}>
      <form id={id} onSubmit={(e) => void enviar(e)} className="flex flex-col gap-4" noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="rounded-xl bg-fundo p-4">
          <label htmlFor={`${id}-nome`} className="sr-only">Nome do ativo</label>
          <input id={`${id}-nome`} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={100} placeholder="Ex.: Previdência, Tesouro Selic 2029" className={TITULO_FOLHA} />
          <div role="radiogroup" aria-label="Liquidez" className="mt-3 flex gap-1 rounded-lg bg-white p-1">
            <button type="button" role="radio" aria-checked={liquidez === 'liquid'} onClick={() => setLiquidez('liquid')} className={aba(liquidez === 'liquid')}>Líquido</button>
            <button type="button" role="radio" aria-checked={liquidez === 'restricted'} onClick={() => setLiquidez('restricted')} className={aba(liquidez === 'restricted')}>Restrito</button>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {liquidez === 'restricted' ? 'Previdência, FGTS: conta no patrimônio, mas não no Disponível.' : 'Dá para resgatar ou vender.'}
          </p>
        </div>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          <LinhaFolha id={`${id}-categoria`} rotulo="Categoria">
            <select id={`${id}-categoria`} value={categoria} onChange={(e) => escolherCategoria(e.target.value)} className={CONTROLE_FOLHA}>
              <option value="">Escolha a categoria</option>
              {CATEGORIAS_NOVO_ATIVO.map((x) => <option key={x.chave} value={x.chave}>{x.rotulo}</option>)}
            </select>
          </LinhaFolha>
          {tipos.length > 1 && (
            <LinhaFolha id={`${id}-tipo`} rotulo="Tipo">
              <select id={`${id}-tipo`} value={tipo} onChange={(e) => escolherTipo(Number(e.target.value))} className={CONTROLE_FOLHA}>
                {tipos.map((x, i) => <option key={x.rotulo} value={i}>{x.rotulo}</option>)}
              </select>
            </LinhaFolha>
          )}
          <LinhaFolha id={`${id}-moeda`} rotulo="Moeda do ativo">
            <select id={`${id}-moeda`} value={moedaAtivo} onChange={(e) => setMoedaAtivo(e.target.value as MoedaInvestimento)} className={CONTROLE_FOLHA}>
              {moedas.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
          </LinhaFolha>
          <LinhaFolha id={`${id}-ticker`} rotulo="Ticker ou código (opcional)">
            <input id={`${id}-ticker`} value={ticker} onChange={(e) => setTicker(e.target.value)} maxLength={20} placeholder="PETR4, BTC" className={CONTROLE_FOLHA} />
          </LinhaFolha>
          <LinhaFolha id={`${id}-sub`} rotulo="Subclasse (opcional)">
            <input id={`${id}-sub`} value={subclasse} onChange={(e) => setSubclasse(e.target.value)} maxLength={40} list={`${id}-sugestoes`} placeholder="CDB, FIIs" className={CONTROLE_FOLHA} />
          </LinhaFolha>
          {instituicoes && (
            <LinhaFolha id={`${id}-inst`} rotulo="Instituição (opcional)">
              <input id={`${id}-inst`} value={instituicao} onChange={(e) => setInstituicao(e.target.value)} maxLength={40} list={`${id}-instituicoes`} placeholder="Banco ou corretora" className={CONTROLE_FOLHA} />
            </LinhaFolha>
          )}
        </div>
        {podeBolsa && <OpcaoCotacaoBolsa marcada={cotacaoBolsa} aoMudar={setCotacaoBolsa} />}
        <datalist id={`${id}-instituicoes`}>{(instituicoes ?? []).map((x) => <option key={x} value={x} />)}</datalist>
        <datalist id={`${id}-sugestoes`}>{(classe ? SUGESTOES_SUBCLASSE[classe] : []).map((x) => <option key={x} value={x} />)}</datalist>
        <p className="text-sm text-slate-600">Sem ticker (cofrinho, CDB, previdência, reserva), tudo é lançado só pelo valor em reais. Para lançar por quantidade e preço (ação, FII, fundo com cotas), informe o ticker ou um código.</p>
      </form>
    </Folha>
  )
}


type DadosAvaliacao =
  | { ativoId: string; data: string; precoUnitario: string; fonte: string }
  | { ativoId: string; data: string; valor: Cents; fonte: string }

/**
 * Avaliação manual numa folha. Ativo sem ticker (cofrinho, previdência, reserva) ou com exatamente 1 unidade pede o
 * valor de hoje, e o banco divide pelo número de unidades (migration 104); os outros, o preço por unidade. O número vai
 * para o banco como digitado, sem conta aqui.
 */
function FormAvaliacao({ ativos, quantidades, ativoInicial, aoSalvar, aoCancelar }: {
  ativos: AtivoInvestimento[]
  /** ativo já escolhido (botão "Atualizar valor" da linha do ativo) */
  ativoInicial?: string
  /** quantidade em carteira por ativo (texto do banco) */
  quantidades: Map<string, string>
  aoSalvar: (d: DadosAvaliacao) => Promise<void>
  aoCancelar: () => void
}) {
  const [ativoId, setAtivoId] = useState(ativos.some((a) => a.id === ativoInicial) ? ativoInicial! : ativos[0]?.id ?? '')
  const [data, setData] = useState(hojeSP())
  const [precoTexto, setPrecoTexto] = useState('')
  const [fonte, setFonte] = useState('Informado manualmente')
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const id = useId()
  const ativo = ativos.find((a) => a.id === ativoId)
  const codigo = ativo?.moeda ?? 'BRL'
  const umaUnidade = !!ativo && (!ativo.ticker || Number(quantidades.get(ativoId) ?? '0') === 1)
  const rotuloValor = umaUnidade ? `Valor de hoje (${codigo})` : `Preço atual por unidade (${codigo})`
  async function enviar(e: FormEvent) {
    e.preventDefault()
    const total = umaUnidade ? parseBRL(precoTexto) : null
    if (!ativoId || !data || !fonte.trim() ||
        (umaUnidade ? total === null || total <= 0
          : !/^\d{1,12}(?:[.,]\d{1,10})?$/.test(precoTexto.trim()) || Number(precoTexto.replace(',', '.')) <= 0)) {
      setErro(umaUnidade ? 'Informe o valor de hoje, a data e a fonte.' : 'Informe o preço por unidade, a data e a fonte.'); return
    }
    setErro(''); setEnviando(true)
    try { await aoSalvar(umaUnidade && total !== null ? { ativoId, data, valor: total, fonte } : { ativoId, data, precoUnitario: precoTexto, fonte }) }
    catch (e2) { setErro(mensagemErroBanco(e2)) }
    finally { setEnviando(false) }
  }
  return (
    <Folha titulo="Registrar avaliação" aoFechar={aoCancelar} rodape={<PeFolha idForm={id} rotulo="Salvar avaliação" enviando={enviando} aoCancelar={aoCancelar} />}>
      <form id={id} onSubmit={(e) => void enviar(e)} className="flex flex-col gap-4" noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="rounded-xl bg-fundo p-4">
          <label htmlFor={`${id}-ativo`} className="sr-only">Ativo</label>
          <select id={`${id}-ativo`} value={ativoId} onChange={(e) => setAtivoId(e.target.value)} className={TITULO_FOLHA}>
            {ativos.map((a) => <option key={a.id} value={a.id}>{a.nome} · {a.moeda}</option>)}
          </select>
          <div className="mt-2 flex items-baseline gap-1 text-marinho">
            <span aria-hidden="true" className="text-xl font-semibold">{simboloMoeda(codigo)}</span>
            <label htmlFor={`${id}-preco`} className="sr-only">{rotuloValor}</label>
            <input id={`${id}-preco`} inputMode="decimal" placeholder="0,00" value={precoTexto} onChange={(e) => setPrecoTexto(e.target.value)} className={GRANDE_FOLHA} />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {umaUnidade ? 'Quanto você tem hoje neste investimento.' : 'O preço de uma unidade, não o valor total da posição.'}
          </p>
        </div>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          <LinhaFolha id={`${id}-data`} rotulo="Data da avaliação">
            <input id={`${id}-data`} type="date" value={data} onChange={(e) => setData(e.target.value)} className={`${CONTROLE_FOLHA} appearance-none`} />
          </LinhaFolha>
          <LinhaFolha id={`${id}-fonte`} rotulo="Fonte">
            <input id={`${id}-fonte`} value={fonte} onChange={(e) => setFonte(e.target.value)} maxLength={80} placeholder="Extrato da corretora" className={CONTROLE_FOLHA} />
          </LinhaFolha>
        </div>
        <p className="text-sm text-slate-600">
          Cada avaliação fica guardada no histórico; a mais recente define o valor de mercado.
          {umaUnidade ? ' Lance antes os aportes e resgates do dia: o valor de hoje deve ser o saldo já com eles.' : ''}
        </p>
      </form>
    </Folha>
  )
}
