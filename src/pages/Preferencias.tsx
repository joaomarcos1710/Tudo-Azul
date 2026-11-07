import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'

type PreferenciasDados = { ordem_lancamentos: 'asc' | 'desc'; periodo_padrao: 'daily' | 'weekly' | 'monthly'; saldo_diario: boolean }
const padrao: PreferenciasDados = { ordem_lancamentos: 'desc', periodo_padrao: 'monthly', saldo_diario: true }

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
  const [dados, setDados] = useState<PreferenciasDados>(padrao)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState(false)
  const [modal, setModal] = useState(false)
  const [confirmacoes, setConfirmacoes] = useState([false, false])
  const [excluindo, setExcluindo] = useState(false)
  const [erroExclusao, setErroExclusao] = useState('')
  const nome = sessao?.user.user_metadata?.name || sessao?.user.user_metadata?.full_name || sessao?.user.email || 'sua conta'

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
    setErro(''); setSucesso(false); setSalvando(true)
    const { error } = await supabase.from('user_preferences').upsert({ user_id: sessao.user.id, ...dados }, { onConflict: 'user_id' })
    setSalvando(false)
    if (error) setErro('Não foi possível salvar. Tente novamente.')
    else setSucesso(true)
  }

  async function excluirConta() {
    if (!supabase || confirmacoes.some(v => !v)) return
    setErroExclusao(''); setExcluindo(true)
    const { error } = await supabase.functions.invoke('delete-account')
    setExcluindo(false)
    if (error) setErroExclusao('Não foi possível excluir sua conta. Nenhum dado foi removido. Tente novamente ou fale com o suporte.')
  }

  return <>
    <CabecalhoPagina titulo="Preferências" descricao="Personalize como o Tudo Azul apresenta suas movimentações." />
    <Card>
      {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}
      {sucesso && <div className="mb-3"><Aviso tipo="sucesso">Preferências salvas.</Aviso></div>}
      {carregando ? <p className="py-6 text-sm text-slate-500">Carregando preferências…</p> : <>
        <Opcao titulo="Ordenação dos seus lançamentos" descricao="Ordem (baseada na data) em que suas transações serão listadas na tela de Lançamentos.">
          <Escolha nome="ordem" valor="Crescente" selecionado={dados.ordem_lancamentos === 'asc'} aoMudar={() => setDados(d => ({...d, ordem_lancamentos:'asc'}))} />
          <Escolha nome="ordem" valor="Decrescente" selecionado={dados.ordem_lancamentos === 'desc'} aoMudar={() => setDados(d => ({...d, ordem_lancamentos:'desc'}))} />
        </Opcao>
        <Opcao titulo="Período de navegação padrão" descricao="Para quem faz muitos lançamentos durante o mês, o ideal pode ser escolher semanal ou diário.">
          <Escolha nome="periodo" valor="Diário" selecionado={dados.periodo_padrao === 'daily'} aoMudar={() => setDados(d => ({...d, periodo_padrao:'daily'}))} />
          <Escolha nome="periodo" valor="Semanal" selecionado={dados.periodo_padrao === 'weekly'} aoMudar={() => setDados(d => ({...d, periodo_padrao:'weekly'}))} />
          <Escolha nome="periodo" valor="Mensal" selecionado={dados.periodo_padrao === 'monthly'} aoMudar={() => setDados(d => ({...d, periodo_padrao:'monthly'}))} />
        </Opcao>
        <Opcao titulo="Saldo diário" descricao="Mostra os saldos listados na tela de Lançamentos ao final de cada dia.">
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
          <div><h3 className="font-medium">Começar do zero</h3><p className="mt-1 text-sm text-slate-500">Exclui movimentações sem apagar contas e categorias. Esta ação será liberada após a rotina específica de exclusão ser validada.</p></div>
          <Button variante="perigoTexto" disabled title="Ação temporariamente indisponível">Excluir minhas transações</Button>
        </div>
        <div className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
          <div><h3 className="font-medium">Excluir conta</h3><p className="mt-1 text-sm text-slate-500">Remove seu acesso pessoal. Os dados financeiros da família permanecem e a titularidade passa para outro membro.</p></div>
          <Button variante="perigoTexto" onClick={() => { setConfirmacoes([false,false]); setErroExclusao(''); setModal(true) }}>Excluir conta por completo</Button>
        </div>
      </div>
    </Card></div>
    {modal && <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget && !excluindo) setModal(false) }}>
      <section role="dialog" aria-modal="true" aria-labelledby="titulo-exclusao" className="my-auto w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex justify-end"><button type="button" aria-label="Fechar" disabled={excluindo} onClick={() => setModal(false)} className="flex h-10 w-10 items-center justify-center rounded-lg text-2xl text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-azul">×</button></div>
        <div className="mb-5 flex gap-3 rounded-lg border-l-4 border-atencao-marca bg-atencao-fundo p-3 text-sm text-atencao"><span aria-hidden="true" className="text-lg">!</span><p>Esta exclusão é definitiva: seus dados pessoais de acesso serão removidos do Tudo Azul no site e na aplicação. Os dados financeiros compartilhados da família serão preservados.</p></div>
        <h2 id="titulo-exclusao" className="text-center text-xl font-bold text-marinho">Você está prestes a excluir a sua conta: {nome}</h2>
        <p className="mb-4 mt-2 text-center text-sm text-slate-500">Leia com atenção:</p>
        <div className="divide-y divide-slate-100 border-y border-slate-100">
          <label className="flex cursor-pointer items-start gap-3 py-4 text-sm text-slate-700"><input type="checkbox" checked={confirmacoes[0]} onChange={e => setConfirmacoes(v => [e.target.checked,v[1]])} className="mt-0.5 h-4 w-4 accent-azul" /><span>1. Sua conta e seus dados pessoais de acesso serão apagados. Os dados financeiros da família permanecerão disponíveis aos demais membros.</span></label>
          <label className="flex cursor-pointer items-start gap-3 py-4 text-sm text-slate-700"><input type="checkbox" checked={confirmacoes[1]} onChange={e => setConfirmacoes(v => [v[0],e.target.checked])} className="mt-0.5 h-4 w-4 accent-azul" /><span>2. Ao seguir, você confirma que entendeu que a exclusão da sua conta é definitiva e não pode ser desfeita.</span></label>
        </div>
        {erroExclusao && <div className="mt-4"><Aviso tipo="erro">{erroExclusao}</Aviso></div>}
        <Button variante="perigo" className="mt-5 w-full" disabled={confirmacoes.some(v => !v) || excluindo} carregando={excluindo} onClick={excluirConta}>Continuar</Button>
        <p className="mt-3 text-center text-xs text-slate-500">Marque todas as opções para continuar.</p>
      </section>
    </div>}
  </>
}
