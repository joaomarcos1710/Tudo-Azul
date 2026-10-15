import { useState } from 'react'
import { useFinanceStore, Categoria } from '../lib/store'
import { Button } from '../components/ui/Button'
import {
  Tag, Plus, X, TrendingUp,
  Edit2, Trash2, Check
} from 'lucide-react'

const PALETA_CORES_EXPANDIDA = [
  // Azuis e Cianos
  '#2563EB', '#3B82F6', '#60A5FA', '#0284C7', '#06B6D4', '#0891B2',
  // Verdes e Esmeraldas
  '#10B981', '#059669', '#047857', '#14B8A6', '#0D9488', '#84CC16',
  // Amarelos, Âmbar e Laranjas
  '#F59E0B', '#D97706', '#F97316', '#EA580C', '#EAB308', '#CA8A04',
  // Vermelhos e Rosas
  '#EF4444', '#DC2626', '#F43F5E', '#E11D48', '#EC4899', '#DB2777',
  // Roxos e Violetas
  '#8B5CF6', '#7C3AED', '#6366F1', '#4F46E5', '#A855F7', '#9333EA',
  // Marinhos, Neutros e Especiais Fintech
  '#820AD1', '#002D62', '#102A43', '#475569', '#64748B', '#0F172A',
]

export default function Categorias() {
  const {
    categorias,
    lancamentos,
    adicionarCategoria,
    editarCategoria,
    excluirCategoria,
  } = useFinanceStore()

  const [modalAberto, setModalAberto] = useState(false)
  const [categoriaEditando, setCategoriaEditando] = useState<Categoria | null>(null)
  const [filtroTipo, setFiltroTipo] = useState<'todas' | 'despesa' | 'receita'>('todas')

  // Form states
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<'despesa' | 'receita'>('despesa')
  const [classificacao, setClassificacao] = useState<'essencial' | 'estilo_vida' | 'investimento'>('essencial')
  const [cor, setCor] = useState('#2563EB')

  const abrirModalCriacao = () => {
    setCategoriaEditando(null)
    setNome('')
    setTipo('despesa')
    setClassificacao('essencial')
    setCor('#2563EB')
    setModalAberto(true)
  }

  const abrirModalEdicao = (cat: Categoria) => {
    setCategoriaEditando(cat)
    setNome(cat.nome)
    setTipo(cat.tipo)
    setClassificacao(cat.classificacao)
    setCor(cat.cor)
    setModalAberto(true)
  }

  const handleSalvar = (e: React.FormEvent) => {
    e.preventDefault()
    if (!nome.trim()) return

    if (categoriaEditando) {
      editarCategoria(categoriaEditando.id, {
        nome: nome.trim(),
        tipo,
        classificacao: tipo === 'despesa' ? classificacao : 'essencial',
        cor,
      })
    } else {
      adicionarCategoria({
        nome: nome.trim(),
        icone: 'Tag',
        tipo,
        classificacao: tipo === 'despesa' ? classificacao : 'essencial',
        cor,
      })
    }

    setModalAberto(false)
  }

  const handleExcluir = (id: string, nomeCat: string) => {
    const qtd = lancamentos.filter(l => l.categoriaId === id).length
    const msg = qtd > 0
      ? `A categoria "${nomeCat}" possui ${qtd} lançamentos vinculados. Deseja realmente excluí-la?`
      : `Deseja excluir a categoria "${nomeCat}"?`
    if (confirm(msg)) {
      excluirCategoria(id)
    }
  }

  const contarUso = (catId: string) => {
    return lancamentos.filter(l => l.categoriaId === catId).length
  }

  const categoriasFiltradas = categorias.filter(c => {
    if (filtroTipo === 'despesa') return c.tipo === 'despesa'
    if (filtroTipo === 'receita') return c.tipo === 'receita'
    return true
  })

  // Contagens para os 3 pilares 50-30-20
  const qtdEssencial = categorias.filter(c => c.tipo === 'despesa' && c.classificacao === 'essencial').length
  const qtdEstiloVida = categorias.filter(c => c.tipo === 'despesa' && c.classificacao === 'estilo_vida').length
  const qtdInvestimento = categorias.filter(c => c.tipo === 'despesa' && c.classificacao === 'investimento').length

  const getClassificacaoBadge = (classif: Categoria['classificacao']) => {
    switch (classif) {
      case 'essencial':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            50% Essencial
          </span>
        )
      case 'estilo_vida':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200">
            30% Estilo de Vida
          </span>
        )
      case 'investimento':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            20% Investimentos & Metas
          </span>
        )
    }
  }

  return (
    <div className="space-y-6">
      {/* Topo / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-marinho">Categorias & Regra 50-30-20</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Classifique gastos entre Essenciais (50%), Estilo de Vida (30%) e Poupança/Investimentos (20%)
          </p>
        </div>

        <Button
          variante="primario"
          onClick={abrirModalCriacao}
          className="flex items-center gap-1.5 shadow-sm text-xs"
        >
          <Plus className="h-4 w-4" /> Nova Categoria
        </Button>
      </div>

      {/* Banner Explicativo e Indicadores da Regra 50-30-20 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-gradient-to-br from-blue-50/80 to-white border border-blue-100 p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-700">50% • Necessidades</span>
            <span className="h-6 w-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">
              {qtdEssencial}
            </span>
          </div>
          <p className="text-xs text-slate-600">
            Moradia, alimentação básica, saúde, transporte, contas fixas essenciais.
          </p>
        </div>

        <div className="rounded-2xl bg-gradient-to-br from-purple-50/80 to-white border border-purple-100 p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-purple-700">30% • Estilo de Vida</span>
            <span className="h-6 w-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center">
              {qtdEstiloVida}
            </span>
          </div>
          <p className="text-xs text-slate-600">
            Lazer, restaurantes, viagens, assinaturas e compras de conveniência.
          </p>
        </div>

        <div className="rounded-2xl bg-gradient-to-br from-emerald-50/80 to-white border border-emerald-100 p-4 shadow-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">20% • Metas & Futuro</span>
            <span className="h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center justify-center">
              {qtdInvestimento}
            </span>
          </div>
          <p className="text-xs text-slate-600">
            Reserva de emergência, aportes, previdência privada e amortização de dívidas.
          </p>
        </div>
      </div>

      {/* Barra de Filtros */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100/80 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setFiltroTipo('todas')}
            className={`px-3 py-1.5 rounded-lg transition ${
              filtroTipo === 'todas' ? 'bg-white text-marinho shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Todas ({categorias.length})
          </button>
          <button
            type="button"
            onClick={() => setFiltroTipo('despesa')}
            className={`px-3 py-1.5 rounded-lg transition ${
              filtroTipo === 'despesa' ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Despesas ({categorias.filter(c => c.tipo === 'despesa').length})
          </button>
          <button
            type="button"
            onClick={() => setFiltroTipo('receita')}
            className={`px-3 py-1.5 rounded-lg transition ${
              filtroTipo === 'receita' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Receitas ({categorias.filter(c => c.tipo === 'receita').length})
          </button>
        </div>

        <span className="text-xs text-slate-500 hidden sm:inline">
          {categoriasFiltradas.length} categorias cadastradas
        </span>
      </div>

      {/* Grid de Categorias */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {categoriasFiltradas.map(cat => {
          const qtd = contarUso(cat.id)
          return (
            <div
              key={cat.id}
              className="rounded-2xl bg-white border border-slate-200/80 p-4 shadow-sm hover:border-azul/50 transition flex flex-col justify-between gap-3 group"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold shrink-0 shadow-sm"
                    style={{ backgroundColor: cat.cor }}
                  >
                    {cat.tipo === 'receita' ? (
                      <TrendingUp className="h-5 w-5" />
                    ) : (
                      <Tag className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-900 truncate" title={cat.nome}>
                      {cat.nome}
                    </h3>
                    <div className="mt-0.5">
                      {cat.tipo === 'receita' ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Receita
                        </span>
                      ) : (
                        getClassificacaoBadge(cat.classificacao)
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition">
                  <button
                    type="button"
                    onClick={() => abrirModalEdicao(cat)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-azul hover:bg-slate-100 transition"
                    title="Editar categoria"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleExcluir(cat.id, cat.nome)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                    title="Excluir categoria"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                <span>{qtd} {qtd === 1 ? 'lançamento' : 'lançamentos'}</span>
                <div className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cat.cor }} />
                  <span className="font-mono text-[10px]">{cat.cor.toUpperCase()}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal Nova / Editar Categoria */}
      {modalAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50">
              <h2 className="text-base font-bold text-marinho">
                {categoriaEditando ? 'Editar Categoria' : 'Nova Categoria'}
              </h2>
              <button
                type="button"
                onClick={() => setModalAberto(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSalvar} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Nome da Categoria
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Streaming, Combustível, Pets, Cursos"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 focus:border-azul focus:ring-1 focus:ring-azul"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Tipo de Fluxo
                  </label>
                  <select
                    value={tipo}
                    onChange={e => setTipo(e.target.value as any)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="despesa">Despesa (Saída)</option>
                    <option value="receita">Receita (Entrada)</option>
                  </select>
                </div>

                {tipo === 'despesa' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                      Classificação Regra 50-30-20
                    </label>
                    <select
                      value={classificacao}
                      onChange={e => setClassificacao(e.target.value as any)}
                      className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white font-medium"
                    >
                      <option value="essencial">50% - Necessidades & Essencial</option>
                      <option value="estilo_vida">30% - Estilo de Vida & Desejos</option>
                      <option value="investimento">20% - Poupança, Metas & Investimentos</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Seletor Ampliado de Cores */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                    Cor da Categoria ({PALETA_CORES_EXPANDIDA.length} opções + personalizada)
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500 font-mono">{cor}</span>
                    <label className="relative cursor-pointer inline-flex items-center justify-center h-6 w-6 rounded-md border border-slate-300 shadow-xs overflow-hidden" title="Escolher cor personalizada">
                      <input
                        type="color"
                        value={cor}
                        onChange={e => setCor(e.target.value)}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <span className="w-full h-full" style={{ backgroundColor: cor }} />
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-8 sm:grid-cols-10 gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  {PALETA_CORES_EXPANDIDA.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCor(c)}
                      className={`h-7 w-7 rounded-lg border-2 transition flex items-center justify-center relative ${
                        cor.toLowerCase() === c.toLowerCase()
                          ? 'border-slate-900 scale-110 shadow-md ring-2 ring-azul/40'
                          : 'border-white/50 hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                      title={c}
                    >
                      {cor.toLowerCase() === c.toLowerCase() && (
                        <Check className="h-3.5 w-3.5 text-white drop-shadow" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center gap-3">
                <div
                  className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-bold"
                  style={{ backgroundColor: cor }}
                >
                  <Tag className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Prévia da Categoria</p>
                  <p className="text-sm font-bold text-slate-800">{nome || 'Nome da Categoria'}</p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <Button variante="secundario" onClick={() => setModalAberto(false)} type="button">
                  Cancelar
                </Button>
                <Button variante="primario" type="submit">
                  {categoriaEditando ? 'Salvar Alterações' : 'Criar Categoria'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
