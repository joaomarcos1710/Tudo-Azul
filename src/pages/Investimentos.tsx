import { useState } from 'react'
import { useFinanceStore, Investimento } from '../lib/store'
import { formatBRL } from '../lib/format'
import { Button } from '../components/ui/Button'
import {
  TrendingUp, Plus, Trash2, X, PieChart
} from 'lucide-react'

export default function Investimentos() {
  const { investimentos, adicionarInvestimento, excluirInvestimento, totalInvestimentos } = useFinanceStore()
  const [modalNovoAberto, setModalNovoAberto] = useState(false)

  // Form states
  const [nome, setNome] = useState('')
  const [classe, setClasse] = useState<Investimento['classe']>('renda_fixa')
  const [instituicao, setInstituicao] = useState('XP Investimentos')
  const [valorInvestidoStr, setValorInvestidoStr] = useState('')
  const [valorAtualStr, setValorAtualStr] = useState('')
  const [proventosStr, setProventosStr] = useState('0')

  const totalAportado = investimentos.reduce((acc, i) => acc + i.valorInvestido, 0)
  const rentabilidadeTotal = totalInvestimentos - totalAportado
  const percRentabilidade = totalAportado > 0 ? (rentabilidadeTotal / totalAportado) * 100 : 0
  const totalProventos = investimentos.reduce((acc, i) => acc + i.proventosUltimoMes, 0)

  // Alocação por classe
  const alocacaoPorClasse = [
    { id: 'renda_fixa', rotulo: 'Renda Fixa (Tesouro/CDB)', cor: '#3B82F6' },
    { id: 'fiis', rotulo: 'Fundos Imobiliários (FIIs)', cor: '#10B981' },
    { id: 'acoes', rotulo: 'Ações Brasil (B3)', cor: '#8B5CF6' },
    { id: 'exterior', rotulo: 'Exterior & Dólar', cor: '#F59E0B' },
    { id: 'cripto', rotulo: 'Criptoativos', cor: '#EC4899' },
    { id: 'previdencia', rotulo: 'Previdência Privada', cor: '#06B6D4' },
  ].map(item => {
    const valor = investimentos
      .filter(i => i.classe === item.id)
      .reduce((acc, i) => acc + i.valorAtual, 0)
    const perc = totalInvestimentos > 0 ? (valor / totalInvestimentos) * 100 : 0
    return { ...item, valor, perc }
  }).filter(item => item.valor > 0)

  const handleSalvar = (e: React.FormEvent) => {
    e.preventDefault()
    const valorInvestido = parseFloat(valorInvestidoStr.replace(/\./g, '').replace(',', '.'))
    const valorAtual = parseFloat(valorAtualStr.replace(/\./g, '').replace(',', '.')) || valorInvestido
    const proventos = parseFloat(proventosStr.replace(/\./g, '').replace(',', '.')) || 0

    if (isNaN(valorInvestido) || valorInvestido <= 0) return

    adicionarInvestimento({
      nome,
      classe,
      instituicao: instituicao || 'Corretora',
      valorInvestido,
      valorAtual,
      rendimentoTotal: valorAtual - valorInvestido,
      proventosUltimoMes: proventos,
    })

    setNome('')
    setValorInvestidoStr('')
    setValorAtualStr('')
    setProventosStr('0')
    setModalNovoAberto(false)
  }

  return (
    <div className="space-y-6">
      {/* Topo / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-emerald-600" />
            <h1 className="text-2xl font-bold tracking-tight text-marinho">
              Carteira de Investimentos
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Acompanhe a rentabilidade, alocação de ativos e dividendos/proventos recebidos
          </p>
        </div>

        <Button
          variante="primario"
          onClick={() => setModalNovoAberto(true)}
          className="flex items-center gap-1.5 shadow-sm text-xs"
        >
          <Plus className="h-4 w-4" /> + Adicionar Ativo
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Patrimônio em Investimentos
          </span>
          <p className="text-2xl font-bold text-slate-900">{formatBRL(totalInvestimentos)}</p>
          <p className="text-xs text-slate-400">{investimentos.length} posições ativas</p>
        </div>

        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Total Aportado (Custo)
          </span>
          <p className="text-2xl font-bold text-slate-700">{formatBRL(totalAportado)}</p>
          <p className="text-xs text-slate-400">Capital investido do bolso</p>
        </div>

        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Rentabilidade Acumulada
          </span>
          <p className={`text-2xl font-bold ${rentabilidadeTotal >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {rentabilidadeTotal >= 0 ? '+' : ''}{formatBRL(rentabilidadeTotal)}
          </p>
          <p className={`text-xs font-semibold ${rentabilidadeTotal >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {percRentabilidade.toFixed(2)}% de valorização
          </p>
        </div>

        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Proventos do Mês (Dividendos)
          </span>
          <p className="text-2xl font-bold text-azul">{formatBRL(totalProventos)}</p>
          <p className="text-xs text-slate-400">Renda passiva mensal gerada</p>
        </div>
      </div>

      {/* Alocação da Carteira */}
      <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PieChart className="h-5 w-5 text-azul" />
            <h2 className="text-base font-bold text-marinho">Alocação de Ativos</h2>
          </div>
          <span className="text-xs text-slate-500">{alocacaoPorClasse.length} classes de ativos</span>
        </div>

        {/* Barra empilhada de alocação */}
        <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden flex">
          {alocacaoPorClasse.map(item => (
            <div
              key={item.id}
              className="h-full transition-all"
              style={{
                width: `${item.perc}%`,
                backgroundColor: item.cor,
              }}
              title={`${item.rotulo}: ${item.perc.toFixed(1)}%`}
            />
          ))}
        </div>

        {/* Legenda de Alocação */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pt-2">
          {alocacaoPorClasse.map(item => (
            <div key={item.id} className="flex items-center gap-2 text-xs">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: item.cor }} />
              <div className="min-w-0">
                <span className="text-slate-700 font-medium truncate block">{item.rotulo}</span>
                <span className="text-slate-400 font-semibold">{formatBRL(item.valor)} ({item.perc.toFixed(1)}%)</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Grid de Ativos */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {investimentos.map(inv => {
          const lucro = inv.valorAtual - inv.valorInvestido
          const percLucro = inv.valorInvestido > 0 ? (lucro / inv.valorInvestido) * 100 : 0

          return (
            <div
              key={inv.id}
              className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-sm space-y-4 hover:border-azul/50 transition flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{inv.nome}</h3>
                    <p className="text-xs text-slate-400">
                      {inv.instituicao} • <span className="capitalize">{inv.classe.replace('_', ' ')}</span>
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Deseja remover "${inv.nome}"?`)) {
                        excluirInvestimento(inv.id)
                      }
                    }}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                    title="Remover ativo"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-2 text-xs">
                  <div className="flex justify-between items-baseline">
                    <span className="text-slate-500">Saldo Atual da Posição:</span>
                    <span className="text-base font-bold text-slate-900">{formatBRL(inv.valorAtual)}</span>
                  </div>

                  <div className="flex justify-between items-baseline text-slate-500">
                    <span>Custo Aportado:</span>
                    <span>{formatBRL(inv.valorInvestido)}</span>
                  </div>

                  <div className="flex justify-between items-baseline pt-1 border-t border-slate-200/60">
                    <span className="text-slate-500">Rentabilidade Total:</span>
                    <span className={`font-semibold ${lucro >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {lucro >= 0 ? '+' : ''}{formatBRL(lucro)} ({percLucro.toFixed(2)}%)
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-500">Proventos no mês:</span>
                <span className="font-bold text-azul">+{formatBRL(inv.proventosUltimoMes)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal Novo Ativo */}
      {modalNovoAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50">
              <h2 className="text-base font-bold text-marinho">Novo Ativo de Investimento</h2>
              <button
                type="button"
                onClick={() => setModalNovoAberto(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSalvar} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Nome do Ativo
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Tesouro Selic 2029, HGLG11, ITUB4"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Classe do Ativo
                  </label>
                  <select
                    value={classe}
                    onChange={e => setClasse(e.target.value as any)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="renda_fixa">Renda Fixa</option>
                    <option value="fiis">Fundos Imobiliários (FIIs)</option>
                    <option value="acoes">Ações (B3)</option>
                    <option value="exterior">Exterior / Dólar</option>
                    <option value="cripto">Criptoativos</option>
                    <option value="previdencia">Previdência</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Instituição / Corretora
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: XP, BTG, Nubank"
                    value={instituicao}
                    onChange={e => setInstituicao(e.target.value)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Valor Aportado (R$)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: 10000,00"
                    value={valorInvestidoStr}
                    onChange={e => setValorInvestidoStr(e.target.value)}
                    className="w-full h-11 px-3 text-sm font-semibold rounded-lg border border-slate-300 text-right"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Valor Atual (R$)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: 11500,00"
                    value={valorAtualStr}
                    onChange={e => setValorAtualStr(e.target.value)}
                    className="w-full h-11 px-3 text-sm font-semibold rounded-lg border border-slate-300 text-right"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Proventos / Dividendos no Último Mês (R$)
                </label>
                <input
                  type="text"
                  placeholder="0,00"
                  value={proventosStr}
                  onChange={e => setProventosStr(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 text-right"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <Button variante="secundario" onClick={() => setModalNovoAberto(false)} type="button">
                  Cancelar
                </Button>
                <Button variante="primario" type="submit">
                  Salvar Ativo
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
