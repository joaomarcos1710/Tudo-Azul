import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { Selecao } from '../components/ui/Selecao'
import { BANCOS_POR_NOME, tipoSemBanco } from '../lib/bancos'
import { IconeConta } from '../components/ui/IconeConta'
import { EmOutrasMoedas } from '../components/ui/EmOutrasMoedas'
import { useFamilia } from '../lib/FamiliaContext'
import { ajudaTipoConta, criarConta, definirAtiva, editarConta, ehReais, ehTipoConta, excluirConta, GRUPOS_TIPO_CONTA, hojeSP, listarContas, MOEDAS_CONTA, outrasMoedas, rotuloDoTipo, rotuloTipoConta, TIPOS_CONTA } from '../lib/contas'
import type { Conta, TipoConta, TotalPorMoeda, TotalPorTipo } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { formatBRL, formatBRLCampo, formatDate, formatMoeda, parseBRL, simboloMoeda } from '../lib/format'
import type { Cents } from '../lib/format'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { corDoValor } from '../lib/cores'

/** Saldo na moeda da conta (BRL continua com formatBRL). */
function textoSaldo(c: Conta): string {
  return c.saldo === null ? `abre em ${formatDate(c.abertura)}` : formatMoeda(c.saldo, c.moeda ?? 'BRL')
}

/** Selo da moeda, só nas contas que não são em reais. */
function SeloMoeda({ conta }: { conta: Conta }) {
  if (ehReais(conta)) return null
  return (
    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 align-middle text-xs font-semibold text-slate-700"
      title={`Conta em ${conta.moeda}: o saldo fica fora do total em reais`}>
      {conta.moeda}
    </span>
  )
}

/** Título de cada grupo da lista (um por tipo, na ordem de TIPOS_CONTA). */
const TITULO_GRUPO: Record<TipoConta, string> = {
  checking: 'Contas correntes',
  savings: 'Poupança / reserva',
  brokerage: 'Corretora (saldo a aplicar)',
  fixed_income: 'Renda fixa',
  variable_income: 'Renda variável',
  crypto: 'Cripto',
  cash: 'Dinheiro (carteira)',
}

