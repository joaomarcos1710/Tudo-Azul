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
  criarCartao, definirCiclo, editarParcela, excluirCompra, listarCartoes, listarFaturas, listarItens,
  novaChave, pagarFatura, previaExclusao, reabrirFatura, registrarCompra, situacaoFatura,
} from '../lib/cartoes'
import type { Cartao, Fatura, ItemFatura, ItemPrevia } from '../lib/cartoes'
import { listarCategorias } from '../lib/categorias'
import { atualizarAutomaticos } from '../lib/automaticos'
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
  const [aviso, setAviso] = useState('')
  const [painel, setPainel] = useState<Painel | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)
  // muda a cada gravação para as faturas abertas recarregarem
  const [versao, setVersao] = useState(0)

  const carregar = useCallback(async () => {
    if (!familiaId) return
    try {
      // gera as assinaturas de hoje e cobra o que já fechou antes de mostrar: os valores ficam em dia.
      // Se falhar, mostra o que há com um aviso (não esconde os cartões nem engole o erro).
      const r = await atualizarAutomaticos()
      setAviso(
        !r.faturasOk ? 'Não foi possível fechar as faturas agora; os valores podem estar defasados. Tente de novo em instantes.'
        : !r.recorrentesOk ? 'Não foi possível lançar as assinaturas de hoje agora; tente de novo em instantes.'
        : '',
      )
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
      {aviso && !erro && <div className="mb-4"><Aviso tipo="erro">{aviso}</Aviso></div>}

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
                <Button variante="secundario" onClick={() => setPainel({ tipo: 'pagar', cartao: c })} disabled={c.fechamento === null || painel !== null}
                  aria-describedby={c.divida <= 0 && c.fechamento !== null ? `sem-fatura-${c.id}` : undefined}>Pagar fatura</Button>
                <Button variante="fantasma" onClick={() => setAberto(aberto === c.id ? null : c.id)} aria-expanded={aberto === c.id}>
                  {aberto === c.id ? 'Ocultar faturas' : 'Ver faturas'}
                </Button>
                <Button variante="fantasma" onClick={() => setPainel({ tipo: 'ciclo', cartao: c })} disabled={painel !== null}>
                  {c.fechamento === null ? 'Definir fechamento' : 'Alterar dias'}
                </Button>
              </div>
              {c.divida <= 0 && c.fechamento !== null && (
                <p id={`sem-fatura-${c.id}`} className="mt-3 text-sm text-slate-600">
                  {c.compromissos > 0
                    ? <>Não há fatura fechada. Você tem {formatBRL(c.compromissos)} em parcelas futuras: cada uma entra na fatura que fecha no dia {c.fechamento} do seu mês. Se pagar agora, o valor <strong>vira crédito no cartão</strong> e abate as próximas faturas.</>
                    : <>Não há fatura fechada. Se pagar agora, o valor <strong>vira crédito no cartão</strong> e abate as próximas faturas.</>}
                </p>
              )}
              {aberto === c.id && <Faturas cartaoId={c.id} versao={versao} categorias={categorias} contas={contas} aoAlterar={carregar} />}
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

type Acao =
  | { tipo: 'reabrir'; fatura: Fatura }
  | { tipo: 'editar'; item: ItemFatura }
  | { tipo: 'excluir'; item: ItemFatura }

function Faturas({ cartaoId, versao, categorias, contas, aoAlterar }: {
  cartaoId: string; versao: number; categorias: Categoria[]; contas: Conta[]; aoAlterar: () => Promise<void>
}) {
  const [acao, setAcao] = useState<Acao | null>(null)
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
            {f.saldoAnterior > 0 && <p className="text-xs text-negativo">Saldo anterior (faltou pagar antes): {formatBRL(f.saldoAnterior)}</p>}
            {f.adiantamentoEntrada > 0 && <p className="text-xs text-positivo">Adiantamento usado nesta fatura: até {formatBRL(f.adiantamentoEntrada)}</p>}
            {f.adiantamentoSaida > 0 && <p className="text-xs text-positivo">Sobra de adiantamento para as próximas: {formatBRL(f.adiantamentoSaida)}</p>}
            {f.pago > 0 && f.faturaId && !acao && (
              <div className="mt-2">
                <Button variante="fantasma" onClick={() => setAcao({ tipo: 'reabrir', fatura: f })}>Reabrir fatura</Button>
              </div>
            )}
            {acao?.tipo === 'reabrir' && acao.fatura.mes === f.mes && (
              <PainelReabrir cartaoId={cartaoId} fatura={f} aoFechar={() => setAcao(null)} aoConcluir={async () => { setAcao(null); await aoAlterar() }} />
            )}
            {acao?.tipo === 'editar' && (
              <PainelEditar item={acao.item} aoFechar={() => setAcao(null)} aoConcluir={async () => { setAcao(null); await aoAlterar() }} />
            )}
            {acao?.tipo === 'excluir' && (
              <PainelExcluir cartaoId={cartaoId} item={acao.item} contas={contas} aoFechar={() => setAcao(null)}
                aoConcluir={async () => { setAcao(null); setMes(null); await aoAlterar() }} />
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
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="tabular-nums font-semibold text-negativo">−{formatBRL(i.valor)}</span>
                      <Button variante="fantasma" className="px-2" disabled={acao !== null} aria-label={`Editar valor de ${i.descricao}`}
                        onClick={() => setAcao({ tipo: 'editar', item: i })}>Editar</Button>
                      <Button variante="fantasma" className="px-2" disabled={acao !== null} aria-label={`Excluir compra ${i.descricao}`}
                        onClick={() => setAcao({ tipo: 'excluir', item: i })}>Excluir</Button>
                    </div>
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
  const [chave] = useState(novaChave)
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
    void enviar(() => registrarCompra(cartao.id, { descricao, data: andamento ? hoje : data, total, parcelas, categoriaId }, chave))
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
  // com fatura fechada, sugere a dívida; sem fatura, é pagamento adiantado e o valor fica por conta do dono
  const [valorTexto, setValorTexto] = useState(cartao.divida > 0 ? formatBRL(cartao.divida).replace('R$ ', '') : '')
  const [data, setData] = useState(hojeSP())
  const [fatura, setFatura] = useState<Fatura | null>(null)
  const [tentou, setTentou] = useState(false)
  const [chave] = useState(novaChave)
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
    // só liga a uma fatura quando há dívida fechada; sem ela, é adiantamento (vira crédito no cartão)
    void enviar(() => pagarFatura(cartao.id, { contaId, data, valor, faturaId: cartao.divida > 0 ? fatura?.faturaId ?? null : null }, chave))
  }

  // comparações entre valores exatos em centavos; o banco é quem decide e recalcula o crédito
  const adiantado = valor !== null && valor > 0 && valor > cartao.divida
  // o crédito que o cartão já tem também cobre parcelas futuras: só avisa quando passa de (dívida + parcelas futuras − crédito)
  const maisQueTudo = valor !== null && valor > cartao.divida + cartao.compromissos - cartao.credito

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">Pagar fatura · {cartao.nome}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Selecao rotulo="Pagar com a conta" valor={contaId} aoMudar={setContaId} opcoes={ativas.map((c) => [c.id, c.nome])} todos="Escolha…" />
        <Field rotulo="Valor (R$)" inputMode="decimal" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} erro={erroValor} />
        <Field rotulo="Data do pagamento" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        <p className="text-sm text-slate-600 md:col-span-2">
          {cartao.divida > 0 && fatura ? <>Quita a fatura de <strong className="capitalize">{formatMonth(fatura.mes)}</strong>. </> : null}
          {adiantado && cartao.divida > 0 && <>O que passar da fatura fechada ({formatBRL(cartao.divida)}) <strong>fica como crédito no cartão</strong> e abate as próximas faturas. </>}
          {adiantado && cartao.divida <= 0 && <>Não há fatura fechada: o valor <strong>fica como crédito no cartão</strong> e abate as próximas faturas. </>}
          O pagamento sai da conta na data escolhida e reduz a dívida do cartão. Não é despesa: as compras contam no mês de cada fatura.
        </p>
        {maisQueTudo && (
          <div className="md:col-span-2">
            <Aviso tipo="info">É mais do que tudo o que este cartão tem a pagar hoje (fatura fechada e parcelas futuras). Confira o valor antes de registrar.</Aviso>
          </div>
        )}
        <Botoes rotulo="Registrar pagamento" enviando={enviando} aoCancelar={aoCancelar} />
      </form>
    </Card>
  )
}

function PainelReabrir({ cartaoId, fatura, aoFechar, aoConcluir }: {
  cartaoId: string; fatura: Fatura; aoFechar: () => void; aoConcluir: () => Promise<void>
}) {
  const { erro, enviando, enviar } = useEnvio(aoConcluir)
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-azul-claro p-4" role="group" aria-label="Reabrir fatura">
      {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}
      <p className="text-sm">
        Reabrir a fatura de <strong className="capitalize">{formatMonth(fatura.mes)}</strong> desfaz os pagamentos dela
        ({formatBRL(fatura.pago)}), <strong>inclusive a parte que passou da fatura e ficou como crédito</strong>, e o dinheiro volta para as contas de onde saiu. Depois você pode editar as parcelas e pagar de novo.
      </p>
      <div className="mt-3 flex gap-2">
        <Button variante="perigo" carregando={enviando} onClick={() => void enviar(async () => { await reabrirFatura(cartaoId, fatura.mes) })}>
          Reabrir fatura
        </Button>
        <Button variante="secundario" onClick={aoFechar}>Cancelar</Button>
      </div>
    </div>
  )
}

function PainelEditar({ item, aoFechar, aoConcluir }: { item: ItemFatura; aoFechar: () => void; aoConcluir: () => Promise<void> }) {
  const [valorTexto, setValorTexto] = useState(formatBRL(item.valor).replace('R$ ', '').replace(/\u00a0/g, ''))
  const [tentou, setTentou] = useState(false)
  const { erro, enviando, enviar } = useEnvio(aoConcluir)
  const valor = parseBRL(valorTexto)
  const erroValor = tentou && (valor === null || valor <= 0) ? 'Valor inválido. Exemplo: 100,01' : undefined

  function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (valor === null || valor <= 0) return
    void enviar(() => editarParcela(item.parcelaId, valor))
  }

  return (
    <form onSubmit={salvar} noValidate className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-azul-claro p-4 md:grid-cols-2"
      aria-label="Editar parcela">
      {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
      <p className="text-sm md:col-span-2">
        Corrigir o valor desta parcela: <strong>{item.descricao}{item.deParcelas > 1 && ` ${item.parcela}/${item.deParcelas}`}</strong>.
        As outras parcelas não mudam. Em fatura já paga, reabra a fatura antes.
      </p>
      <Field rotulo="Valor da parcela (R$)" inputMode="decimal" value={valorTexto} onChange={(e) => setValorTexto(e.target.value)} erro={erroValor} />
      <Botoes rotulo="Salvar valor" enviando={enviando} aoCancelar={aoFechar} />
    </form>
  )
}

const rotuloPrevia: Record<string, string> = {
  charge: 'Cobrança na fatura será anulada',
  credit: 'Estorno será anulado',
  payment: 'Pagamento será desfeito',
  extra_principal: 'Pagamento extra será desfeito',
  cancel: 'Parcelas ainda não cobradas serão canceladas',
}

function PainelExcluir({ cartaoId, item, contas, aoFechar, aoConcluir }: {
  cartaoId: string; item: ItemFatura; contas: Conta[]; aoFechar: () => void; aoConcluir: () => Promise<void>
}) {
  const [previa, setPrevia] = useState<ItemPrevia[] | null>(null)
  const [erroPrevia, setErroPrevia] = useState('')
  const { erro, enviando, enviar } = useEnvio(aoConcluir)
  const nomeConta = new Map(contas.map((c) => [c.id, c.nome]))

  useEffect(() => {
    previaExclusao(cartaoId, item.compra).then(setPrevia).catch((err) => setErroPrevia(mensagemErroBanco(err)))
  }, [cartaoId, item.compra])

  return (
    <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4" role="group" aria-label="Excluir compra">
      {(erro || erroPrevia) && <div className="mb-3"><Aviso tipo="erro">{erro || erroPrevia}</Aviso></div>}
      <p className="text-sm">
        Excluir a compra <strong>{item.descricao}</strong> inteira (todas as parcelas). Isto será desfeito:
      </p>
      {previa === null && !erroPrevia && <p className="mt-2 text-sm text-slate-600" role="status">Calculando…</p>}
      {previa && (
        <ul className="mt-2 list-disc pl-5 text-sm">
          {previa.map((p, k) => (
            <li key={k}>
              {rotuloPrevia[p.tipo] ?? p.tipo}: <span className="tabular-nums font-semibold">{formatBRL(p.valor)}</span>
              {p.fatura && <> (fatura {formatMonth(p.fatura)})</>}
              {(p.tipo === 'payment' || p.tipo === 'extra_principal') && p.contaId && (
                <> — o dinheiro volta para <strong>{nomeConta.get(p.contaId) ?? 'a conta'}</strong></>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-600">Nada é recriado depois. O histórico fica guardado para auditoria.</p>
      <div className="mt-3 flex gap-2">
        <Button variante="perigo" carregando={enviando} disabled={previa === null}
          onClick={() => void enviar(() => excluirCompra(cartaoId, item.compra))}>Excluir compra</Button>
        <Button variante="secundario" onClick={aoFechar}>Cancelar</Button>
      </div>
    </div>
  )
}
