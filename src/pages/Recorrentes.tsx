import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { Selecao } from '../components/ui/Selecao'
import { useFamilia } from '../lib/FamiliaContext'
import { listarCartoes } from '../lib/cartoes'
import type { Cartao } from '../lib/cartoes'
import { listarCategorias } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import { hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { formatBRL, formatBRLCampo, formatDate, parseBRL } from '../lib/format'
import {
  criarRecorrencia, editarRecorrencia, encerrarRecorrencia, listarRecorrencias, rotuloTipoRecorrencia,
} from '../lib/recorrencias'
import type { Recorrencia, TipoRecorrencia } from '../lib/recorrencias'

const dias: [string, string][] = Array.from({ length: 31 }, (_, i) => [String(i + 1), `Dia ${i + 1}`])

export default function Recorrentes() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [recorrencias, setRecorrencias] = useState<Recorrencia[] | null>(null)
  const [contas, setContas] = useState<Conta[]>([])
  const [cartoes, setCartoes] = useState<Cartao[]>([])
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [erro, setErro] = useState('')
  const [editando, setEditando] = useState<Recorrencia | 'nova' | null>(null)

  const carregar = useCallback(async () => {
    if (!familiaId) return
    try {
      const [r, c, k, cat] = await Promise.all([
        listarRecorrencias(familiaId), listarContas(familiaId), listarCartoes(familiaId), listarCategorias(familiaId),
      ])
      setRecorrencias(r)
      setContas(c.contas)
      setCartoes(k)
      setCategorias(cat)
      setErro('')
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }, [familiaId])

  useEffect(() => { void carregar() }, [carregar])

  const nomeConta = useMemo(() => new Map(contas.map((c) => [c.id, c.nome])), [contas])
  const nomeCartao = useMemo(() => new Map(cartoes.map((c) => [c.id, c.nome])), [cartoes])
  const nomeCategoria = useMemo(() => new Map(categorias.map((c) => [c.id, c.nome])), [categorias])

  async function encerrar(r: Recorrencia) {
    if (!window.confirm(`Encerrar "${r.descricao}"? Os próximos planejados vão para a lixeira; o que já foi pago fica.`)) return
    try {
      await encerrarRecorrencia(r.id)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }

  if (!familiaId) return null
  const ativas = recorrencias?.filter((r) => r.ativa) ?? []
  const encerradas = recorrencias?.filter((r) => !r.ativa) ?? []

  function onde(r: Recorrencia) {
    if (r.tipo === 'card') return `Cartão ${nomeCartao.get(r.cartaoId ?? '') ?? '?'}`
    if (r.tipo === 'transfer') return `${nomeConta.get(r.contaId ?? '') ?? '?'} → ${nomeConta.get(r.destinoId ?? '') ?? '?'}`
    return nomeConta.get(r.contaId ?? '') ?? '?'
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Recorrentes</h1>
        {editando === null && <Button onClick={() => setEditando('nova')}>Novo recorrente</Button>}
      </div>
      <p className="mb-6 text-sm text-slate-600">
        Contas mensais e assinaturas. Em conta, os próximos 2 meses aparecem como <strong>Planejado</strong> em{' '}
        <Link to="/lancamentos" className="font-semibold text-azul hover:underline">Lançamentos</Link>: quando a conta chegar,
        corrija o valor e marque como pago. No cartão, a compra entra no dia, na fatura certa.
      </p>

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}

      {editando !== null && (
        <FormRecorrencia
          recorrencia={editando === 'nova' ? null : editando}
          contas={contas} cartoes={cartoes} categorias={categorias}
          aoSalvar={async () => { setEditando(null); await carregar() }}
          aoCancelar={() => setEditando(null)}
        />
      )}

      {recorrencias === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}

      {recorrencias?.length === 0 && editando === null && (
        <EmptyState
          titulo="Nenhum recorrente ainda"
          descricao="Cadastre aluguel, luz, salário, condomínio e assinaturas (Netflix, Spotify) uma vez só: o app lança todo mês."
          acao={<Button onClick={() => setEditando('nova')}>Cadastrar o primeiro</Button>}
        />
      )}

      {ativas.length > 0 && (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {ativas.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.descricao}</p>
                  <p className="text-sm text-slate-500">
                    Todo dia {r.dia} · {onde(r)}{r.categoriaId && <> · {nomeCategoria.get(r.categoriaId) ?? 'Sem categoria'}</>}
                  </p>
                  <p className="text-xs text-slate-500">{rotuloTipoRecorrencia[r.tipo]} · desde {formatDate(r.inicio)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className={`tabular-nums font-semibold ${r.tipo === 'income' ? 'text-positivo' : r.tipo === 'transfer' ? 'text-slate-600' : 'text-negativo'}`}>
                    {r.tipo === 'income' ? '+' : r.tipo === 'transfer' ? '⇄ ' : '−'}{formatBRL(r.valor)}
                  </span>
                  <Button variante="fantasma" onClick={() => setEditando(r)} disabled={editando !== null}>Editar</Button>
                  <Button variante="fantasma" onClick={() => encerrar(r)}>Encerrar</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {encerradas.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">Encerrados ({encerradas.length})</summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-500">
            {encerradas.map((r) => (
              <li key={r.id}>{r.descricao} · {formatBRL(r.valor)} · até {r.fim ? formatDate(r.fim) : '—'}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

interface PropsForm {
  recorrencia: Recorrencia | null
  contas: Conta[]
  cartoes: Cartao[]
  categorias: Categoria[]
  aoSalvar: () => Promise<void>
  aoCancelar: () => void
}

function FormRecorrencia({ recorrencia: r, contas, cartoes, categorias, aoSalvar, aoCancelar }: PropsForm) {
  const editando = r !== null
  const contasAtivas = contas.filter((c) => c.ativa)
  const cartoesComCiclo = cartoes.filter((c) => c.ativo && c.fechamento !== null)
  const [tipo, setTipo] = useState<TipoRecorrencia>(r?.tipo ?? 'expense')
  const [descricao, setDescricao] = useState(r?.descricao ?? '')
  const [valorTexto, setValorTexto] = useState(r ? formatBRLCampo(r.valor) : '')
  const [dia, setDia] = useState(r ? String(r.dia) : '')
  const [inicio, setInicio] = useState(r?.inicio ?? hojeSP())
  const [contaId, setContaId] = useState(r?.contaId ?? contasAtivas[0]?.id ?? '')
  const [destinoId, setDestinoId] = useState(r?.destinoId ?? '')
  const [cartaoId, setCartaoId] = useState(r?.cartaoId ?? cartoesComCiclo[0]?.id ?? '')
  const [categoriaId, setCategoriaId] = useState(r?.categoriaId ?? '')
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  const valor = parseBRL(valorTexto)
  const tipoCategoria = tipo === 'income' ? 'income' : 'expense'
  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipoCategoria && (c.ativa || c.id === r?.categoriaId))
  const precisaCategoria = tipo !== 'transfer'

  const problemas = {
    descricao: !descricao.trim() ? 'Informe a descrição.' : undefined,
    valor: valor === null || valor <= 0 ? 'Valor inválido. Exemplo: 180,00' : undefined,
    dia: !dia ? 'Escolha o dia do mês.' : undefined,
    categoria: precisaCategoria && !categoriaId ? 'Escolha a categoria.' : undefined,
    conta: !editando && tipo !== 'card' && !contaId ? 'Escolha a conta.' : undefined,
    destino: !editando && tipo === 'transfer' && (!destinoId || destinoId === contaId) ? 'Escolha uma conta de destino diferente.' : undefined,
    cartao: !editando && tipo === 'card' && !cartaoId ? 'Escolha o cartão.' : undefined,
  }

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (Object.values(problemas).some(Boolean) || valor === null) return
    setErro('')
    setEnviando(true)
    try {
      if (r) {
        await editarRecorrencia(r.id, { descricao, valor, categoriaId: precisaCategoria ? categoriaId : null })
      } else {
        await criarRecorrencia({
          tipo, descricao, valor, dia: Number(dia), inicio,
          contaId: tipo === 'card' ? null : contaId,
          destinoId: tipo === 'transfer' ? destinoId : null,
          cartaoId: tipo === 'card' ? cartaoId : null,
          categoriaId: precisaCategoria ? categoriaId : null,
        })
      }
      await aoSalvar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  const erroDe = (k: keyof typeof problemas) => (tentou ? problemas[k] : undefined)

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">{r ? `Editar ${r.descricao}` : 'Novo recorrente'}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        {!editando && (
          <Selecao rotulo="Tipo" valor={tipo} aoMudar={(v) => { setTipo(v as TipoRecorrencia); setCategoriaId('') }}
            opcoes={Object.entries(rotuloTipoRecorrencia) as [string, string][]} />
        )}
        <Field rotulo="Descrição" maxLength={80} placeholder="Ex.: Conta de luz" value={descricao}
          onChange={(e) => setDescricao(e.target.value)} erro={erroDe('descricao')} />
        <Field rotulo={tipo === 'card' ? 'Valor (R$)' : 'Valor estimado (R$)'} inputMode="decimal" value={valorTexto}
          onChange={(e) => setValorTexto(e.target.value)} erro={erroDe('valor')} />
        {!editando && (
          <>
            <Selecao rotulo="Todo dia" valor={dia} aoMudar={setDia} opcoes={dias} todos="Escolha…" />
            {erroDe('dia') && <p role="alert" className="text-sm text-negativo">{erroDe('dia')}</p>}
            <Field rotulo="A partir de" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
            {tipo === 'card' ? (
              <>
                <Selecao rotulo="Cartão" valor={cartaoId} aoMudar={setCartaoId} opcoes={cartoesComCiclo.map((c) => [c.id, c.nome])} todos="Escolha…" />
                {erroDe('cartao') && <p role="alert" className="text-sm text-negativo">{erroDe('cartao')}</p>}
              </>
            ) : (
              <>
                <Selecao rotulo={tipo === 'transfer' ? 'Da conta' : 'Conta'} valor={contaId} aoMudar={setContaId}
                  opcoes={contasAtivas.map((c) => [c.id, c.nome])} todos="Escolha…" />
                {erroDe('conta') && <p role="alert" className="text-sm text-negativo">{erroDe('conta')}</p>}
              </>
            )}
            {tipo === 'transfer' && (
              <>
                <Selecao rotulo="Para a conta" valor={destinoId} aoMudar={setDestinoId}
                  opcoes={contasAtivas.filter((c) => c.id !== contaId).map((c) => [c.id, c.nome])} todos="Escolha…" />
                {erroDe('destino') && <p role="alert" className="text-sm text-negativo">{erroDe('destino')}</p>}
              </>
            )}
          </>
        )}
        {precisaCategoria && (
          <>
            <Selecao rotulo="Categoria" valor={categoriaId} aoMudar={setCategoriaId} todos="Escolha…"
              opcoes={categoriasDoTipo.map((c) => [c.id, c.paiId ? `↳ ${c.nome}` : c.nome])} />
            {erroDe('categoria') && <p role="alert" className="text-sm text-negativo">{erroDe('categoria')}</p>}
          </>
        )}
        <p className="text-sm text-slate-600 md:col-span-2">
          {editando
            ? 'O novo valor vale para os planejados ainda não pagos de hoje em diante. O que já foi pago não muda.'
            : 'Dia 29, 30 ou 31 em mês mais curto cai no último dia do mês.'}
          {!editando && tipo === 'card' && cartoesComCiclo.length === 0 && ' Cadastre um cartão com fechamento e vencimento em Cartões antes.'}
        </p>
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando}>{r ? 'Salvar' : 'Cadastrar recorrente'}</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Card>
  )
}