export default function Contas() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [contas, setContas] = useState<Conta[] | null>(null)
  const [total, setTotal] = useState<Cents | null>(null)
  const [porTipo, setPorTipo] = useState<TotalPorTipo[]>([])
  const [porMoeda, setPorMoeda] = useState<TotalPorMoeda[]>([])
  const [erro, setErro] = useState('')
  // null = formulário fechado; 'nova' = criando; Conta = editando
  const [editando, setEditando] = useState<Conta | 'nova' | null>(null)
  const [excluindo, setExcluindo] = useState<Conta | null>(null)

  const carregar = useCallback(async () => {
    if (!familiaId) return
    try {
      const r = await listarContas(familiaId)
      setContas(r.contas)
      setTotal(r.total)
      setPorTipo(r.porTipo ?? [])
      setPorMoeda(r.porMoeda ?? [])
      setErro('')
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }, [familiaId])

  useEffect(() => { void carregar() }, [carregar])

  async function alternarAtiva(c: Conta) {
    try {
      await definirAtiva(c.id, !c.ativa)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }

  async function confirmarExclusao(c: Conta) {
    try {
      await excluirConta(c.id)
      setExcluindo(null)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
      setExcluindo(null)
    }
  }

  // contas em reais agrupadas por tipo (o subtotal do banco só soma BRL); as de outra moeda ficam num grupo à parte
  const ativas = contas?.filter((c) => c.ativa && ehReais(c)) ?? []
  const ativasOutras = contas?.filter((c) => c.ativa && !ehReais(c)) ?? []
  const arquivadas = contas?.filter((c) => !c.ativa) ?? []
  const outras = outrasMoedas(porMoeda)
  // agrupadas pelos 7 tipos (onde o dinheiro está), na ordem de TIPOS_CONTA; o subtotal vem do banco
  const grupos: { chave: string; titulo: string; contas: Conta[]; subtotal: string | null }[] = TIPOS_CONTA
    .map((tipo) => {
      const sub = porTipo.find((t) => t.tipo === tipo)?.totalAtivas
      return { chave: tipo, titulo: TITULO_GRUPO[tipo], contas: ativas.filter((c) => c.tipo === tipo), subtotal: sub === undefined ? null : formatBRL(sub) }
    })
    .filter((g) => g.contas.length > 0)
  // tipo de antes da 070 (front no ar antes da migration): a conta não some; fica num grupo próprio, sem subtotal
  const tipoAntigo = ativas.filter((c) => !ehTipoConta(c.tipo))
  if (tipoAntigo.length > 0) grupos.push({ chave: 'tipo-antigo', titulo: 'Tipo a revisar', contas: tipoAntigo, subtotal: null })
  // subtotal por moeda (do banco, sem conversão), nunca somando moedas diferentes
  if (ativasOutras.length > 0) {
    grupos.push({ chave: 'outras-moedas', titulo: 'Contas em outras moedas', contas: ativasOutras,
      subtotal: outras.length > 0 ? outras.map((m) => formatMoeda(m.totalAtivas, m.moeda)).join(' · ') : null })
  }

  if (!familia) return null
  return (
    <>
      <CabecalhoPagina titulo="Contas" descricao="Saldo de cada conta, vindo do banco."
        acoes={editando === null && <Button onClick={() => setEditando('nova')}>Nova conta</Button>} />

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}

      {editando !== null && (
        <FormConta
          conta={editando === 'nova' ? null : editando}
          familiaId={familia.id}
          aoSalvar={async () => { setEditando(null); await carregar() }}
          aoCancelar={() => setEditando(null)}
        />
      )}

      {contas === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}

      {contas?.length === 0 && editando === null && (
        <EmptyState
          titulo="Nenhuma conta ainda"
          descricao="Cadastre as contas da família (corrente, reserva, corretora, investimentos, dinheiro) com o saldo do dia em que você começar a usar o app."
          acao={<Button onClick={() => setEditando('nova')}>Cadastrar a primeira conta</Button>}
        />
      )}

      {contas && contas.length > 0 && (
        <>
          <Card className="mb-4">
            <p className="text-sm font-semibold text-slate-500">{outras.length > 0 ? 'Saldo total em reais hoje' : 'Saldo total hoje'}</p>
            <p className="tabular-nums text-3xl font-bold">{total !== null ? formatBRL(total) : '—'}</p>
            <p className="mt-1 text-xs text-slate-500">Inclui contas arquivadas: o dinheiro continua lá.</p>
            <EmOutrasMoedas porMoeda={porMoeda} className="mt-3 border-t border-slate-200 pt-3" />
          </Card>
          {excluindo && (
            <div className="mb-4 rounded-lg border border-negativo-borda bg-negativo-fundo p-4" role="group" aria-label="Excluir conta">
              <p className="text-sm">
                Excluir a conta <strong>{excluindo.nome}</strong> de vez. Só é possível se ela nunca teve lançamento, transferência
                nem recorrente; se tiver, o app avisa e você pode <strong>arquivar</strong> em vez de excluir. Não dá para desfazer.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variante="perigo" onClick={() => void confirmarExclusao(excluindo)}>Excluir conta</Button>
                <Button variante="secundario" onClick={() => setExcluindo(null)}>Cancelar</Button>
              </div>
            </div>
          )}
          {grupos.map((g) => (
            <section key={g.chave} className="mb-6" aria-labelledby={`titulo-contas-${g.chave}`}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 id={`titulo-contas-${g.chave}`} className="text-lg font-semibold">{g.titulo}</h2>
                {g.subtotal !== null && <span className="tabular-nums text-sm font-semibold text-slate-600">{g.subtotal}</span>}
              </div>
              <ul className="flex flex-col gap-3">
                {g.contas.map((c) => (
                  <li key={c.id}>
                    <Card className={`flex flex-wrap items-center justify-between gap-3 ${c.ativa ? '' : 'opacity-70'}`}>
                      <div className="flex min-w-0 items-center gap-3">
                        <IconeConta nome={c.nome} tipo={c.tipo} banco={c.banco} />
                        <div className="min-w-0">
                          <p className="font-semibold">
                            {c.nome}<SeloMoeda conta={c} />
                          </p>
                          <p className="text-sm text-slate-500">{rotuloDoTipo(c.tipo)} · desde {formatDate(c.abertura)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`tabular-nums text-lg font-semibold ${c.saldo === null ? '' : corDoValor(c.saldo)}`}>
                          {textoSaldo(c)}
                        </span>
                        <Button variante="fantasma" onClick={() => setEditando(c)}>Editar</Button>
                        <Button variante="fantasma" onClick={() => alternarAtiva(c)}>Arquivar</Button>
                        <Button variante="fantasma" onClick={() => setExcluindo(c)}>Excluir</Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {arquivadas.length > 0 && (
            <section className="mt-8" aria-labelledby="titulo-contas-arquivadas">
              <h2 id="titulo-contas-arquivadas" className="mb-1 text-lg font-semibold">Arquivadas</h2>
              <p className="mb-3 text-sm text-slate-600">Não aparecem nas escolhas de lançamento. O saldo e o histórico continuam valendo.</p>
              <ul className="flex flex-col gap-2">
                {arquivadas.map((c) => (
                  <li key={c.id}>
                    <Card className="flex flex-wrap items-center justify-between gap-3 opacity-80">
                      <div className="flex min-w-0 items-center gap-3">
                        <IconeConta nome={c.nome} tipo={c.tipo} banco={c.banco} />
                        <div className="min-w-0">
                          <p className="font-semibold">{c.nome}<SeloMoeda conta={c} /></p>
                          <p className="text-sm text-slate-500">{rotuloDoTipo(c.tipo)} · desde {formatDate(c.abertura)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`tabular-nums text-lg font-semibold ${c.saldo === null ? '' : corDoValor(c.saldo)}`}>
                          {textoSaldo(c)}
                        </span>
                        <Button variante="secundario" onClick={() => alternarAtiva(c)}>Reativar</Button>
                      </div>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  )
}

interface PropsForm {
  conta: Conta | null
  familiaId: string
  aoSalvar: () => Promise<void>
  aoCancelar: () => void
}

function FormConta({ conta, familiaId, aoSalvar, aoCancelar }: PropsForm) {
  const [nome, setNome] = useState(conta?.nome ?? '')
  const [tipo, setTipo] = useState<TipoConta>(conta?.tipo ?? 'checking')
  const [saldoTexto, setSaldoTexto] = useState(conta ? formatBRLCampo(conta.saldoInicial) : '0,00')
  const [abertura, setAbertura] = useState(conta?.abertura ?? hojeSP())
  const [banco, setBanco] = useState(conta?.banco ?? '')
  // a moeda só se escolhe na criação; na edição fica travada (o banco também recusa trocar com movimento)
  const [moeda, setMoeda] = useState(conta?.moeda ?? 'BRL')
  const simbolo = simboloMoeda(moeda)
  const [tentou, setTentou] = useState(false)
  const [erro, setErro] = useState('')
  const [enviando, setEnviando] = useState(false)

  const saldoInicial = parseBRL(saldoTexto)
  const erroNome = tentou && !nome.trim() ? 'Informe o nome da conta.' : undefined
  const erroSaldo = tentou && saldoInicial === null ? 'Valor inválido. Exemplo: 1.250,50 ou -300,00.' : undefined
  const erroData = tentou && !abertura ? 'Informe a data.' : undefined

  async function salvar(e: FormEvent) {
    e.preventDefault()
    setTentou(true)
    if (!nome.trim() || saldoInicial === null || !abertura) return
    setErro('')
    setEnviando(true)
    try {
      // só envia o banco quando há o que gravar ou limpar (conta sem banco e sem escolha não toca na coluna)
      const dados = { nome, tipo, saldoInicial, abertura, ...((!tipoSemBanco(tipo) && banco) || conta?.banco ? { banco: tipoSemBanco(tipo) || !banco ? null : banco } : {}),
        ...(conta || moeda === 'BRL' ? {} : { moeda }) }
      if (conta) await editarConta(conta.id, dados)
      else await criarConta(familiaId, dados)
      await aoSalvar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-lg font-semibold">{conta ? `Editar ${conta.nome}` : 'Nova conta'}</h2>
      <form onSubmit={salvar} className="grid gap-4 md:grid-cols-2" noValidate>
        {erro && <div className="md:col-span-2"><Aviso tipo="erro">{erro}</Aviso></div>}
        <Field rotulo="Nome" maxLength={60} placeholder="Ex.: Itaú João" value={nome} onChange={(e) => setNome(e.target.value)} erro={erroNome} />
        <div className="flex flex-col gap-1">
          <label htmlFor="tipo-conta" className="text-sm font-medium">Tipo</label>
          <select
            id="tipo-conta"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoConta)}
            aria-describedby="tipo-conta-ajuda"
            className="min-h-11 rounded-lg border border-slate-500 bg-white px-3 text-base"
          >
            {/* conta de tipo antigo (antes da 070): mostra o atual em vez de trocar sem avisar */}
            {!ehTipoConta(tipo) && <option value={tipo}>{rotuloDoTipo(tipo)}</option>}
            {GRUPOS_TIPO_CONTA.map((g) => (
              <optgroup key={g.rotulo} label={g.rotulo}>
                {g.tipos.map((t) => <option key={t} value={t}>{rotuloTipoConta[t]}</option>)}
              </optgroup>
            ))}
          </select>
          <p id="tipo-conta-ajuda" className="text-xs text-slate-600">
            {ehTipoConta(tipo) ? ajudaTipoConta[tipo] : 'Tipo antigo: escolha onde o dinheiro está.'}
          </p>
        </div>
        <Selecao rotulo="Banco" valor={tipoSemBanco(tipo) ? '' : banco} aoMudar={setBanco} desabilitado={tipoSemBanco(tipo)}
          todos={tipoSemBanco(tipo) ? 'Dinheiro não tem banco' : 'Automático (pelo nome da conta)'} opcoes={BANCOS_POR_NOME.map((b) => [b.chave, b.nome])} />
        <div className="flex flex-col gap-1">
          <label htmlFor="moeda-conta" className="text-sm font-medium">Moeda</label>
          <select
            id="moeda-conta"
            value={moeda}
            onChange={(e) => setMoeda(e.target.value)}
            disabled={conta !== null}
            aria-describedby="moeda-conta-ajuda"
            className="min-h-11 rounded-lg border border-slate-500 bg-white px-3 text-base disabled:bg-slate-100"
          >
            {MOEDAS_CONTA.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
          <p id="moeda-conta-ajuda" className="text-xs text-slate-600">
            {conta
              ? 'A moeda não muda depois de criada.'
              : moeda === 'BRL'
                ? 'O saldo entra no total em reais.'
                : 'O saldo fica separado, na moeda da conta, fora do total em reais. Aceita receita, despesa e transferência com outra conta da mesma moeda; cartão, dívida e provento seguem só em reais.'}
          </p>
        </div>
        <Field rotulo={`Saldo inicial (${simbolo})`} inputMode="decimal" value={saldoTexto} onChange={(e) => setSaldoTexto(e.target.value)} erro={erroSaldo} />
        <Field rotulo="Data do saldo inicial" type="date" value={abertura} onChange={(e) => setAbertura(e.target.value)} erro={erroData} />
        <p className="text-sm text-slate-600 md:col-span-2">
          O saldo inicial é o valor <strong>no início do dia</strong> escolhido. Lançamentos a partir dessa data mudam o saldo; lançamentos anteriores entram nos relatórios, mas não no saldo.
        </p>
        <div className="flex gap-2 md:col-span-2">
          <Button type="submit" carregando={enviando}>{conta ? 'Salvar' : 'Cadastrar conta'}</Button>
          <Button variante="secundario" onClick={aoCancelar}>Cancelar</Button>
        </div>
      </form>
    </Card>
  )
}
