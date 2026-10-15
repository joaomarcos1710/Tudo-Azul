import { useState } from 'react'
import { useFinanceStore } from '../lib/store'
import { formatBRL, currentMonth } from '../lib/format'
import { Button } from '../components/ui/Button'
import { Users, X, Shield, Mail, RotateCcw, CheckCircle2, UserPlus } from 'lucide-react'

export default function Familia() {
  const { membros, lancamentos, resetarDadosPadrao } = useFinanceStore()
  const [modalNovoMembro, setModalNovoMembro] = useState(false)
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<'Administrador' | 'Membro' | 'Dependente'>('Membro')
  const [sucesso, setSucesso] = useState('')

  const mesAtual = currentMonth()

  // Gasto por membro no mês
  const calcularGastoMembro = (membroId: string) => {
    return lancamentos
      .filter(l => l.membroId === membroId && l.tipo === 'despesa' && l.data.startsWith(mesAtual))
      .reduce((acc, l) => acc + l.valor, 0)
  }

  const handleCriarMembro = (e: React.FormEvent) => {
    e.preventDefault()
    if (!nome.trim()) return

    const iniciais = nome
      .split(' ')
      .map(p => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()

    membros.push({
      id: `membro-${Date.now()}`,
      nome,
      email: email || undefined,
      papel,
      avatar: iniciais || 'MB',
    })

    setNome('')
    setEmail('')
    setModalNovoMembro(false)
    setSucesso('Membro familiar convidado com sucesso!')
    setTimeout(() => setSucesso(''), 3000)
  }

  return (
    <div className="space-y-6">
      {/* Topo / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-6 w-6 text-azul" />
            <h1 className="text-2xl font-bold tracking-tight text-marinho">
              Espaço Familiar Compartilhado
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Gerencie o orçamento conjunto, atribua gastos a cada pessoa e convide membros
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variante="secundario"
            onClick={() => {
              if (confirm('Deseja recarregar os dados de demonstração da família?')) {
                resetarDadosPadrao()
              }
            }}
            className="flex items-center gap-1.5 shadow-sm text-xs"
          >
            <RotateCcw className="h-4 w-4" /> Restaurar Amostra
          </Button>

          <Button
            variante="primario"
            onClick={() => setModalNovoMembro(true)}
            className="flex items-center gap-1.5 shadow-sm text-xs"
          >
            <UserPlus className="h-4 w-4" /> Convidar Membro
          </Button>
        </div>
      </div>

      {sucesso && (
        <div className="flex items-center gap-2 p-3 text-sm text-emerald-800 bg-emerald-50 rounded-xl border border-emerald-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <span>{sucesso}</span>
        </div>
      )}

      {/* Grid de Membros */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {membros.map(membro => {
          const gastoNoMes = calcularGastoMembro(membro.id)

          return (
            <div
              key={membro.id}
              className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-sm space-y-4 hover:border-azul/50 transition flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-azul to-sky-400 text-white font-bold flex items-center justify-center text-sm shadow-sm">
                      {membro.avatar}
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900">{membro.nome}</h3>
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                        <Shield className="h-3 w-3 text-azul" /> {membro.papel}
                      </span>
                    </div>
                  </div>
                </div>

                {membro.email && (
                  <p className="text-xs text-slate-500 flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-slate-400" /> {membro.email}
                  </p>
                )}

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[11px] font-medium text-slate-500">
                    Gastos atribuídos neste mês:
                  </span>
                  <p className="text-lg font-bold text-marinho mt-0.5">
                    {formatBRL(gastoNoMes)}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                <span>Espaço familiar ativo</span>
                <span className="text-emerald-600 font-semibold">Conectado</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal Convidar Membro */}
      {modalNovoMembro && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50">
              <h2 className="text-base font-bold text-marinho">Convidar Membro da Família</h2>
              <button
                type="button"
                onClick={() => setModalNovoMembro(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCriarMembro} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Nome Completo
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Mariana Silva"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  E-mail para Convite (opcional)
                </label>
                <input
                  type="email"
                  placeholder="mariana@exemplo.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Papel na Família
                </label>
                <select
                  value={papel}
                  onChange={e => setPapel(e.target.value as any)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  <option value="Administrador">Administrador (Controle Total)</option>
                  <option value="Membro">Membro (Lança e visualiza)</option>
                  <option value="Dependente">Dependente (Apenas despesas)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <Button variante="secundario" onClick={() => setModalNovoMembro(false)} type="button">
                  Cancelar
                </Button>
                <Button variante="primario" type="submit">
                  Confirmar Convite
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
