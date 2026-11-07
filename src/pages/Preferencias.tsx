import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { useAuth } from '../lib/auth'
import { useFamilia } from '../lib/FamiliaContext'
import { supabase } from '../lib/supabase'

type PreferenciasDados = { ordem_lancamentos: 'asc' | 'desc'; periodo_padrao: 'daily' | 'weekly' | 'monthly'; saldo_diario: boolean }
const padrao: PreferenciasDados = { ordem_lancamentos: 'desc', periodo_padrao: 'monthly', saldo_diario: true }
const FRASE_EXCLUIR = 'excluir transações'

function Opcao({ titulo, descricao, children }: { titulo: string; descricao: string; children: ReactNode }) {
  return <section className="grid gap-4 border-b border-slate-100 py-5 last:border-0 md:grid-cols-[minmax(0,1fr)_13rem] md:items-center">
    <div><h3 className="font-semibold text-marinho">{titulo}</h3><p className="mt-1 text-sm text-slate-500">{descricao}</p></div>
    <div className="flex flex-col gap-2">{children}</div>
  </section>
}
function Escolha({ nome, valor, selecionado, aoMudar }: { nome: string; valor: string; selecionado: boolean; aoMudar: () => void }) {
  return <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-slate-700 hover:bg-slate-50 focus-within:ring-2 focus-within:ring-azul">
    <input type="radio" name={nome} value={valor} checked={selecionado} onChange={aoMudar} className="h-4 w-4 accent-azul" />{valor}
  </label>
}
export default function Preferencias() {
  const { sessao } = useAuth()
  const { familia } = useFamilia()
  const navegar = useNavigate()
  const [dados, setDados] = useState<PreferenciasDados>(padrao)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [modalConta, setModalConta] = useState(false)
  const [modalTransacoes, setModalTransacoes] = useState(false)
  const [confirmacoes, setConfirmacoes] = useState([false, false])
  const [fraseTransacoes, setFraseTransacoes] = useState('')
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')
  const nome = sessao?.user.user_metadata?.name || sessao?.user.user_metadata?.full_name || sessao?.user.email || 'sua conta'
  const ehTitular = familia?.papel === 'owner'

  useEffect(() => {
    let ativo = true
    async function carregar() {
      if (!supabase || !sessao?.user.id) { setCarregando(false); return }
      const { data, error } = await supabase.from('user_preferences').select('ordem_lancamentos,periodo_padrao,saldo_diario').eq('user_id', sessao.user.id).maybeSingle()
      if (!ativo) return
      if (error) setErro('Não foi possível carregar suas preferências. Confira a conexão e tente novamente.')
      else if (data) setDados({ ordem_lancamentos: data.ordem_lancamentos, periodo_padrao: data.periodo_padrao, saldo_diario: data.saldo_diario })
      setCarregando(false)
    }
    void carregar()
    return () => { ativo = false }
  }, [sessao?.user.id])

  async function salvar() {
    if (!supabase || !sessao?.user.id) return
    setErro(''); setSucesso(''); setSalvando(true)
    try {
      const { error } = await supabase.from('user_preferences').upsert(
        { user_id: sessao.user.id, ...dados, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
      if (error) setErro('Não foi possível salvar. Tente novamente.')
      else setSucesso('Preferências salvas.')
    } catch {
      setErro('Não foi possível salvar. Verifique sua conexão e tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  async function excluirTransacoes() {
    if (!supabase || !familia?.id || !ehTitular || fraseTransacoes.trim().toLowerCase() !== FRASE_EXCLUIR) return
    setErroExclusao(''); setExcluindo(true)
    try {
      const { data, error } = await supabase.rpc('clear_household_transactions', {
        p_household: familia.id,
        p_confirmation: FRASE_EXCLUIR,
      })
      if (error) throw error
      const total = Number(data?.transactions_deleted ?? 0)
      const proventos = Number(data?.investment_distributions_deleted ?? 0)
      setSucesso(`Lançamentos excluídos: ${total}. Proventos vinculados removidos: ${proventos}. Contas e cadastros preservados.`)
      setModalTransacoes(false)
      setFraseTransacoes('')
    } catch {
      setErroExclusao('Não foi possível excluir os lançamentos. Nenhum dado foi removido.')
    } finally {
      setExcluindo(false)
    }
  }

  async function excluirConta() {
    if (!supabase || confirmacoes.some(v => !v)) return
    setErroExclusao(''); setExcluindo(true)
    try {
      const { data, error } = await supabase.functions.invoke('delete-account')
      if (error) {
        const contexto = (error as { context?: Response }).context
        const respostaErro = contexto ? await contexto.clone().json().catch(() => null) as { error?: string } | null : null
        throw new Error(respostaErro?.error || 'Não foi possível concluir a exclusão da conta.')
      }
      if (data?.success !== true) throw new Error(data?.error || 'A exclusão não foi confirmada.')
      await supabase.auth.signOut({ scope: 'local' })
      navegar('/entrar', { replace: true })
    } catch (err) {
      setErroExclusao(err instanceof Error ? err.message : 'Não foi possível excluir sua conta. Nenhum dado financeiro da família foi removido.')
      setExcluindo(false)
    }
  }

  return <>
    <CabecalhoPagina titulo="Preferências" descricao="Personalize como o Tudo Azul apresenta suas movimentações." />
    <Card>
      {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}
      {sucesso && <div className="mb-3"><Aviso tipo="sucesso">{sucesso}</Aviso></div>}
      {carregando ? <p className="py-6 text-sm text-slate-500">Carregando preferências…</p> : <>
        <Opcao titulo="Ordenação dos seus lançamentos" descricao="Ordem (baseada na data) em que suas transações serão listadas na tela de Lançamentos.">
          <Escolha nome="ordem" valor="Crescente" selecionado={dados.ordem_lancamentos === 'asc'} aoMudar={() => setDados(d => ({...d, ordem_lancamentos:'asc'}))} />
          <Escolha nome="ordem" valor="Decrescente" selecionado={dados.ordem_lancamentos === 'desc'} aoMudar={() => setDados(d => ({...d, ordem_lancamentos:'desc'}))} />
        </Opcao>
        <Opcao titulo="Período de navegação padrão" descricao="Escolha a frequência que deseja priorizar nas telas que oferecem navegação por período.">
          <Escolha nome="periodo" valor="Diário" selecionado={dados.periodo_padrao === 'daily'} aoMudar={() => setDados(d => ({...d, periodo_padrao:'daily'}))} />
          <Escolha nome="periodo" valor="Semanal" selecionado={dados.periodo_padrao === 'weekly'} aoMudar={() => setDados(d => ({...d, periodo_padrao:'weekly'}))} />
          <Escolha nome="periodo" valor="Mensal" selecionado={dados.periodo_padrao === 'monthly'} aoMudar={() => setDados(d => ({...d, periodo_padrao:'monthly'}))} />
        </Opcao>
        <Opcao titulo="Saldo diário" descricao="Preferência pessoal para exibição do saldo ao final de cada dia, nas telas que oferecem esse resumo.">
          <Escolha nome="saldo" valor="Sim" selecionado={dados.saldo_diario} aoMudar={() => setDados(d => ({...d, saldo_diario:true}))} />
          <Escolha nome="saldo" valor="Não" selecionado={!dados.saldo_diario} aoMudar={() => setDados(d => ({...d, saldo_diario:false}))} />
        </Opcao>
        <div className="flex justify-end pt-5"><Button onClick={salvar} carregando={salvando}>Salvar alterações</Button></div>
      </>}
    </Card>
    <div className="mt-6"><Card className="border border-negativo-borda">
      <h2 className="font-semibold text-marinho">Zona de perigo</h2>
      <div className="flex flex-col gap-4 divide-y divide-slate-100">
        <div className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-medium">Começar do zero</h3>
            <p className="mt-1 text-sm text-slate-500">Apaga os lançamentos de toda a família, inclusive os planejados e da lixeira. Preserva contas, categorias, cartões, contratos e pagamentos de dívidas, recorrências, operações de investimento e bens. Proventos vinculados a lançamentos também são removidos.</p>
          </div>
          <Button variante="perigoTexto" disabled={!ehTitular} title={!ehTitular ? 'Somente o titular da família pode executar esta ação.' : undefined} onClick={() => { setErroExclusao(''); setFraseTransacoes(''); setModalTransacoes(true) }}>Excluir minhas transações</Button>
        </div>
        <div className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
          <div><h3 className="font-medium">Excluir conta</h3><p className="mt-1 text-sm text-slate-500">Remove seu acesso pessoal. Os dados financeiros compartilhados permanecem. Se você for o titular, a titularidade será transferida ao único outro membro.</p></div>
          <Button variante="perigoTexto" onClick={() => { setConfirmacoes([false,false]); setErroExclusao(''); setModalConta(true) }}>Excluir conta por completo</Button>
        </div>
      </div>
    </Card></div>

    {modalTransacoes && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="titulo-limpar-transacoes" className="my-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-3 flex justify-end"><button type="button" aria-label="Fechar" disabled={excluindo} onClick={() => setModalTransacoes(false)} className="flex h-10 w-10 items-center justify-center rounded-lg text-2xl text-slate-500 hover:bg-slate-100">×</button></div>
        <div className="mb-4 rounded-lg border-l-4 border-negativo bg-negativo-fundo p-3 text-sm text-negativo">A exclusão é definitiva. Todos os lançamentos da família serão removidos, inclusive os planejados e os que estão na lixeira.</div>
        <h2 id="titulo-limpar-transacoes" className="text-xl font-bold text-marinho">Começar do zero</h2>
        <p className="mt-2 text-sm text-slate-600">Contas, categorias, cartões, contratos e pagamentos de dívidas, recorrências, operações de investimento e bens serão preservados. Proventos vinculados a lançamentos também serão excluídos.</p>
        <label className="mt-5 block text-sm font-medium text-slate-700" htmlFor="confirmar-transacoes">Para confirmar, escreva <strong>{FRASE_EXCLUIR}</strong>.</label>
        <input id="confirmar-transacoes" autoComplete="off" value={fraseTransacoes} onChange={e => setFraseTransacoes(e.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 focus:border-azul focus:outline-none focus:ring-2 focus:ring-azul/20" />
        {erroExclusao && <div className="mt-4"><Aviso tipo="erro">{erroExclusao}</Aviso></div>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variante="secundario" disabled={excluindo} onClick={() => setModalTransacoes(false)}>Cancelar</Button>
          <Button variante="perigo" disabled={fraseTransacoes.trim().toLowerCase() !== FRASE_EXCLUIR || excluindo} carregando={excluindo} onClick={excluirTransacoes}>Excluir lançamentos</Button>
        </div>
      </section>
    </div>}

    {modalConta && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="titulo-exclusao" className="my-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex justify-end"><button type="button" aria-label="Fechar" disabled={excluindo} onClick={() => setModalConta(false)} className="flex h-10 w-10 items-center justify-center rounded-lg text-2xl text-slate-500 hover:bg-slate-100">×</button></div>
        <div className="mb-5 flex gap-3 rounded-lg border-l-4 border-atencao-marca bg-atencao-fundo p-3 text-sm text-atencao"><span aria-hidden="true" className="text-lg">!</span><p>Esta exclusão é definitiva: seu perfil, acesso e preferências pessoais serão removidos do Tudo Azul. Os dados financeiros compartilhados da família serão preservados.</p></div>
        <h2 id="titulo-exclusao" className="text-center text-xl font-bold text-marinho">Você está prestes a excluir a sua conta: {nome}</h2>
        <p className="mb-4 mt-2 text-center text-sm text-slate-500">Leia com atenção:</p>
        <div className="divide-y divide-slate-100 border-y border-slate-100">
          <label className="flex cursor-pointer items-start gap-3 py-4 text-sm text-slate-700"><input type="checkbox" checked={confirmacoes[0]} onChange={e => setConfirmacoes(v => [e.target.checked,v[1]])} className="mt-0.5 h-4 w-4 accent-azul" /><span>1. Seu perfil, acesso e preferências pessoais serão apagados. Os dados financeiros compartilhados da família continuarão disponíveis aos demais membros.</span></label>
          <label className="flex cursor-pointer items-start gap-3 py-4 text-sm text-slate-700"><input type="checkbox" checked={confirmacoes[1]} onChange={e => setConfirmacoes(v => [v[0],e.target.checked])} className="mt-0.5 h-4 w-4 accent-azul" /><span>2. Ao seguir, você confirma que entendeu que a exclusão da sua conta é definitiva e não pode ser desfeita.</span></label>
        </div>
        {erroExclusao && <div className="mt-4"><Aviso tipo="erro">{erroExclusao}</Aviso></div>}
        <Button variante="perigo" className="mt-5 w-full" disabled={confirmacoes.some(v => !v) || excluindo} carregando={excluindo} onClick={excluirConta}>Continuar</Button>
        <p className="mt-3 text-center text-xs text-slate-500">Marque todas as opções para continuar.</p>
      </section>
    </div>}
  </>
}
