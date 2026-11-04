import { useEffect, useState } from 'react'
import { Aviso } from './ui/Aviso'
import { Button } from './ui/Button'
import { Card, CardTitle } from './ui/Card'
import { carregarPreferenciaAviso, linhasDoAviso, PREFERENCIA_PADRAO, resumoDoDia, salvarPreferenciaAviso } from '../lib/avisoDiario'
import type { PreferenciaAviso, ResumoDoDia } from '../lib/avisoDiario'
import { hojeSP } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'

const HORAS = Array.from({ length: 18 }, (_, i) => i + 5) // 5h a 22h (o banco recusa fora disso)

/** Card "Aviso diário por e-mail" na tela Família: liga/desliga, horário, esconder valores e a prévia de hoje. */
export function AvisoDiario({ userId, familiaId, email }: { userId: string; familiaId: string; email: string | null }) {
  const [pref, setPref] = useState<PreferenciaAviso>(PREFERENCIA_PADRAO)
  const [resumo, setResumo] = useState<ResumoDoDia | null>(null)
  const [carregado, setCarregado] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null)

  useEffect(() => {
    let ativo = true
    Promise.all([carregarPreferenciaAviso(userId), resumoDoDia(familiaId, hojeSP()).catch(() => null)])
      .then(([p, r]) => { if (!ativo) return; setPref(p ?? PREFERENCIA_PADRAO); setResumo(r); setCarregado(true) })
      .catch((err) => { if (ativo) { setMsg({ tipo: 'erro', texto: mensagemErroBanco(err) }); setCarregado(true) } })
    return () => { ativo = false }
  }, [userId, familiaId])

  async function salvar() {
    setSalvando(true)
    setMsg(null)
    try {
      await salvarPreferenciaAviso(userId, familiaId, pref)
      setMsg({ tipo: 'sucesso', texto: pref.ligado ? `Aviso ligado: chega às ${pref.hora}h, quando houver algo a avisar.` : 'Aviso desligado.' })
    } catch (err) {
      setMsg({ tipo: 'erro', texto: err instanceof Error && err.message.startsWith('Escolha') ? err.message : mensagemErroBanco(err) })
    } finally {
      setSalvando(false)
    }
  }

  const previa = resumo ? linhasDoAviso(resumo, pref.esconderValores) : null
  return (
    <Card>
      <CardTitle>Aviso diário por e-mail</CardTitle>
      <p className="mb-3 text-sm text-slate-600">
        Um e-mail curto de manhã com vencidos, o que vence hoje, faturas dos próximos 3 dias e o saldo previsto.
        Se não houver nada, o e-mail não sai.{email && <> Vai para <strong>{email}</strong>.</>}
      </p>
      {!carregado ? <p className="text-sm text-slate-500" role="status">Carregando…</p> : (
        <div className="space-y-3">
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
            <input type="checkbox" className="h-5 w-5" checked={pref.ligado} onChange={(e) => setPref({ ...pref, ligado: e.target.checked })} />
            Receber o aviso diário
          </label>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <span className="font-medium">Horário</span>
            <select className="min-h-11 rounded-lg border border-slate-300 px-3" value={pref.hora} disabled={!pref.ligado}
              onChange={(e) => setPref({ ...pref, hora: Number(e.target.value) })}>
              {HORAS.map((h) => <option key={h} value={h}>{h}h</option>)}
            </select>
          </label>
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={pref.esconderValores}
              onChange={(e) => setPref({ ...pref, esconderValores: e.target.checked })} />
            <span><span className="font-medium">Esconder valores</span>
              <span className="block text-slate-500">O e-mail diz quantos compromissos e faturas há, sem os R$ (recomendado).</span></span>
          </label>
          <Button onClick={() => void salvar()} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
          {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
          <div className="rounded-lg bg-slate-50 p-3 text-sm" aria-label="Prévia do aviso de hoje">
            <p className="mb-1 font-semibold text-marinho">Como ficaria hoje</p>
            {previa === null ? <p className="text-slate-500">Prévia indisponível agora.</p>
              : previa.length === 0 ? <p className="text-slate-500">Nada a avisar hoje: o e-mail não seria enviado.</p>
              : <ul className="space-y-1">{previa.map((l) => <li key={l}>{l}</li>)}</ul>}
          </div>
        </div>
      )}
    </Card>
  )
}
