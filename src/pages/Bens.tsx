import { useState } from 'react'
import { useFinanceStore, BemPatrimonial } from '../lib/store'
import { formatBRL, formatDate } from '../lib/format'
import { Button } from '../components/ui/Button'
import {
  Home, Car, LandPlot, Plus, Trash2, X,
  Building2
} from 'lucide-react'

export default function Bens() {
  const { bens, adicionarBem, excluirBem, totalBensPatrimoniais } = useFinanceStore()
  const [modalNovoAberto, setModalNovoAberto] = useState(false)

  // Form states
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<'imovel' | 'veiculo' | 'terreno' | 'outro'>('imovel')
  const [valorMercadoStr, setValorMercadoStr] = useState('')
  const [valorCompraStr, setValorCompraStr] = useState('')
  const [dataAquisicao, setDataAquisicao] = useState(new Date().toISOString().slice(0, 10))
  const [quitado, setQuitado] = useState(true)
  const [observacoes, setObservacoes] = useState('')

  // Totais por tipo
  const totalImoveis = bens
    .filter(b => b.tipo === 'imovel' || b.tipo === 'terreno')
    .reduce((acc, b) => acc + b.valorMercado, 0)

  const totalVeiculos = bens
    .filter(b => b.tipo === 'veiculo')
    .reduce((acc, b) => acc + b.valorMercado, 0)

  const totalCustoCompra = bens.reduce((acc, b) => acc + b.valorCompra, 0)
  const valorizacaoGeral = totalBensPatrimoniais - totalCustoCompra

  const handleSalvar = (e: React.FormEvent) => {
    e.preventDefault()
    const valorMercado = parseFloat(valorMercadoStr.replace(/\./g, '').replace(',', '.'))
    const valorCompra = parseFloat(valorCompraStr.replace(/\./g, '').replace(',', '.')) || valorMercado

    if (isNaN(valorMercado) || valorMercado <= 0) return

    adicionarBem({
      nome,
      tipo,
      valorMercado,
      valorCompra,
      dataAquisicao,
      quitado,
      observacoes,
    })

    setNome('')
    setValorMercadoStr('')
    setValorCompraStr('')
    setObservacoes('')
    setModalNovoAberto(false)
  }

  const getIcone = (tipoBem: BemPatrimonial['tipo']) => {
    switch (tipoBem) {
      case 'imovel':
        return <Home className="h-5 w-5 text-blue-600" />
      case 'veiculo':
        return <Car className="h-5 w-5 text-amber-600" />
      case 'terreno':
        return <LandPlot className="h-5 w-5 text-emerald-600" />
      default:
        return <Building2 className="h-5 w-5 text-purple-600" />
    }
  }

  return (
    <div className="space-y-6">
      {/* Topo / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="h-6 w-6 text-azul" />
            <h1 className="text-2xl font-bold tracking-tight text-marinho">
              Meus Bens & Patrimônio Físico
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Cadastre imóveis, veículos, terrenos e acompanhe a valorização patrimonial da família
          </p>
        </div>

        <Button
          variante="primario"
          onClick={() => setModalNovoAberto(true)}
          className="flex items-center gap-1.5 shadow-sm text-xs"
        >
          <Plus className="h-4 w-4" /> + Cadastrar Bem
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Total em Bens
          </span>
          <p className="text-2xl font-bold text-marinho">{formatBRL(totalBensPatrimoniais)}</p>
          <p className="text-xs text-slate-400">{bens.length} itens cadastrados</p>
        </div>

        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Imóveis & Terrenos
          </span>
          <p className="text-2xl font-bold text-blue-600">{formatBRL(totalImoveis)}</p>
          <p className="text-xs text-slate-400">Patrimônio imobiliário</p>
        </div>

        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Veículos & Frotas
          </span>
          <p className="text-2xl font-bold text-amber-600">{formatBRL(totalVeiculos)}</p>
          <p className="text-xs text-slate-400">Carros, motos e utilitários</p>
        </div>

        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Ganho de Capital
          </span>
          <p className={`text-2xl font-bold ${valorizacaoGeral >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {valorizacaoGeral >= 0 ? '+' : ''}{formatBRL(valorizacaoGeral)}
          </p>
          <p className="text-xs text-slate-400">Valor de mercado vs. Compra</p>
        </div>
      </div>

      {/* Grid de Bens */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {bens.map(bem => {
          const valorizacao = bem.valorMercado - bem.valorCompra
          const percValorizacao = bem.valorCompra > 0 ? (valorizacao / bem.valorCompra) * 100 : 0

          return (
            <div
              key={bem.id}
              className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-sm space-y-4 hover:border-azul/50 transition flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center">
                      {getIcone(bem.tipo)}
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900">{bem.nome}</h3>
                      <p className="text-xs text-slate-400 capitalize">
                        {bem.tipo} • Adquirido em {formatDate(bem.dataAquisicao)}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Deseja remover "${bem.nome}"?`)) {
                        excluirBem(bem.id)
                      }
                    }}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                    title="Remover bem"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                {bem.observacoes && (
                  <p className="text-xs text-slate-600 line-clamp-2">{bem.observacoes}</p>
                )}

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-2 text-xs">
                  <div className="flex justify-between items-baseline">
                    <span className="text-slate-500">Valor de Mercado Atual:</span>
                    <span className="text-base font-bold text-slate-900">{formatBRL(bem.valorMercado)}</span>
                  </div>

                  <div className="flex justify-between items-baseline text-slate-500">
                    <span>Valor Pago na Aquisição:</span>
                    <span>{formatBRL(bem.valorCompra)}</span>
                  </div>

                  <div className="flex justify-between items-baseline pt-1 border-t border-slate-200/60">
                    <span className="text-slate-500">Valorização / Variação:</span>
                    <span className={`font-semibold ${valorizacao >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {valorizacao >= 0 ? '+' : ''}{formatBRL(valorizacao)} ({percValorizacao.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="text-slate-400">Status financeiro:</span>
                <span className={`inline-flex items-center gap-1 font-semibold ${
                  bem.quitado ? 'text-emerald-600' : 'text-amber-600'
                }`}>
                  {bem.quitado ? '✓ Totalmente Quitado' : '⚠ Financiamento Ativo'}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal Novo Bem */}
      {modalNovoAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50">
              <h2 className="text-base font-bold text-marinho">Cadastrar Novo Bem</h2>
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
                  Nome do Bem
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Apartamento Jardins, Honda Civic 2021"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Tipo de Bem
                  </label>
                  <select
                    value={tipo}
                    onChange={e => setTipo(e.target.value as any)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="imovel">Imóvel</option>
                    <option value="veiculo">Veículo / Carro</option>
                    <option value="terreno">Terreno</option>
                    <option value="outro">Outro Patrimônio</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Data de Aquisição
                  </label>
                  <input
                    type="date"
                    value={dataAquisicao}
                    onChange={e => setDataAquisicao(e.target.value)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Valor de Mercado (R$)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: 500000,00"
                    value={valorMercadoStr}
                    onChange={e => setValorMercadoStr(e.target.value)}
                    className="w-full h-11 px-3 text-sm font-semibold rounded-lg border border-slate-300 text-right"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Valor de Compra (R$)
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: 420000,00"
                    value={valorCompraStr}
                    onChange={e => setValorCompraStr(e.target.value)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 text-right"
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700 pt-1">
                  <input
                    type="checkbox"
                    checked={quitado}
                    onChange={e => setQuitado(e.target.checked)}
                    className="h-4 w-4 rounded text-azul focus:ring-azul"
                  />
                  <span>O bem já está 100% quitado (sem dívida pendente)</span>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Observações (opcional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Ex: Bairro, quilometragem, documentação..."
                  value={observacoes}
                  onChange={e => setObservacoes(e.target.value)}
                  className="w-full p-2.5 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <Button variante="secundario" onClick={() => setModalNovoAberto(false)} type="button">
                  Cancelar
                </Button>
                <Button variante="primario" type="submit">
                  Salvar Bem
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
