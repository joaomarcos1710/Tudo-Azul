import { useState } from 'react'
import { useFinanceStore, MetaSonho } from '../lib/store'
import { formatBRL, formatDate } from '../lib/format'
import { Button } from '../components/ui/Button'
import { ModalAporteMeta } from '../components/modals/ModalAporteMeta'
import { Sparkles, Plus, Calendar, CheckCircle2, X } from 'lucide-react'

export default function Metas() {
  const { metas, adicionarMeta } = useFinanceStore()
  const [modalNovoAberto, setModalNovoAberto] = useState(false)
  const [modalAporteAberto, setModalAporteAberto] = useState(false)
  const [metaSelecionada, setMetaSelecionada] = useState<MetaSonho | null>(null)

  // Form novo sonho
  const [titulo, setTitulo] = useState('')
  const [valorAlvoStr, setValorAlvoStr] = useState('')
  const [valorAtualStr, setValorAtualStr] = useState('0')
  const [dataAlvo, setDataAlvo] = useState('')
  const [cor, setCor] = useState('#10B981')
  const [descricao, setDescricao] = useState('')

  const totalAcumulado = metas.reduce((acc, m) => acc + m.valorAtual, 0)
  const totalAlvo = metas.reduce((acc, m) => acc + m.valorAlvo, 0)
  const progressoMedio = totalAlvo > 0 ? (totalAcumulado / totalAlvo) * 100 : 0

  const handleCriarMeta = (e: React.FormEvent) => {
    e.preventDefault()
    const valorAlvo = parseFloat(valorAlvoStr.replace(/\./g, '').replace(',', '.'))
    const valorAtual = parseFloat(valorAtualStr.replace(/\./g, '').replace(',', '.')) || 0

    if (isNaN(valorAlvo) || valorAlvo <= 0) return

    adicionarMeta({
      titulo,
      icone: 'Target',
      valorAlvo,
      valorAtual,
      dataAlvo: dataAlvo || new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
      cor,
      descricao,
    })

    setTitulo('')
    setValorAlvoStr('')
    setValorAtualStr('0')
    setDescricao('')
    setModalNovoAberto(false)
  }

  // Calcula quanto guardar por mês para bater a meta
  const calcularAporteMensalSugerido = (meta: MetaSonho) => {
    const restante = Math.max(0, meta.valorAlvo - meta.valorAtual)
    if (restante === 0) return 0

    const hoje = new Date()
    const alvo = new Date(meta.dataAlvo)
    const meses = Math.max(1, (alvo.getFullYear() - hoje.getFullYear()) * 12 + (alvo.getMonth() - hoje.getMonth()))
    return Math.round((restante / meses) * 100) / 100
  }

  return (
    <div className="space-y-6">
      {/* Topo / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-amber-500" />
            <h1 className="text-2xl font-bold tracking-tight text-marinho">
              Gerenciador de Sonhos & Metas
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            O pilar clássico do Minhas Economias: planeje, poupe e realize os objetivos da sua família
          </p>
        </div>

        <Button
          variante="primario"
          onClick={() => setModalNovoAberto(true)}
          className="flex items-center gap-1.5 shadow-sm text-xs"
        >
          <Plus className="h-4 w-4" /> + Criar Novo Sonho
        </Button>
      </div>

      {/* Hero Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Total Já Guardado nos Sonhos
          </span>
          <p className="text-2xl font-bold text-emerald-600">{formatBRL(totalAcumulado)}</p>
          <p className="text-xs text-slate-500">Patrimônio acumulado para os objetivos</p>
        </div>

        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Meta Total dos Sonhos
          </span>
          <p className="text-2xl font-bold text-slate-900">{formatBRL(totalAlvo)}</p>
          <p className="text-xs text-slate-500">{metas.length} objetivos cadastrados</p>
        </div>

        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Progresso Geral
          </span>
          <p className="text-2xl font-bold text-azul">{progressoMedio.toFixed(1)}%</p>
          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-full bg-azul transition-all duration-500"
              style={{ width: `${Math.min(100, progressoMedio)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Grid de Sonhos & Metas */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {metas.map(meta => {
          const perc = Math.min(100, (meta.valorAtual / meta.valorAlvo) * 100)
          const restante = Math.max(0, meta.valorAlvo - meta.valorAtual)
          const aporteSugerido = calcularAporteMensalSugerido(meta)
          const concluido = meta.valorAtual >= meta.valorAlvo

          return (
            <div
              key={meta.id}
              className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-sm space-y-4 hover:border-azul/50 transition flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="h-10 w-10 rounded-xl flex items-center justify-center text-white"
                      style={{ backgroundColor: meta.cor }}
                    >
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900">{meta.titulo}</h3>
                      <p className="text-xs text-slate-400 flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> Meta para {formatDate(meta.dataAlvo)}
                      </p>
                    </div>
                  </div>

                  {concluido && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                      <CheckCircle2 className="h-3 w-3" /> Concluído
                    </span>
                  )}
                </div>

                {meta.descricao && (
                  <p className="text-xs text-slate-600 line-clamp-2">{meta.descricao}</p>
                )}

                {/* Barra de Progresso do Sonho */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between items-baseline text-xs">
                    <span className="font-bold text-slate-900">{formatBRL(meta.valorAtual)}</span>
                    <span className="text-slate-500">Alvo: {formatBRL(meta.valorAlvo)}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all duration-500"
                      style={{ width: `${perc}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span className="font-bold text-emerald-600">{perc.toFixed(1)}% alcançado</span>
                    <span>Falta {formatBRL(restante)}</span>
                  </div>
                </div>

                {/* Sugestão de aporte mensal inteligente */}
                {!concluido && aporteSugerido > 0 && (
                  <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/60 text-xs text-amber-900 flex items-center justify-between">
                    <span>Aporte mensal ideal:</span>
                    <span className="font-bold">{formatBRL(aporteSugerido)}/mês</span>
                  </div>
                )}

                {/* Histórico Recente de Aportes */}
                {meta.historicoAportes.length > 0 && (
                  <div className="pt-2 border-t border-slate-100">
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Últimos Aportes:
                    </p>
                    <div className="space-y-1">
                      {meta.historicoAportes.slice(0, 2).map((ap, idx) => (
                        <div key={idx} className="flex justify-between text-xs text-slate-600">
                          <span>{ap.data}: {ap.nota || 'Aporte'}</span>
                          <span className="font-semibold text-emerald-600">+{formatBRL(ap.valor)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Botão de Ação */}
              <div className="pt-3 border-t border-slate-100">
                <Button
                  variante="primario"
                  onClick={() => {
                    setMetaSelecionada(meta)
                    setModalAporteAberto(true)
                  }}
                  className="w-full !min-h-9 text-xs flex items-center justify-center gap-1.5"
                >
                  <Plus className="h-3.5 w-3.5" /> Guardar Dinheiro Neste Sonho
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal Criar Sonho */}
      {modalNovoAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-500" />
                <h2 className="text-base font-bold text-marinho">Novo Sonho ou Meta Financeira</h2>
              </div>
              <button
                type="button"
                onClick={() => setModalNovoAberto(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCriarMeta} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Qual é o seu sonho ou objetivo?
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Viagem de Férias, Reserva de Emergência, Casa Própria"
                  value={titulo}
                  onChange={e => setTitulo(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Valor Alvo (R$)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: 20000,00"
                    value={valorAlvoStr}
                    onChange={e => setValorAlvoStr(e.target.value)}
                    className="w-full h-11 px-3 text-sm font-semibold rounded-lg border border-slate-300 text-right"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Já possui guardado?
                  </label>
                  <input
                    type="text"
                    placeholder="0,00"
                    value={valorAtualStr}
                    onChange={e => setValorAtualStr(e.target.value)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 text-right"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Data Alvo para Realização
                </label>
                <input
                  type="date"
                  required
                  value={dataAlvo}
                  onChange={e => setDataAlvo(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Descrição ou Motivação (opcional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Segurança financeira da família ou férias inesquecíveis"
                  value={descricao}
                  onChange={e => setDescricao(e.target.value)}
                  className="w-full p-2.5 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Cor de Destaque
                </label>
                <div className="flex items-center gap-2">
                  {['#10B981', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#EF4444'].map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCor(c)}
                      className={`h-7 w-7 rounded-full border-2 transition ${
                        cor === c ? 'border-marinho scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <Button variante="secundario" onClick={() => setModalNovoAberto(false)} type="button">
                  Cancelar
                </Button>
                <Button variante="primario" type="submit">
                  Criar Sonho
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Aporte */}
      <ModalAporteMeta
        aberto={modalAporteAberto}
        aoFechar={() => setModalAporteAberto(false)}
        meta={metaSelecionada}
      />
    </div>
  )
}
