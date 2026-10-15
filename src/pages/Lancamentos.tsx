import { useState, useMemo } from 'react'
import { useFinanceStore } from '../lib/store'
import { formatBRL, formatMonth, currentMonth } from '../lib/format'
import { Button } from '../components/ui/Button'
import { ModalNovoLancamento } from '../components/modals/ModalNovoLancamento'
import { ModalImportarExtrato } from '../components/modals/ModalImportarExtrato'
import { BancoLogo, BandeiraCartaoLogo } from '../components/ui/BancoLogo'
import {
  Plus, UploadCloud, Download, Search, CheckCircle2, Clock, Trash2,
  Filter, ChevronLeft, ChevronRight, ArrowLeftRight, Repeat
} from 'lucide-react'

export default function Lancamentos() {
  const {
    lancamentos,
    contas,
    cartoes,
    categorias,
    membros,
    toggleStatusLancamento,
    excluirLancamento,
  } = useFinanceStore()

  const [mesSelecionado, setMesSelecionado] = useState(currentMonth())
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState<'todos' | 'receita' | 'despesa' | 'transferencia'>('todos')
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'pago' | 'pendente'>('todos')
  const [filtroConta, setFiltroConta] = useState<string>('todos')
  const [filtroMembro, setFiltroMembro] = useState<string>('todos')

  const [modalNovoAberto, setModalNovoAberto] = useState(false)
  const [modalImportarAberto, setModalImportarAberto] = useState(false)

  // Mudança de mês
  const mudarMes = (delta: number) => {
    const [ano, mes] = mesSelecionado.split('-').map(Number)
    const d = new Date(ano, mes - 1 + delta, 1)
    const novoAno = d.getFullYear()
    const novoMes = String(d.getMonth() + 1).padStart(2, '0')
    setMesSelecionado(`${novoAno}-${novoMes}`)
  }

  // Filtragem
  const lancamentosFiltrados = useMemo(() => {
    return lancamentos.filter(l => {
      // Filtro de mês
      if (!l.data.startsWith(mesSelecionado)) return false

      // Busca por texto
      if (busca.trim()) {
        const termo = busca.toLowerCase()
        const cat = categorias.find(c => c.id === l.categoriaId)?.nome.toLowerCase() || ''
        const desc = l.descricao.toLowerCase()
        const obs = (l.observacoes || '').toLowerCase()
        if (!desc.includes(termo) && !cat.includes(termo) && !obs.includes(termo)) return false
      }

      // Filtro de tipo
      if (filtroTipo !== 'todos' && l.tipo !== filtroTipo) return false

      // Filtro de status
      if (filtroStatus !== 'todos' && l.status !== filtroStatus) return false

      // Filtro de conta/cartão
      if (filtroConta !== 'todos') {
        if (filtroConta.startsWith('cartao-')) {
          if (l.cartaoId !== filtroConta) return false
        } else {
          if (l.contaId !== filtroConta && l.contaDestinoId !== filtroConta) return false
        }
      }

      // Filtro de membro
      if (filtroMembro !== 'todos' && l.membroId !== filtroMembro) return false

      return true
    }).sort((a, b) => b.data.localeCompare(a.data))
  }, [lancamentos, mesSelecionado, busca, filtroTipo, filtroStatus, filtroConta, filtroMembro, categorias])

  // Cálculos do extrato filtrado
  const resumo = useMemo(() => {
    let receitas = 0
    let despesas = 0

    lancamentosFiltrados.forEach(l => {
      if (l.tipo === 'receita') receitas += l.valor
      else if (l.tipo === 'despesa') despesas += l.valor
    })

    return {
      receitas,
      despesas,
      saldo: receitas - despesas,
    }
  }, [lancamentosFiltrados])

  // Exportar para CSV
  const exportarCSV = () => {
    const cabecalho = 'Data,Descrição,Tipo,Valor,Status,Categoria,Conta/Cartão,Membro\n'
    const linhas = lancamentosFiltrados.map(l => {
      const cat = categorias.find(c => c.id === l.categoriaId)?.nome || ''
      const conta = contas.find(c => c.id === l.contaId)?.nome || ''
      const cartao = cartoes.find(c => c.id === l.cartaoId)?.nome || ''
      const membro = membros.find(m => m.id === l.membroId)?.nome || ''
      const meio = cartao ? `Cartão ${cartao}` : conta
      return `"${l.data}","${l.descricao.replace(/"/g, '""')}","${l.tipo}","${l.valor.toFixed(2)}","${l.status}","${cat}","${meio}","${membro}"`
    }).join('\n')

    const blob = new Blob([cabecalho + linhas], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `tudo-azul-extrato-${mesSelecionado}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="space-y-6">
      {/* Topo / Barra de Ações */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-marinho">Lançamentos & Extrato</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Gerencie todas as receitas, despesas, parcelamentos e transferências
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variante="secundario"
            onClick={() => setModalImportarAberto(true)}
            className="flex items-center gap-1.5 shadow-sm text-xs"
          >
            <UploadCloud className="h-4 w-4 text-azul" /> Importar Extrato
          </Button>

          <Button
            variante="secundario"
            onClick={exportarCSV}
            className="flex items-center gap-1.5 shadow-sm text-xs"
          >
            <Download className="h-4 w-4" /> Exportar CSV
          </Button>

          <Button
            variante="primario"
            onClick={() => setModalNovoAberto(true)}
            className="flex items-center gap-1.5 shadow-sm text-xs"
          >
            <Plus className="h-4 w-4" /> Novo Lançamento
          </Button>
        </div>
      </div>

      {/* Navegação de Mês & Barra de Resumo */}
      <div className="rounded-2xl bg-white p-4 border border-slate-200/80 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Seletor Mês */}
        <div className="flex items-center rounded-xl bg-slate-50 border border-slate-200 p-1">
          <button
            type="button"
            onClick={() => mudarMes(-1)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 transition"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="px-3 text-xs font-bold text-marinho capitalize min-w-[130px] text-center">
            {formatMonth(mesSelecionado)}
          </span>
          <button
            type="button"
            onClick={() => mudarMes(1)}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200 transition"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Resumo do Extrato */}
        <div className="flex items-center gap-6 text-sm divide-x divide-slate-200">
          <div>
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Receitas</span>
            <p className="text-sm font-bold text-emerald-600">{formatBRL(resumo.receitas)}</p>
          </div>
          <div className="pl-6">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Despesas</span>
            <p className="text-sm font-bold text-rose-600">{formatBRL(resumo.despesas)}</p>
          </div>
          <div className="pl-6">
            <span className="text-[11px] font-semibold text-slate-500 uppercase">Balanço do Mês</span>
            <p className={`text-sm font-bold ${resumo.saldo >= 0 ? 'text-azul' : 'text-rose-600'}`}>
              {formatBRL(resumo.saldo)}
            </p>
          </div>
        </div>
      </div>

      {/* Filtros Avançados */}
      <div className="rounded-2xl bg-white p-4 border border-slate-200/80 shadow-sm space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
          {/* Busca por texto */}
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar por descrição ou categoria..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="w-full h-10 pl-9 pr-3 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-azul"
            />
          </div>

          {/* Tipo */}
          <div>
            <select
              value={filtroTipo}
              onChange={e => setFiltroTipo(e.target.value as any)}
              className="w-full h-10 px-2.5 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="todos">Todos os tipos</option>
              <option value="despesa">Apenas Despesas</option>
              <option value="receita">Apenas Receitas</option>
              <option value="transferencia">Transferências</option>
            </select>
          </div>

          {/* Conta / Cartão */}
          <div>
            <select
              value={filtroConta}
              onChange={e => setFiltroConta(e.target.value)}
              className="w-full h-10 px-2.5 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="todos">Todas as contas & cartões</option>
              <optgroup label="Contas Bancárias">
                {contas.map(c => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </optgroup>
              <optgroup label="Cartões de Crédito">
                {cartoes.map(card => (
                  <option key={card.id} value={card.id}>{card.nome}</option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Membro Familiar */}
          <div>
            <select
              value={filtroMembro}
              onChange={e => setFiltroMembro(e.target.value)}
              className="w-full h-10 px-2.5 text-xs rounded-lg border border-slate-300 bg-white"
            >
              <option value="todos">Toda a família</option>
              {membros.map(m => (
                <option key={m.id} value={m.id}>{m.nome}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Status rápido pills */}
        <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
          <span className="text-xs text-slate-500 font-medium">Status:</span>
          <button
            type="button"
            onClick={() => setFiltroStatus('todos')}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold transition ${
              filtroStatus === 'todos' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Todos ({lancamentosFiltrados.length})
          </button>
          <button
            type="button"
            onClick={() => setFiltroStatus('pago')}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold transition ${
              filtroStatus === 'pago' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Pagos / Realizados
          </button>
          <button
            type="button"
            onClick={() => setFiltroStatus('pendente')}
            className={`px-2.5 py-1 rounded-full text-xs font-semibold transition ${
              filtroStatus === 'pendente' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Pendentes / Agendados
          </button>
        </div>
      </div>

      {/* Tabela de Lançamentos */}
      <div className="rounded-2xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
        {lancamentosFiltrados.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Filter className="h-10 w-10 text-slate-300 mx-auto" />
            <h3 className="text-base font-bold text-slate-700">Nenhum lançamento encontrado</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Não encontramos movimentações para os filtros ou período selecionado.
            </p>
            <Button
              variante="secundario"
              onClick={() => {
                setBusca('')
                setFiltroTipo('todos')
                setFiltroStatus('todos')
                setFiltroConta('todos')
                setFiltroMembro('todos')
              }}
              className="text-xs"
            >
              Limpar Filtros
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 w-10">Status</th>
                  <th className="py-3 px-4">Data</th>
                  <th className="py-3 px-4">Descrição</th>
                  <th className="py-3 px-4">Categoria</th>
                  <th className="py-3 px-4">Conta / Cartão</th>
                  <th className="py-3 px-4">Membro</th>
                  <th className="py-3 px-4 text-right">Valor</th>
                  <th className="py-3 px-4 text-center w-12">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lancamentosFiltrados.map(l => {
                  const cat = categorias.find(c => c.id === l.categoriaId)
                  const conta = contas.find(c => c.id === l.contaId)
                  const cartao = cartoes.find(c => c.id === l.cartaoId)
                  const membro = membros.find(m => m.id === l.membroId)

                  return (
                    <tr key={l.id} className="hover:bg-slate-50/70 transition">
                      {/* Check de Status */}
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => toggleStatusLancamento(l.id)}
                          title={l.status === 'pago' ? 'Marcar como pendente' : 'Marcar como pago'}
                          className={`h-6 w-6 rounded-full flex items-center justify-center transition ${
                            l.status === 'pago'
                              ? 'bg-emerald-100 text-emerald-600 hover:bg-emerald-200'
                              : 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                          }`}
                        >
                          {l.status === 'pago' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                        </button>
                      </td>

                      {/* Data */}
                      <td className="py-3 px-4 whitespace-nowrap text-xs text-slate-600 font-medium">
                        {l.data}
                      </td>

                      {/* Descrição + Badges de Parcelamento/Recorrência */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-900">{l.descricao}</span>
                          {l.parcelaAtual && l.totalParcelas && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-azul">
                              {l.parcelaAtual}/{l.totalParcelas}
                            </span>
                          )}
                          {l.recorrente && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600" title="Despesa Recorrente">
                              <Repeat className="h-3 w-3" /> Fixa
                            </span>
                          )}
                        </div>
                        {l.observacoes && (
                          <p className="text-[11px] text-slate-400 mt-0.5">{l.observacoes}</p>
                        )}
                      </td>

                      {/* Categoria */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                          style={{
                            backgroundColor: `${cat?.cor || '#3b82f6'}15`,
                            color: cat?.cor || '#3b82f6',
                          }}
                        >
                          {cat?.nome || 'Geral'}
                        </span>
                      </td>

                      {/* Conta / Cartão */}
                      <td className="py-3 px-4 whitespace-nowrap text-xs text-slate-600">
                        {cartao ? (
                          <div className="flex items-center gap-1.5 font-medium text-slate-800">
                            <BancoLogo banco={cartao.nome} tamanho="sm" />
                            <span>{cartao.nome}</span>
                            <BandeiraCartaoLogo bandeira={cartao.bandeira} />
                          </div>
                        ) : conta ? (
                          <div className="flex items-center gap-1.5 font-medium text-slate-700">
                            <BancoLogo banco={conta.instituicao || conta.nome} tamanho="sm" />
                            <span>{conta.nome}</span>
                          </div>
                        ) : (
                          <span className="flex items-center gap-1 text-blue-600">
                            <ArrowLeftRight className="h-3.5 w-3.5" /> Transferência
                          </span>
                        )}
                      </td>

                      {/* Membro Familiar */}
                      <td className="py-3 px-4 whitespace-nowrap text-xs text-slate-600">
                        {membro ? (
                          <span className="inline-flex items-center gap-1">
                            <span className="h-5 w-5 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold flex items-center justify-center">
                              {membro.avatar}
                            </span>
                            <span className="text-xs">{membro.nome.split(' ')[0]}</span>
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>

                      {/* Valor */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <span
                          className={`font-bold tabular-nums ${
                            l.tipo === 'receita'
                              ? 'text-emerald-600'
                              : l.tipo === 'transferencia'
                              ? 'text-blue-600'
                              : 'text-rose-600'
                          }`}
                        >
                          {l.tipo === 'receita' ? '+' : l.tipo === 'despesa' ? '-' : ''} {formatBRL(l.valor)}
                        </span>
                      </td>

                      {/* Ações */}
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Deseja excluir "${l.descricao}"?`)) {
                              excluirLancamento(l.id)
                            }
                          }}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                          title="Excluir lançamento"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modais */}
      <ModalNovoLancamento
        aberto={modalNovoAberto}
        aoFechar={() => setModalNovoAberto(false)}
      />

      <ModalImportarExtrato
        aberto={modalImportarAberto}
        aoFechar={() => setModalImportarAberto(false)}
      />
    </div>
  )
}
