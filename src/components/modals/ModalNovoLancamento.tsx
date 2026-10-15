import { useState } from 'react'
import { useFinanceStore } from '../../lib/store'
import { Button } from '../ui/Button'
import { X, ArrowDownRight, ArrowUpRight, ArrowLeftRight, CreditCard, Wallet, AlertCircle } from 'lucide-react'

interface Props {
  aberto: boolean
  aoFechar: () => void
  contaIdInicial?: string
  cartaoIdInicial?: string
  tipoInicial?: 'receita' | 'despesa' | 'transferencia'
}

export function ModalNovoLancamento({
  aberto,
  aoFechar,
  contaIdInicial,
  cartaoIdInicial,
  tipoInicial = 'despesa',
}: Props) {
  const { contas, cartoes, categorias, membros, adicionarLancamento } = useFinanceStore()

  const [tipo, setTipo] = useState<'receita' | 'despesa' | 'transferencia'>(tipoInicial)
  const [descricao, setDescricao] = useState('')
  const [valorStr, setValorStr] = useState('')
  const [data, setData] = useState(new Date().toISOString().slice(0, 10))
  const [status, setStatus] = useState<'pago' | 'pendente'>('pago')
  const [destinoFinanceiro, setDestinoFinanceiro] = useState<'conta' | 'cartao'>(cartaoIdInicial ? 'cartao' : 'conta')
  const [contaId, setContaId] = useState(contaIdInicial || contas[0]?.id || '')
  const [cartaoId, setCartaoId] = useState(cartaoIdInicial || cartoes[0]?.id || '')
  const [contaDestinoId, setContaDestinoId] = useState(contas[1]?.id || '')
  const [categoriaId, setCategoriaId] = useState('')
  const [membroId, setMembroId] = useState(membros[0]?.id || '')
  const [subtipoDespesa, setSubtipoDespesa] = useState<'fixo' | 'assinatura' | 'variavel' | 'ressarcimento'>('variavel')
  const [subtipoReceita, setSubtipoReceita] = useState<'salario' | 'extra' | 'investimento' | 'reembolso'>('salario')
  const [isParcelado, setIsParcelado] = useState(false)
  const [totalParcelas, setTotalParcelas] = useState(2)
  const [recorrente, setRecorrente] = useState(false)
  const [observacoes, setObservacoes] = useState('')
  const [erro, setErro] = useState('')

  if (!aberto) return null

  const categoriasFiltradas = categorias.filter(c => c.tipo === (tipo === 'transferencia' ? 'despesa' : tipo))

  // Define categoria default caso vazia
  const categoriaEfetiva = categoriaId || categoriasFiltradas[0]?.id || ''

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErro('')

    const valorLimpo = valorStr.replace(/\./g, '').replace(',', '.')
    const valorNum = parseFloat(valorLimpo)

    if (!descricao.trim()) {
      setErro('Informe uma descrição para o lançamento.')
      return
    }

    if (isNaN(valorNum) || valorNum <= 0) {
      setErro('Informe um valor monetário positivo válido.')
      return
    }

    if (tipo === 'transferencia') {
      if (!contaId || !contaDestinoId) {
        setErro('Selecione as contas de origem e destino da transferência.')
        return
      }
      if (contaId === contaDestinoId) {
        setErro('A conta de origem e destino não podem ser iguais.')
        return
      }

      adicionarLancamento({
        descricao,
        valor: valorNum,
        data,
        tipo: 'transferencia',
        status,
        categoriaId: categoriaEfetiva || 'cat-outros-desp',
        contaId,
        contaDestinoId,
        membroId,
        observacoes,
      })
    } else {
      const lancamentoDados = {
        descricao,
        valor: valorNum,
        data,
        tipo,
        status,
        categoriaId: categoriaEfetiva,
        contaId: destinoFinanceiro === 'conta' ? contaId : undefined,
        cartaoId: destinoFinanceiro === 'cartao' ? cartaoId : undefined,
        membroId,
        recorrente: tipo === 'despesa' && subtipoDespesa === 'fixo' ? true : recorrente,
        observacoes,
        subtipoDespesa: tipo === 'despesa' ? subtipoDespesa : undefined,
        subtipoReceita: tipo === 'receita' ? subtipoReceita : undefined,
      }

      if (isParcelado && totalParcelas > 1) {
        adicionarLancamento(lancamentoDados, { totalParcelas })
      } else {
        adicionarLancamento(lancamentoDados)
      }
    }

    // Limpar form e fechar
    setDescricao('')
    setValorStr('')
    setIsParcelado(false)
    setRecorrente(false)
    aoFechar()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Topo do modal */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50">
          <h2 className="text-lg font-bold text-marinho">Novo Lançamento</h2>
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tipo de transação */}
        <div className="grid grid-cols-3 gap-1 p-3 bg-slate-100/70 border-b border-slate-200">
          <button
            type="button"
            onClick={() => { setTipo('despesa'); setDestinoFinanceiro('conta'); }}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-semibold transition ${
              tipo === 'despesa'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-200/80'
            }`}
          >
            <ArrowDownRight className="h-4 w-4" /> Despesa
          </button>
          <button
            type="button"
            onClick={() => { setTipo('receita'); setDestinoFinanceiro('conta'); }}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-semibold transition ${
              tipo === 'receita'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-200/80'
            }`}
          >
            <ArrowUpRight className="h-4 w-4" /> Receita
          </button>
          <button
            type="button"
            onClick={() => { setTipo('transferencia'); setDestinoFinanceiro('conta'); }}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-semibold transition ${
              tipo === 'transferencia'
                ? 'bg-azul text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-200/80'
            }`}
          >
            <ArrowLeftRight className="h-4 w-4" /> Transferência
          </button>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {erro && (
            <div className="flex items-center gap-2 p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          {/* Valor e Descrição */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                Descrição
              </label>
              <input
                type="text"
                required
                placeholder="Ex: Supermercado, Aluguel, Salário"
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
                className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-azul focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                Valor (R$)
              </label>
              <input
                type="text"
                required
                placeholder="0,00"
                value={valorStr}
                onChange={e => setValorStr(e.target.value)}
                className="w-full h-11 px-3 text-sm font-semibold rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-azul focus:border-transparent text-right"
              />
            </div>
          </div>

          {/* Onde movimentar: Conta ou Cartão */}
          {tipo !== 'transferencia' && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                Meio de Pagamento / Movimentação
              </label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setDestinoFinanceiro('conta')}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-sm font-medium transition ${
                    destinoFinanceiro === 'conta'
                      ? 'border-azul bg-blue-50/70 text-azul'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Wallet className="h-4 w-4" /> Conta Bancária / Dinheiro
                </button>
                <button
                  type="button"
                  onClick={() => setDestinoFinanceiro('cartao')}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-sm font-medium transition ${
                    destinoFinanceiro === 'cartao'
                      ? 'border-azul bg-blue-50/70 text-azul'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <CreditCard className="h-4 w-4" /> Cartão de Crédito
                </button>
              </div>

              {destinoFinanceiro === 'conta' ? (
                <select
                  value={contaId}
                  onChange={e => setContaId(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-azul"
                >
                  {contas.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.nome} ({c.instituicao})
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  value={cartaoId}
                  onChange={e => setCartaoId(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-azul"
                >
                  {cartoes.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.nome} (Vence dia {c.diaVencimento})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Transferência entre contas */}
          {tipo === 'transferencia' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-blue-50/50 rounded-xl border border-blue-100">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Conta de Origem (Saiu de)
                </label>
                <select
                  value={contaId}
                  onChange={e => setContaId(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {contas.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Conta de Destino (Entrou em)
                </label>
                <select
                  value={contaDestinoId}
                  onChange={e => setContaDestinoId(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {contas.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Categoria e Data */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {tipo !== 'transferencia' ? (
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Categoria
                </label>
                <select
                  value={categoriaEfetiva}
                  onChange={e => setCategoriaId(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-azul"
                >
                  {categoriasFiltradas.map(cat => (
                    <option key={cat.id} value={cat.id}>
                      {cat.nome}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Membro Familiar
                </label>
                <select
                  value={membroId}
                  onChange={e => setMembroId(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {membros.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.nome} ({m.papel})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                Data
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={data}
                  onChange={e => setData(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                />
              </div>
            </div>
          </div>

          {/* Status (Pago vs Agendado/Pendente) e Membro */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                Status
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setStatus('pago')}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold border transition ${
                    status === 'pago'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  ✓ Pago / Efetivado
                </button>
                <button
                  type="button"
                  onClick={() => setStatus('pendente')}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold border transition ${
                    status === 'pendente'
                      ? 'border-amber-500 bg-amber-50 text-amber-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  ⏳ Agendado / Pendente
                </button>
              </div>
            </div>

            {tipo !== 'transferencia' && (
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Quem realizou (Família)
                </label>
                <select
                  value={membroId}
                  onChange={e => setMembroId(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {membros.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Opções Avançadas: Parcelamento e Recorrência (Ideia forte Minhas Economias) */}
          {tipo === 'despesa' && (
            <div className="pt-2 border-t border-slate-100 space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={isParcelado}
                    onChange={e => setIsParcelado(e.target.checked)}
                    className="h-4 w-4 rounded text-azul focus:ring-azul"
                  />
                  <span>Compra Parcelada (ex: 3x, 10x, 12x)</span>
                </label>
                {isParcelado && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Número de parcelas:</span>
                    <input
                      type="number"
                      min={2}
                      max={72}
                      value={totalParcelas}
                      onChange={e => setTotalParcelas(Math.max(2, parseInt(e.target.value) || 2))}
                      className="w-16 h-8 text-center text-sm font-semibold rounded border border-slate-300"
                    />
                  </div>
                )}
              </div>

              {!isParcelado && (
                <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={recorrente}
                    onChange={e => setRecorrente(e.target.checked)}
                    className="h-4 w-4 rounded text-azul focus:ring-azul"
                  />
                  <span>Despesa Fixa Mensal (Recorrente)</span>
                </label>
              )}
            </div>
          )}

          {/* Subtipo de Fluxo (Contas Fixas, Assinaturas, Apps, Ressarcimentos) */}
          {tipo === 'despesa' ? (
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                Tipo de Gasto (Aba Receitas & Gastos)
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'fixo', rotulo: 'Conta Fixa', desc: 'Aluguel, Luz, etc.' },
                  { id: 'assinatura', rotulo: 'App / Assinatura', desc: 'Streaming, Clubes' },
                  { id: 'variavel', rotulo: 'Variável', desc: 'Mercado, Compras' },
                  { id: 'ressarcimento', rotulo: 'Ressarcimento', desc: 'Reembolso pendente' },
                ].map(sub => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setSubtipoDespesa(sub.id as any)}
                    className={`p-2 rounded-lg border text-left transition ${
                      subtipoDespesa === sub.id
                        ? 'border-azul bg-blue-50/80 text-azul font-bold ring-1 ring-azul'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-xs block leading-tight">{sub.rotulo}</span>
                    <span className="text-[10px] text-slate-400 block font-normal">{sub.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : tipo === 'receita' ? (
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                Tipo de Receita
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'salario', rotulo: 'Salário', desc: 'Pró-labore mensal' },
                  { id: 'extra', rotulo: 'Renda Extra', desc: 'Freelas e bônus' },
                  { id: 'investimento', rotulo: 'Investimento', desc: 'Dividendos / Proventos' },
                  { id: 'reembolso', rotulo: 'Ressarcimento', desc: 'Reembolso recebido' },
                ].map(sub => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setSubtipoReceita(sub.id as any)}
                    className={`p-2 rounded-lg border text-left transition ${
                      subtipoReceita === sub.id
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800 font-bold ring-1 ring-emerald-600'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <span className="text-xs block leading-tight">{sub.rotulo}</span>
                    <span className="text-[10px] text-slate-400 block font-normal">{sub.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Observações (opcional)
            </label>
            <input
              type="text"
              placeholder="Ex: Nota fiscal, detalhes da compra..."
              value={observacoes}
              onChange={e => setObservacoes(e.target.value)}
              className="w-full h-10 px-3 text-sm rounded-lg border border-slate-300"
            />
          </div>

          {/* Botões de Ação */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <Button variante="secundario" onClick={aoFechar} type="button">
              Cancelar
            </Button>
            <Button variante="primario" type="submit">
              Salvar Lançamento
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
