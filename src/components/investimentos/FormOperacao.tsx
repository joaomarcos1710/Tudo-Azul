import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Aviso } from '../ui/Aviso'
import { Button } from '../ui/Button'
import { Folha } from '../ui/Folha'
import { hojeSP } from '../../lib/contas'
import type { Conta } from '../../lib/contas'
import { parseBRL, simboloMoeda } from '../../lib/format'
import type { Cents } from '../../lib/format'
import { mensagemErroBanco } from '../../lib/erros'
import { listarAtivosInvestimento, registrarOperacaoInvestimento, registrarOperacaoPorValor } from '../../lib/investimentos'
import type { AtivoInvestimento, TipoOperacaoInvestimento } from '../../lib/investimentos'

/* Peças das folhas de Investimentos, no desenho do formulário de Lançamentos: o principal num bloco claro em destaque,
 * o resto em linhas (nome do campo à esquerda, controle à direita; select e data nativos abrem a roda no iPhone). */
export const LINHA_FOLHA = 'flex min-h-14 items-center justify-between gap-3 px-4'
export const CONTROLE_FOLHA = 'min-h-11 min-w-0 flex-1 rounded-md bg-transparent px-1 text-right text-base text-slate-700 tabular-nums focus:outline focus:outline-2 focus:outline-azul'
export const GRANDE_FOLHA = 'min-h-14 w-full min-w-0 rounded-md bg-transparent px-1 text-4xl font-bold tabular-nums tracking-tight text-marinho placeholder:text-current placeholder:opacity-40 focus:outline focus:outline-2 focus:outline-azul'
export const TITULO_FOLHA = 'min-h-11 w-full min-w-0 rounded-md bg-transparent px-1 text-lg font-medium text-marinho placeholder:text-slate-500 focus:outline focus:outline-2 focus:outline-azul'

/**
 * Compra ou venda numa folha por cima da tela, no desenho do formulário de Lançamentos (pedido do dono, 10/11/2026):
 * tipo em duas abas, o ativo e o número principal em destaque, o resto em linhas.
 * "Só o valor" (migration 104): aporte e resgate em reais, para ativo que não tem cota (cofrinho, CDB, reserva,
 * previdência). O banco converte o valor em unidades pelo valor atual do ativo; nenhuma conta é feita aqui. Sem tarifas
 * neste modo.
 * Ativo sem ticker é SÓ por valor: "Quantidade e preço" não aparece. Num ativo sem cota, digitar "1 × R$ 500" depois de uma
 * avaliação gravaria 1 unidade ao preço da avaliação, e o valor subiria num número que ninguém digitou (achado da revisão
 * de dinheiro da #294). Quem tem um fundo com cotas informa um ticker ou código no ativo.
 * Ativo com ticker começa em "Quantidade e preço" e pode trocar para "Só o valor".
 */
export type DadosOperacao =
  | { ativoId: string; data: string; tipo: TipoOperacaoInvestimento; quantidade: string; precoUnitario: string; tarifas: Cents; observacao: string; contaId?: string }
  | { ativoId: string; data: string; tipo: TipoOperacaoInvestimento; valor: Cents; observacao: string; contaId?: string }

