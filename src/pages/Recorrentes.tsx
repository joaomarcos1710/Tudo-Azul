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
import { listarCategorias, nomesCompletos, opcoesDeCategoria } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import { hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { formatBRL, formatBRLCampo, formatDate, parseBRL } from '../lib/format'
import {
  criarRecorrencia, diaDaSemana, editarRecorrencia, excluirRecorrencia, frequencias, listarRecorrencias, MAX_CADA,
  proximasOcorrencias, rotuloFrequencia, rotuloTipoRecorrencia,
} from '../lib/recorrencias'
import type { Recorrencia, TipoRecorrencia, UnidadeFrequencia } from '../lib/recorrencias'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'

const dias: [string, string][] = Array.from({ length: 31 }, (_, i) => [String(i + 1), `Dia ${i + 1}`])
const toda = (diaSemana: string) => `${diaSemana === 'sábado' || diaSemana === 'domingo' ? 'todo' : 'toda'} ${diaSemana}`

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
  const nomeCategoria = useMemo(() => nomesCompletos(categorias), [categorias])

  async function excluir(r: Recorrencia) {
    if (!window.confirm(`Excluir "${r.descricao}"? Os próximos planejados vão para a lixeira; o que já foi pago ou lançado no cartão continua no histórico.`)) return
    try {
      await excluirRecorrencia(r.id)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }

  if (!familiaId) return null
  const ativas = recorrencias?.filter((r) => r.ativa) ?? []

  const proxima = (r: Recorrencia) => proximasOcorrencias(r, hojeSP(), 1)[0] ?? null

  function onde(r: Recorrencia) {
    if (r.tipo === 'card') return `Cartão ${nomeCartao.get(r.cartaoId ?? '') ?? '?'}`
    if (r.tipo === 'transfer') return `${nomeConta.get(r.contaId ?? '') ?? '?'} → ${nomeConta.get(r.destinoId ?? '') ?? '?'}`
    return nomeConta.get(r.contaId ?? '') ?? '?'
  }

  return (
    <>
      <CabecalhoPagina titulo="Recorrentes"
        acoes={editando === null && <Button onClick={() => setEditando('nova')}>Novo recorrente</Button>}
        descricao={<>
          Contas, salários e assinaturas que se repetem: toda semana, a cada 14 dias, todo mês, a cada 2, 3 ou 6 meses ou todo ano.
          Em conta, os próximos 12 meses aparecem como <strong>Planejado</strong> (ou, se você informar a data final, todas as parcelas até ela) em{' '}
          <Link to="/lancamentos" className="font-semibold text-azul hover:underline">Lançamentos</Link>: quando a conta chegar,
          corrija o valor e marque como pago. No cartão, a compra entra no dia, na fatura certa.
        </>} />

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

      {recorrencias !== null && ativas.length === 0 && editando === null && (
        <EmptyState
          titulo="Nenhum recorrente ainda"
          descricao="Cadastre aluguel, luz, salário, PLR, condomínio e assinaturas (Netflix, Spotify) uma vez só: o app lança nas datas certas."
          acao={<Button onClick={() => setEditando('nova')}>Cadastrar o primeiro</Button>}
        />
      )}

      {ativas.length > 0 && (
        <Card semPadding>
          <ul className="divide-y divide-slate-100">
            {ativas.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.descricao}</p>
                  <p className="text-sm text-slate-500">
                    {rotuloFrequencia(r)} · {onde(r)}{r.categoriaId && <> · {nomeCategoria.get(r.categoriaId) ?? 'Sem categoria'}</>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {rotuloTipoRecorrencia[r.tipo]} · desde {formatDate(r.inicio)}
                    {proxima(r) && <> · próxima {formatDate(proxima(r)!)}</>}
                    {r.fim && <> · até {formatDate(r.fim)}</>}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className={`tabular-nums font-semibold ${r.tipo === 'income' ? 'text-positivo' : r.tipo === 'transfer' ? 'text-slate-600' : 'text-negativo'}`}>
                    {r.tipo === 'income' ? '+' : r.tipo === 'transfer' ? '⇄ ' : '−'}{formatBRL(r.valor)}
                  </span>
                  <Button variante="fantasma" onClick={() => setEditando(r)} disabled={editando !== null}>Editar</Button>
                  <Button variante="discreto" onClick={() => excluir(r)}>Excluir</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
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
  const [dia, setDia] = useState(r?.dia ? String(r.dia) : '')
  const [inicio, setInicio] = useState(r?.inicio ?? hojeSP())
  const [fim, setFim] = useState(r?.fim ?? '')
  // frequência: uma das opções prontas ou "personalizada" (a cada N semanas/meses)
  const [freq, setFreq] = useState(r ? (frequencias.find((f) => f.unidade === r.unidade && f.cada === r.cada)?.chave ?? 'personalizada') : 'mensal')
  const [unidadeP, setUnidadeP] = useState<UnidadeFrequencia>(r?.unidade ?? 'month')
  const [cadaP, setCadaP] = useState(r ? String(r.cada) : '2')
  const [contaId, setContaId] = useState(r?.contaId ?? contasAtivas[0]?.id ?? '')
  const [destinoId, setDestinoId] = useState(r?.destinoId ?? '')
  const [cartaoId, setCartaoId] = useState(r?.cartaoId ?? cartoesComCiclo[0]?.id ?? '')
  const [categoriaId, setCategoriaId] = useState(r?.categoriaId ?? '')
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  const valor = parseBRL(valorTexto)
  const pronta = frequencias.find((f) => f.chave === freq)
  const unidade: UnidadeFrequencia = pronta ? pronta.unidade : unidadeP
  const cada = pronta ? pronta.cada : Number(cadaP)
  const cadaValido = Number.isInteger(cada) && cada >= 1 && cada <= MAX_CADA[unidade]
  const hoje = hojeSP()
  // prévia (mesma regra do banco); frequência nova com início no passado começa no dia do cadastro (migration 016)
  const previa = !editando && cadaValido && inicio && (unidade === 'week' || dia)
    ? proximasOcorrencias({ unidade, cada, dia: unidade === 'week' ? null : Number(dia), inicio, fim: fim || null }, hoje, 3)
    : []
  const mensal = unidade === 'month' && cada === 1
  const tipoCategoria = tipo === 'income' ? 'income' : 'expense'
  const categoriasDoTipo = categorias.filter((c) => c.tipo === tipoCategoria && (c.ativa || c.id === r?.categoriaId))
  const precisaCategoria = tipo !== 'transfer'

  const problemas = {
    descricao: !descricao.trim() ? 'Informe a descrição.' : undefined,
    valor: valor === null || valor <= 0 ? 'Valor inválido. Exemplo: 180,00' : undefined,
    dia: !editando && unidade === 'month' && !dia ? 'Escolha o dia do mês.' : undefined,
    cada: !editando && !cadaValido ? `Use de 1 a ${MAX_CADA[unidade]} ${unidade === 'week' ? 'semanas' : 'meses'}.` : undefined,
    inicio: !editando && !inicio ? 'Informe a data.' : undefined,
    fim: !editando && fim && inicio && fim < inicio ? 'A data final não pode ser antes do início.' : undefined,
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
          tipo, descricao, valor, dia: unidade === 'week' ? null : Number(dia), inicio, fim: fim || null, unidade, cada,
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
            <Selecao rotulo="Frequência" valor={freq} aoMudar={setFreq}
              opcoes={[...frequencias.map((f): [string, string] => [f.chave, f.rotulo]), ['personalizada', 'Personalizada…']]} />
            {freq === 'personalizada' && (
              <div className="grid grid-cols-2 gap-2">
                <Field rotulo="A cada" type="number" inputMode="numeric" min={1} max={MAX_CADA[unidadeP]} value={cadaP}
                  onChange={(e) => setCadaP(e.target.value)} erro={erroDe('cada')} />
                <Selecao rotulo="Unidade" valor={unidadeP} aoMudar={(v) => setUnidadeP(v as UnidadeFrequencia)}
                  opcoes={[['month', 'meses'], ['week', 'semanas']]} />
              </div>
            )}
            {unidade === 'month' && (
              <>
                <Selecao rotulo="Dia do mês" valor={dia} aoMudar={setDia} opcoes={dias} todos="Escolha…" />
                {erroDe('dia') && <p role="alert" className="text-sm text-negativo">{erroDe('dia')}</p>}
              </>
            )}
            <Field rotulo={unidade === 'week' ? 'Primeira vez em' : 'A partir de'} type="date" value={inicio}
              onChange={(e) => setInicio(e.target.value)} erro={erroDe('inicio')} />
            <Field rotulo="Até (opcional)" type="date" value={fim} onChange={(e) => setFim(e.target.value)} erro={erroDe('fim')} />
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
              opcoes={opcoesDeCategoria(categoriasDoTipo, categorias).map((o) => [o.id, o.rotulo])} />
            {erroDe('categoria') && <p role="alert" className="text-sm text-negativo">{erroDe('categoria')}</p>}
          </>
        )}
        <p className="text-sm text-slate-600 md:col-span-2">
          {editando
            ? `${rotuloFrequencia(r!)}. Valor e descrição valem para os planejados ainda não pagos de hoje em diante. A categoria vale para todos os meses, inclusive os já pagos e os passados. Em qualquer caso, o que você corrigiu à mão em um mês fica como está. Para mudar a frequência ou o dia, exclua este recorrente e cadastre outro.`
            : unidade === 'week'
              ? `Repete ${inicio ? toda(diaDaSemana(inicio)) : 'no mesmo dia da semana da primeira data'}, a cada ${7 * (cadaValido ? cada : 1)} dias.`
              : 'Dia 29, 30 ou 31 em mês mais curto cai no último dia do mês.'}
          {!editando && inicio && inicio < hoje && (mensal
            ? ' Os meses desde o início que já passaram também entram, como planejados atrasados.'
            : ' Datas antes de hoje não são criadas.')}
          {!editando && tipo === 'card' && cartoesComCiclo.length === 0 && ' Cadastre um cartão com fechamento e vencimento em Cartões antes.'}
        </p>
        {previa.length > 0 && (
          <p className="text-sm text-marinho md:col-span-2" aria-live="polite">
            <strong>Próximas datas:</strong> {previa.map(formatDate).join(' · ')}
          </p>
        )}
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando}>{r ? 'Salvar' : 'Cadastrar recorrente'}</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Card>
  )
}
