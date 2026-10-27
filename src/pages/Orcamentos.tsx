import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { Selecao } from '../components/ui/Selecao'
import { useFamilia } from '../lib/FamiliaContext'
import { agrupar, listarCategorias } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import { hojeSP } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { currentMonth, formatBRL, formatBRLCampo, formatMonth, parseBRL } from '../lib/format'
import type { Cents } from '../lib/format'
import { somarMeses } from '../lib/lancamentos'
import { copiarDoMesAnterior, definirOrcamento, listarOrcamentos, removerOrcamento } from '../lib/orcamentos'
import type { OrcamentoMes } from '../lib/orcamentos'

/** Orçamento mensal por categoria principal, com a projeção até o fim do mês (calculada no banco). */
export default function Orcamentos() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [mes, setMes] = useState(() => currentMonth())
  const [itens, setItens] = useState<OrcamentoMes[] | null>(null)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [adicionando, setAdicionando] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)
  const hoje = hojeSP()
  const mesAtual = hoje.slice(0, 7)
  // só a resposta do último pedido vale: trocar de mês rápido não pode deixar a lista de um mês sob o título de outro
  const pedido = useRef(0)

  const carregar = useCallback(async () => {
    if (!familiaId) return
    const meu = ++pedido.current
    try {
      const [o, c] = await Promise.all([listarOrcamentos(familiaId, mes, hoje), listarCategorias(familiaId)])
      if (meu !== pedido.current) return
      setItens(o)
      setCategorias(c)
      setErro('')
    } catch (err) {
      if (meu === pedido.current) setErro(mensagemErroBanco(err))
    }
  }, [familiaId, mes, hoje])

  useEffect(() => { setItens(null); setAviso(''); setAdicionando(false); setEditando(null); void carregar() }, [carregar])

  const [copiando, setCopiando] = useState(false)
  async function copiar() {
    if (!familiaId || copiando) return
    setAviso('')
    setCopiando(true)
    try {
      const n = await copiarDoMesAnterior(familiaId, mes, somarMeses(mes, -1))
      setAviso(n === 0 ? 'Nada para copiar: o mês anterior não tem limites que faltem aqui.' : `${n} ${n === 1 ? 'limite copiado' : 'limites copiados'} de ${formatMonth(somarMeses(mes, -1))}.`)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setCopiando(false)
    }
  }

  async function remover(o: OrcamentoMes) {
    if (!familiaId || !window.confirm(`Remover o orçamento de ${o.nome} em ${formatMonth(mes)}? Os lançamentos não mudam.`)) return
    try {
      await removerOrcamento(familiaId, o.categoriaId, mes)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }

  if (!familiaId) return null
  const comOrcamento = new Set((itens ?? []).map((o) => o.categoriaId))
  // orçamento só em categoria principal de despesa (regra do banco); "Sem categoria" fica de fora
  const disponiveis = agrupar(categorias, 'expense').filter((g) => !g.sistema && g.ativa && !comOrcamento.has(g.id))
  const emAndamento = mes === mesAtual
  const diasDecorridos = Number(hoje.slice(8, 10))

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Orçamentos</h1>
        {!adicionando && itens !== null && disponiveis.length > 0 && <Button onClick={() => setAdicionando(true)}>Novo orçamento</Button>}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Button variante="secundario" aria-label="Mês anterior" onClick={() => setMes(somarMeses(mes, -1))}>‹</Button>
        <span className="min-w-44 text-center font-semibold capitalize">{formatMonth(mes)}</span>
        <Button variante="secundario" aria-label="Próximo mês" onClick={() => setMes(somarMeses(mes, 1))}>›</Button>
      </div>

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      {aviso && !erro && <div className="mb-4"><Aviso tipo="sucesso">{aviso}</Aviso></div>}
      {emAndamento && diasDecorridos < 7 && itens !== null && itens.length > 0 && (
        <div className="mb-4"><Aviso tipo="info">Nos primeiros 7 dias do mês a projeção não inclui o ritmo de gasto (só o que já foi gasto e o que já está previsto). O ritmo entra a partir do 7º dia.</Aviso></div>
      )}

      {adicionando && (
        <FormOrcamento
          titulo="Novo orçamento"
          categorias={disponiveis.map((g): [string, string] => [g.id, g.nome])}
          aoSalvar={async (categoriaId, limite) => {
            await definirOrcamento(familiaId, categoriaId, mes, limite)
            setAdicionando(false)
            await carregar()
          }}
          aoCancelar={() => setAdicionando(false)}
        />
      )}

      {itens === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}

      {itens?.length === 0 && !adicionando && (
        <EmptyState
          titulo={`Nenhum orçamento em ${formatMonth(mes)}`}
          descricao="Defina quanto você quer gastar por mês em cada categoria principal (Mercado, Restaurantes, Transporte…). O app mostra quanto já gastou e se, no ritmo atual, o mês vai estourar."
          acao={
            <div className="flex flex-wrap justify-center gap-2">
              {disponiveis.length > 0 && <Button onClick={() => setAdicionando(true)}>Definir o primeiro</Button>}
              <Button variante="secundario" onClick={copiar} carregando={copiando}>Copiar do mês anterior</Button>
            </div>
          }
        />
      )}

      <ul className="flex flex-col gap-3">
        {itens?.map((o) => (
          <li key={o.categoriaId}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-lg font-semibold">{o.nome}</p>
                  <p className="text-sm text-slate-500">Limite {formatBRL(o.limite)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-500">Gasto no mês</p>
                  <p className={`tabular-nums text-lg font-semibold ${o.gasto > o.limite ? 'text-negativo' : ''}`}>{formatBRL(o.gasto)}</p>
                </div>
              </div>
              <Barra gasto={o.gasto} limite={o.limite} />
              <Situacao o={o} emAndamento={emAndamento} />
              {editando === o.categoriaId ? (
                <FormOrcamento
                  titulo={`Limite de ${o.nome}`}
                  inicial={o.limite}
                  aoSalvar={async (_c, limite) => {
                    await definirOrcamento(familiaId, o.categoriaId, mes, limite)
                    setEditando(null)
                    await carregar()
                  }}
                  aoCancelar={() => setEditando(null)}
                />
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variante="fantasma" onClick={() => setEditando(o.categoriaId)}>Alterar limite</Button>
                  <Button variante="fantasma" onClick={() => remover(o)}>Remover</Button>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>

      {itens !== null && itens.length > 0 && (
        <div className="mt-4"><Button variante="secundario" onClick={copiar} carregando={copiando}>Copiar limites do mês anterior</Button></div>
      )}
    </>
  )
}

/** A proporção só desenha a barra; gasto e limite vêm do banco. */
function Barra({ gasto, limite }: { gasto: Cents; limite: Cents }) {
  const pct = Math.max(0, Math.min(100, (gasto / limite) * 100))
  const passou = gasto > limite
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" role="img"
      aria-label={`Gasto ${formatBRL(gasto)} de ${formatBRL(limite)}`}>
      <div className={`h-full rounded-full ${passou ? 'bg-negativo' : pct >= 80 ? 'bg-planejado' : 'bg-azul'}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Texto da situação. Valores da projeção vêm do banco (budget_projection); o app não soma dinheiro. */
function Situacao({ o, emAndamento }: { o: OrcamentoMes; emAndamento: boolean }) {
  if (o.gasto > o.limite) {
    return <p className="mt-2 text-sm font-medium text-negativo">Já passou do limite em {formatBRL((o.gasto - o.limite) as Cents)}.</p>
  }
  if (!emAndamento) {
    // mês passado ou futuro: sem ritmo; "sobra" já desconta o que está previsto (ex.: parcela de cartão que ainda vai fechar)
    if (o.sobra !== null && o.sobra < 0) {
      return <p className="mt-2 text-sm text-planejado">Com o que já está previsto, passa do limite em {formatBRL(-o.sobra as Cents)}.</p>
    }
    return <p className="mt-2 text-sm text-slate-600">Ainda dentro do limite: sobram {formatBRL((o.sobra ?? (o.limite - o.gasto)) as Cents)}.</p>
  }
  if (o.projetado === null || o.sobra === null) {
    return <p className="mt-2 text-sm text-slate-600">Ainda dentro do limite: sobram {formatBRL((o.limite - o.gasto) as Cents)}.</p>
  }
  const detalhe = `Gasto ${formatBRL(o.gasto)} + previsto ${formatBRL(o.previsto ?? (0 as Cents))} + ritmo do mês ${formatBRL(o.ritmo ?? (0 as Cents))}`
  return o.sobra < 0 ? (
    <p className="mt-2 text-sm text-planejado">
      <strong>No ritmo atual vai passar do limite em {formatBRL(-o.sobra as Cents)}</strong> (projeção {formatBRL(o.projetado)}). <span className="text-slate-500">{detalhe}.</span>
    </p>
  ) : (
    <p className="mt-2 text-sm text-positivo">
      No ritmo: projeção {formatBRL(o.projetado)}, sobram {formatBRL(o.sobra)}. <span className="text-slate-500">{detalhe}.</span>
    </p>
  )
}

function FormOrcamento({ titulo, categorias, inicial, aoSalvar, aoCancelar }: {
  titulo: string
  /** Escolha da categoria: só no orçamento novo. */
  categorias?: [string, string][]
  inicial?: Cents
  aoSalvar: (categoriaId: string, limite: Cents) => Promise<void>
  aoCancelar: () => void
}) {
  const [categoriaId, setCategoriaId] = useState('')
  const [texto, setTexto] = useState(inicial !== undefined ? formatBRLCampo(inicial) : '')
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)
  const limite = parseBRL(texto)
  const erroLimite = tentou && (limite === null || limite <= 0) ? 'Informe um valor maior que zero. Exemplo: 1.500,00' : undefined

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (limite === null || limite <= 0 || (categorias && !categoriaId)) return
    setErro('')
    setEnviando(true)
    try {
      await aoSalvar(categoriaId, limite)
    } catch (err) {
      setErro(mensagemErroBanco(err))
      setEnviando(false)
    }
  }

  return (
    <Card className="mb-4 mt-3">
      <h2 className="mb-3 text-base font-semibold">{titulo}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        {categorias && (
          <div>
            <Selecao rotulo="Categoria" valor={categoriaId} aoMudar={setCategoriaId} opcoes={categorias} todos="Escolha…" />
            {tentou && !categoriaId && <p role="alert" className="mt-1 text-sm text-negativo">Escolha a categoria.</p>}
          </div>
        )}
        <Field rotulo="Limite do mês (R$)" inputMode="decimal" placeholder="Ex.: 1.500,00" value={texto}
          onChange={(e) => setTexto(e.target.value)} erro={erroLimite} />
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando}>Salvar</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Card>
  )
}
