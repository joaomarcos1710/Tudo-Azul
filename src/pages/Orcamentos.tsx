import { useState } from 'react'
import { useFinanceStore } from '../lib/store'
import { formatBRL, formatMonth, currentMonth } from '../lib/format'
import { Target, ChevronLeft, ChevronRight, Edit2, Check } from 'lucide-react'

export default function Orcamentos() {
  const { categorias, salvarOrcamento, calcularConsumoOrcamento } = useFinanceStore()
  const [mesSelecionado, setMesSelecionado] = useState(currentMonth())
  const [editandoCatId, setEditandoCatId] = useState<string | null>(null)
  const [novoLimiteStr, setNovoLimiteStr] = useState('')

  const mudarMes = (delta: number) => {
    const [ano, mes] = mesSelecionado.split('-').map(Number)
    const d = new Date(ano, mes - 1 + delta, 1)
    const novoAno = d.getFullYear()
    const novoMes = String(d.getMonth() + 1).padStart(2, '0')
    setMesSelecionado(`${novoAno}-${novoMes}`)
  }

  const categoriasDespesa = categorias.filter(c => c.tipo === 'despesa')

  // Totais orçamentários do mês
  let totalOrcado = 0
  let totalGasto = 0

  categoriasDespesa.forEach(cat => {
    const c = calcularConsumoOrcamento(cat.id, mesSelecionado)
    totalOrcado += c.limite
    totalGasto += c.totalGasto
  })

  const percGeral = totalOrcado > 0 ? (totalGasto / totalOrcado) * 100 : 0
  const saldoRestanteGeral = totalOrcado - totalGasto

  const handleSalvarLimite = (catId: string) => {
    const valor = parseFloat(novoLimiteStr.replace(/\./g, '').replace(',', '.'))
    if (!isNaN(valor) && valor >= 0) {
      salvarOrcamento(catId, mesSelecionado, valor)
    }
    setEditandoCatId(null)
    setNovoLimiteStr('')
  }

  const iniciarEdicao = (catId: string, limiteAtual: number) => {
    setEditandoCatId(catId)
    setNovoLimiteStr(limiteAtual > 0 ? limiteAtual.toString() : '')
  }

  return (
    <div className="space-y-6">
      {/* Topo / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-marinho">Orçamentos & Metas Mensais</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Defina tetos de gastos por categoria para manter o orçamento familiar sob controle
          </p>
        </div>

        {/* Seletor de Mês */}
        <div className="flex items-center rounded-xl bg-white border border-slate-200 shadow-sm p-1">
          <button
            type="button"
            onClick={() => mudarMes(-1)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-3 text-xs font-bold text-marinho capitalize min-w-[130px] text-center">
            {formatMonth(mesSelecionado)}
          </span>
          <button
            type="button"
            onClick={() => mudarMes(1)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Resumo Geral do Orçamento (Termômetro Minhas Economias) */}
      <div className="rounded-2xl bg-white p-6 border border-slate-200/80 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Total Orçado no Mês
            </span>
            <p className="text-2xl font-bold text-slate-900 mt-1">{formatBRL(totalOrcado)}</p>
            <p className="text-xs text-slate-500 mt-0.5">Soma dos limites de todas as categorias</p>
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Gasto Realizado no Mês
            </span>
            <p className="text-2xl font-bold text-rose-600 mt-1">{formatBRL(totalGasto)}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {percGeral.toFixed(1)}% do orçamento total consumido
            </p>
          </div>

          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Saldo Restante no Orçamento
            </span>
            <p className={`text-2xl font-bold mt-1 ${saldoRestanteGeral >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {formatBRL(saldoRestanteGeral)}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {saldoRestanteGeral >= 0 ? 'Disponível para gastar até o fim do mês' : 'Orçamento geral estourado'}
            </p>
          </div>
        </div>

        {/* Barra de Progresso Geral */}
        <div className="space-y-1.5 pt-2">
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                percGeral > 100 ? 'bg-rose-600' : percGeral > 80 ? 'bg-amber-500' : 'bg-emerald-500'
              }`}
              style={{ width: `${Math.min(100, percGeral)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-slate-400">
            <span>0%</span>
            <span>50%</span>
            <span>100% {totalOrcado > 0 ? `(${formatBRL(totalOrcado)})` : ''}</span>
          </div>
        </div>
      </div>

      {/* Grid de Categorias: Essenciais vs Estilo de Vida */}
      <div className="space-y-6">
        {/* Essenciais */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-600"></span> Despesas Essenciais (Moradia, Alimentação, Saúde)
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {categoriasDespesa
              .filter(c => c.classificacao === 'essencial')
              .map(cat => {
                const consumo = calcularConsumoOrcamento(cat.id, mesSelecionado)
                const isEditando = editandoCatId === cat.id

                return (
                  <div
                    key={cat.id}
                    className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-sm space-y-3 hover:border-slate-300 transition"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-9 w-9 rounded-xl flex items-center justify-center text-white"
                          style={{ backgroundColor: cat.cor }}
                        >
                          <Target className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">{cat.nome}</h3>
                          <span className="text-[11px] text-slate-400">Classificação: Essencial</span>
                        </div>
                      </div>

                      {/* Botão de Edição do Limite */}
                      {!isEditando ? (
                        <button
                          type="button"
                          onClick={() => iniciarEdicao(cat.id, consumo.limite)}
                          className="flex items-center gap-1 text-xs text-azul hover:underline font-medium"
                        >
                          <Edit2 className="h-3 w-3" /> {consumo.limite > 0 ? 'Alterar teto' : 'Definir teto'}
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            placeholder="Teto R$"
                            value={novoLimiteStr}
                            onChange={e => setNovoLimiteStr(e.target.value)}
                            className="w-24 h-8 px-2 text-xs font-semibold rounded border border-azul text-right"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleSalvarLimite(cat.id)}
                            className="p-1.5 rounded bg-azul text-white hover:bg-blue-700"
                            title="Salvar teto"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Valores de Consumo */}
                    <div className="flex items-baseline justify-between pt-1">
                      <div>
                        <span className="text-xs text-slate-500">Gasto:</span>
                        <p className="text-lg font-bold text-slate-900">{formatBRL(consumo.totalGasto)}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-500">Teto Orçado:</span>
                        <p className="text-sm font-bold text-slate-700">
                          {consumo.limite > 0 ? formatBRL(consumo.limite) : 'Não definido'}
                        </p>
                        {consumo.limite > 0 && (
                          <span className={`text-[11px] font-semibold ${consumo.estourado ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {consumo.estourado ? `Estourou em ${formatBRL(Math.abs(consumo.restante))}` : `Resta ${formatBRL(consumo.restante)}`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Barra de Progresso */}
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          consumo.estourado
                            ? 'bg-rose-600'
                            : consumo.percentual > 80
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, consumo.percentual)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
          </div>
        </div>

        {/* Estilo de Vida */}
        <div className="space-y-3 pt-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-purple-600"></span> Estilo de Vida & Lazer (Restaurantes, Compras, Assinaturas)
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {categoriasDespesa
              .filter(c => c.classificacao === 'estilo_vida')
              .map(cat => {
                const consumo = calcularConsumoOrcamento(cat.id, mesSelecionado)
                const isEditando = editandoCatId === cat.id

                return (
                  <div
                    key={cat.id}
                    className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-sm space-y-3 hover:border-slate-300 transition"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-9 w-9 rounded-xl flex items-center justify-center text-white"
                          style={{ backgroundColor: cat.cor }}
                        >
                          <Target className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-900">{cat.nome}</h3>
                          <span className="text-[11px] text-slate-400">Classificação: Estilo de Vida</span>
                        </div>
                      </div>

                      {!isEditando ? (
                        <button
                          type="button"
                          onClick={() => iniciarEdicao(cat.id, consumo.limite)}
                          className="flex items-center gap-1 text-xs text-azul hover:underline font-medium"
                        >
                          <Edit2 className="h-3 w-3" /> {consumo.limite > 0 ? 'Alterar teto' : 'Definir teto'}
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            placeholder="Teto R$"
                            value={novoLimiteStr}
                            onChange={e => setNovoLimiteStr(e.target.value)}
                            className="w-24 h-8 px-2 text-xs font-semibold rounded border border-azul text-right"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleSalvarLimite(cat.id)}
                            className="p-1.5 rounded bg-azul text-white hover:bg-blue-700"
                            title="Salvar teto"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-baseline justify-between pt-1">
                      <div>
                        <span className="text-xs text-slate-500">Gasto:</span>
                        <p className="text-lg font-bold text-slate-900">{formatBRL(consumo.totalGasto)}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-slate-500">Teto Orçado:</span>
                        <p className="text-sm font-bold text-slate-700">
                          {consumo.limite > 0 ? formatBRL(consumo.limite) : 'Não definido'}
                        </p>
                        {consumo.limite > 0 && (
                          <span className={`text-[11px] font-semibold ${consumo.estourado ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {consumo.estourado ? `Estourou em ${formatBRL(Math.abs(consumo.restante))}` : `Resta ${formatBRL(consumo.restante)}`}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          consumo.estourado
                            ? 'bg-rose-600'
                            : consumo.percentual > 80
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, consumo.percentual)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
          </div>
        </div>
      </div>
    </div>
  )
}
