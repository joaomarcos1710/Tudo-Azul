import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { Field } from '../components/ui/Field'
import { Selecao } from '../components/ui/Selecao'
import { BANCOS_POR_NOME } from '../lib/bancos'
import { IconeConta } from '../components/ui/IconeConta'
import { useFamilia } from '../lib/FamiliaContext'
import { criarConta, definirAtiva, editarConta, excluirConta, hojeSP, listarContas, rotuloTipoConta } from '../lib/contas'
import type { Conta, TipoConta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { formatBRL, formatBRLCampo, formatDate, parseBRL } from '../lib/format'
import type { Cents } from '../lib/format'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'

export default function Contas() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [contas, setContas] = useState<Conta[] | null>(null)
  const [total, setTotal] = useState<Cents | null>(null)
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

  const ativas = contas?.filter((c) => c.ativa) ?? []
  const arquivadas = contas?.filter((c) => !c.ativa) ?? []

  if (!familia) return null
  return (
    <>
      <CabecalhoPagina titulo="Contas" descricao="Saldo de cada conta, calculado no banco."
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
          descricao="Cadastre as contas da família (corrente, poupança, dinheiro) com o saldo do dia em que você começar a usar o app."
          acao={<Button onClick={() => setEditando('nova')}>Cadastrar a primeira conta</Button>}
        />
      )}

      {contas && contas.length > 0 && (
        <>
          <Card className="mb-4">
            <p className="text-sm font-semibold text-slate-500">Saldo total hoje</p>
            <p className="tabular-nums text-3xl font-bold">{total !== null ? formatBRL(total) : '—'}</p>
            <p className="mt-1 text-xs text-slate-500">Inclui contas arquivadas: o dinheiro continua lá.</p>
          </Card>
          {excluindo && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4" role="group" aria-label="Excluir conta">
              <p className="text-sm">
                Excluir a conta <strong>{excluindo.nome}</strong> de vez. Só é possível se ela nunca teve lançamento, transferência,
                recorrente nem histórico legado de conferência; se tiver, o app avisa e você pode <strong>arquivar</strong> em vez de excluir. Não dá para desfazer.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variante="perigo" onClick={() => void confirmarExclusao(excluindo)}>Excluir conta</Button>
                <Button variante="secundario" onClick={() => setExcluindo(null)}>Cancelar</Button>
              </div>
            </div>
          )}
          <ul className="flex flex-col gap-3">
            {ativas.map((c) => (
              <li key={c.id}>
                <Card className={`flex flex-wrap items-center justify-between gap-3 ${c.ativa ? '' : 'opacity-70'}`}>
                  <div className="flex min-w-0 items-center gap-3">
                    <IconeConta nome={c.nome} tipo={c.tipo} banco={c.banco} />
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {c.nome}
                      </p>
                      <p className="text-sm text-slate-500">{rotuloTipoConta[c.tipo]} · desde {formatDate(c.abertura)}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`tabular-nums text-lg font-semibold ${c.saldo !== null && c.saldo < 0 ? 'text-negativo' : ''}`}>
                      {c.saldo === null ? `abre em ${formatDate(c.abertura)}` : formatBRL(c.saldo)}
                    </span>
                    <Button variante="fantasma" onClick={() => setEditando(c)}>Editar</Button>
                    <Button variante="fantasma" onClick={() => alternarAtiva(c)}>Arquivar</Button>
                    <Button variante="fantasma" onClick={() => setExcluindo(c)}>Excluir</Button>
                  </div>
                </Card>
              </li>
            ))}
          </ul>

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
                          <p className="font-semibold">{c.nome}</p>
                          <p className="text-sm text-slate-500">{rotuloTipoConta[c.tipo]} · desde {formatDate(c.abertura)}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`tabular-nums text-lg font-semibold ${c.saldo !== null && c.saldo < 0 ? 'text-negativo' : ''}`}>
                          {c.saldo === null ? `abre em ${formatDate(c.abertura)}` : formatBRL(c.saldo)}
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
      const dados = { nome, tipo, saldoInicial, abertura, ...((tipo !== 'cash' && banco) || conta?.banco ? { banco: tipo === 'cash' || !banco ? null : banco } : {}) }
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
            className="min-h-11 rounded-lg border border-slate-500 bg-white px-3 text-base"
          >
            {Object.entries(rotuloTipoConta).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </div>
        <Selecao rotulo="Banco" valor={tipo === 'cash' ? '' : banco} aoMudar={setBanco} desabilitado={tipo === 'cash'}
          todos={tipo === 'cash' ? 'Dinheiro não tem banco' : 'Automático (pelo nome da conta)'} opcoes={BANCOS_POR_NOME.map((b) => [b.chave, b.nome])} />
        <Field rotulo="Saldo inicial (R$)" inputMode="decimal" value={saldoTexto} onChange={(e) => setSaldoTexto(e.target.value)} erro={erroSaldo} />
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