export function FormOperacao({ ativos, contas, tipoInicial = 'buy', ativoInicial, aoSalvar, aoCancelar }: {
  ativos: AtivoInvestimento[]
  tipoInicial?: TipoOperacaoInvestimento
  /** ativo já escolhido (botões Aporte/Resgate da linha do ativo); sem ele, o primeiro da lista */
  ativoInicial?: string
  /** contas em reais, ativas: de onde sai a compra ou para onde volta a venda (opcional) */
  contas: Conta[]
  aoSalvar: (d: DadosOperacao) => Promise<void>
  aoCancelar: () => void
}) {
  const [ativoId, setAtivoId] = useState(ativos.some((a) => a.id === ativoInicial) ? ativoInicial! : ativos[0]?.id ?? '')
  const [data, setData] = useState(hojeSP())
  const [tipo, setTipo] = useState<TipoOperacaoInvestimento>(tipoInicial)
  const [modo, setModo] = useState<'valor' | 'unidades' | null>(null)
  const [valorTexto, setValorTexto] = useState('')
  const [qtd, setQtd] = useState('')
  const [precoTexto, setPrecoTexto] = useState('')
  const [tarifaTexto, setTarifaTexto] = useState('0,00')
  const [observacao, setObservacao] = useState('')
  // vazio = não passou por conta do app (ex.: previdência): só a operação
  const [contaId, setContaId] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const idForm = useId()
  const ativo = ativos.find((a) => a.id === ativoId)
  const codigo = ativo?.moeda ?? 'BRL'
  const semHistorico = !!ativo && ativo.quantidadeOperacoes === 0 && ativo.quantidadeAvaliacoes === 0
  // ativo sem ticker (cofrinho, previdência, reserva) é só por valor; com ticker, começa em unidades e pode trocar
  const semCota = !ativo?.ticker
  const modoAtual = semCota ? 'valor' : modo ?? 'unidades'
  // primeira posição: o valor digitado é quanto já existe no investimento, não um aporte novo
  const primeiraPosicao = semHistorico && tipo === 'buy'
  const rotuloValor = primeiraPosicao ? 'Valor de hoje' : tipo === 'buy' ? 'Valor do aporte' : 'Valor do resgate'
  const tarifas = parseBRL(tarifaTexto)
  const valor = parseBRL(valorTexto)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    if (!ativoId || !data) { setErro('Escolha o ativo e a data.'); return }
    // conta só para ativo em reais (o banco também recusa outra moeda)
    const conta = codigo === 'BRL' && contaId ? contaId : undefined
    if (modoAtual === 'valor') {
      if (valor === null || valor <= 0) { setErro(`Informe o ${rotuloValor.toLowerCase()}.`); return }
      setErro(''); setEnviando(true)
      try { await aoSalvar({ ativoId, data, tipo, valor, observacao, ...(conta ? { contaId: conta } : {}) }) }
      catch (e2) { setErro(mensagemErroBanco(e2)) }
      finally { setEnviando(false) }
      return
    }
    const quantidade = qtd, precoUnitario = precoTexto
    if (!/^\d{1,12}(?:[.,]\d{1,12})?$/.test(qtd.trim()) || Number(qtd.replace(',', '.')) <= 0 ||
        !/^\d{1,12}(?:[.,]\d{1,10})?$/.test(precoTexto.trim()) || Number(precoTexto.replace(',', '.')) <= 0) {
      setErro('Confira a quantidade e o preço por unidade.'); return
    }
    if (tarifas === null || tarifas < 0) { setErro('Confira as tarifas.'); return }
    setErro(''); setEnviando(true)
    // o erro do banco aparece aqui dentro: a folha cobre o aviso do topo da página
    try { await aoSalvar({ ativoId, data, tipo, quantidade, precoUnitario, tarifas, observacao, ...(conta ? { contaId: conta } : {}) }) }
    catch (e2) { setErro(mensagemErroBanco(e2)) }
    finally { setEnviando(false) }
  }

  const aba = (ativa: boolean, cor: string) =>
    `min-h-11 min-w-0 flex-1 rounded-lg px-3 text-sm font-semibold transition-colors ${ativa ? cor : 'text-slate-600 hover:bg-white'}`
  const linha = LINHA_FOLHA, controle = CONTROLE_FOLHA, grande = GRANDE_FOLHA

  return (
    <Folha titulo="Registrar compra ou venda" aoFechar={aoCancelar}
      rodape={<>
        <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        <Button type="submit" form={idForm} carregando={enviando}>{tipo === 'buy' ? 'Registrar compra' : 'Registrar venda'}</Button>
      </>}>
      <form id={idForm} onSubmit={(e) => void enviar(e)} className="flex flex-col gap-4" noValidate>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}

        <div role="radiogroup" aria-label="Operação" className="flex gap-1 rounded-xl bg-slate-100 p-1">
          <button type="button" role="radio" aria-checked={tipo === 'buy'} onClick={() => setTipo('buy')} className={aba(tipo === 'buy', 'bg-azul text-white')}>Compra</button>
          <button type="button" role="radio" aria-checked={tipo === 'sell'} onClick={() => setTipo('sell')} className={aba(tipo === 'sell', 'bg-marinho text-white')}>Venda</button>
        </div>

        <div className="rounded-xl bg-fundo p-4">
          <label htmlFor={`${idForm}-ativo`} className="sr-only">Ativo</label>
          <select id={`${idForm}-ativo`} value={ativoId} onChange={(e) => { setAtivoId(e.target.value); setModo(null) }}
            className="min-h-11 w-full min-w-0 rounded-md bg-transparent px-1 text-lg font-medium text-marinho focus:outline focus:outline-2 focus:outline-azul">
            {ativos.map((a) => <option key={a.id} value={a.id}>{a.nome} · {a.moeda}</option>)}
          </select>

          {ativo && !semCota && (
            <div role="radiogroup" aria-label="Como informar" className="mt-3 flex gap-1 rounded-lg bg-white p-1">
              <button type="button" role="radio" aria-checked={modoAtual === 'valor'} onClick={() => setModo('valor')} className={aba(modoAtual === 'valor', 'bg-azul-claro text-azul')}>Só o valor</button>
              <button type="button" role="radio" aria-checked={modoAtual === 'unidades'} onClick={() => setModo('unidades')} className={aba(modoAtual === 'unidades', 'bg-azul-claro text-azul')}>Quantidade e preço</button>
            </div>
          )}

          {modoAtual === 'valor' ? (
            <>
              <div className="mt-2 flex items-baseline gap-1 text-marinho">
                <span aria-hidden="true" className="text-xl font-semibold">{simboloMoeda(codigo)}</span>
                <label htmlFor={`${idForm}-valor`} className="sr-only">{rotuloValor} ({codigo})</label>
                <input id={`${idForm}-valor`} inputMode="decimal" placeholder="0,00" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} className={grande} />
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {primeiraPosicao ? 'Quanto você tem hoje neste investimento. Para atualizar depois, use "Registrar avaliação" com o valor novo.'
                  : tipo === 'buy' ? 'Quanto você está colocando agora. O rendimento não entra aqui: use "Registrar avaliação". Se você já atualizou o valor de hoje e ele incluía este depósito, registre a avaliação de novo depois.'
                  : 'Quanto você está tirando. Se o saldo rendeu, registre a avaliação antes; para resgatar tudo, informe o valor total de hoje.'}
              </p>
            </>
          ) : (
            <div className="mt-2 flex items-baseline gap-1 text-marinho">
              <label htmlFor={`${idForm}-qtd`} className="sr-only">Quantidade</label>
              <input id={`${idForm}-qtd`} inputMode="decimal" placeholder="0" value={qtd} onChange={(e) => setQtd(e.target.value)} className={grande} />
              <span aria-hidden="true" className="shrink-0 text-base font-semibold text-slate-500">unidades</span>
            </div>
          )}
        </div>

        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {modoAtual === 'unidades' && (
            <div className={linha}>
              <label htmlFor={`${idForm}-preco`} className="shrink-0 text-base text-marinho">Preço por unidade ({codigo})</label>
              <input id={`${idForm}-preco`} inputMode="decimal" placeholder="Ex.: 25,75" value={precoTexto} onChange={(e) => setPrecoTexto(e.target.value)} className={controle} />
            </div>
          )}
          {codigo === 'BRL' && (
            <div className={linha}>
              <label htmlFor={`${idForm}-conta`} className="shrink-0 text-base text-marinho">{tipo === 'buy' ? 'Saiu da conta' : 'Volta para a conta'}</label>
              <select id={`${idForm}-conta`} value={contaId} onChange={(e) => setContaId(e.target.value)} className={controle}>
                <option value="">Nenhuma (fora do app)</option>
                {contas.filter((c) => (c.moeda ?? 'BRL') === 'BRL').map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
          )}
          <div className={linha}>
            <label htmlFor={`${idForm}-data`} className="shrink-0 text-base text-marinho">Data</label>
            <input id={`${idForm}-data`} type="date" value={data} onChange={(e) => setData(e.target.value)} className={`${controle} appearance-none`} />
          </div>
          {modoAtual === 'unidades' && (
            <div className={linha}>
              <label htmlFor={`${idForm}-tarifas`} className="shrink-0 text-base text-marinho">Tarifas ({codigo})</label>
              <input id={`${idForm}-tarifas`} inputMode="decimal" value={tarifaTexto} onChange={(e) => setTarifaTexto(e.target.value)} className={controle} />
            </div>
          )}
          <div className={linha}>
            <label htmlFor={`${idForm}-obs`} className="shrink-0 text-base text-marinho">Observação</label>
            <input id={`${idForm}-obs`} value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={500} placeholder="Opcional" className={controle} />
          </div>
        </div>

        <p className="text-sm text-slate-600">
          {modoAtual === 'valor'
            ? (tipo === 'sell' ? 'O resgate não pode superar o valor de hoje do investimento.' : '')
            : (tipo === 'sell' ? 'A venda não pode superar a quantidade que você tem.' : 'As tarifas da compra entram no custo de aquisição.')}{' '}
          {contaId && codigo === 'BRL'
            ? (tipo === 'buy' ? 'O valor sai da conta escolhida e vai para a carteira, sem virar despesa.' : 'O valor líquido volta para a conta escolhida, sem virar receita.')
            : 'Sem conta escolhida, nenhuma conta muda.'}
        </p>
      </form>
    </Folha>
  )
}

/** Grava a operação pelo caminho certo: só o valor (o banco converte em unidades, migration 104) ou quantidade e preço. */
export async function gravarOperacao(d: DadosOperacao): Promise<void> {
  if ('valor' in d) await registrarOperacaoPorValor(d)
  else await registrarOperacaoInvestimento(d)
}

/**
 * Aporte ou resgate a partir do "Novo lançamento" (pedido do dono, 10/11/2026): a mesma folha de Investimentos, já no
 * tipo escolhido. Carrega os ativos aqui porque Lançamentos não os tem; sem nenhum ativo, explica e leva a Investimentos.
 */
export function OperacaoRapida({ familiaId, tipo, contas, aoSalvar, aoFechar }: {
  familiaId: string
  tipo: TipoOperacaoInvestimento
  /** contas em reais, ativas */
  contas: Conta[]
  aoSalvar: () => Promise<void> | void
  aoFechar: () => void
}) {
  const [ativos, setAtivos] = useState<AtivoInvestimento[] | null>(null)
  const [erro, setErro] = useState('')
  useEffect(() => {
    let vivo = true
    listarAtivosInvestimento(familiaId)
      .then((lista) => { if (vivo) setAtivos(lista.filter((a) => a.ativo)) })
      .catch((e) => { if (vivo) setErro(mensagemErroBanco(e)) })
    return () => { vivo = false }
  }, [familiaId])

  const titulo = tipo === 'buy' ? 'Aporte em investimento' : 'Resgate de investimento'
  if (erro) return <Folha titulo={titulo} aoFechar={aoFechar}><Aviso tipo="erro">{erro}</Aviso></Folha>
  if (ativos === null) return <Folha titulo={titulo} aoFechar={aoFechar}><p role="status" className="text-sm text-slate-600">Carregando investimentos…</p></Folha>
  if (ativos.length === 0) {
    return (
      <Folha titulo={titulo} aoFechar={aoFechar}>
        <p className="text-sm text-slate-700">Você ainda não tem nenhum investimento cadastrado. Cadastre o primeiro (cofrinho, CDB, ação, previdência) e volte aqui.</p>
        <p className="mt-3"><Link to="/investimentos" className="font-semibold text-azul hover:underline">Ir para Investimentos</Link></p>
      </Folha>
    )
  }
  return (
    <FormOperacao ativos={ativos} contas={contas} tipoInicial={tipo} aoCancelar={aoFechar}
      aoSalvar={async (d) => { await gravarOperacao(d); await aoSalvar() }} />
  )
}
