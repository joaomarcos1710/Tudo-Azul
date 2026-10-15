import { useState } from 'react'
import { useFinanceStore } from '../../lib/store'
import { Button } from '../ui/Button'
import { X, CreditCard, Receipt, AlertCircle } from 'lucide-react'
import { BancoLogo } from '../ui/BancoLogo'

interface Props {
  aberto: boolean
  aoFechar: () => void
  tipoPredefinido?: 'cartao' | 'carne'
}

export function ModalNovoParcelamento({
  aberto,
  aoFechar,
  tipoPredefinido = 'cartao',
}: Props) {
  const { cartoes, contas, categorias, membros, adicionarParcelamento } = useFinanceStore()

  const [tipoParcelamento, setTipoParcelamento] = useState<'cartao' | 'carne'>(tipoPredefinido)
  const [descricao, setDescricao] = useState('')
  const [modoValor, setModoValor] = useState<'parcela' | 'total'>('parcela')
  const [valorStr, setValorStr] = useState('')
  const [totalParcelas, setTotalParcelas] = useState(6)
  const [parcelaAtual, setParcelaAtual] = useState(1)
  const [primeiroVencimento, setPrimeiroVencimento] = useState(
    new Date().toISOString().slice(0, 10)
  )
  const [cartaoId, setCartaoId] = useState(cartoes[0]?.id || '')
  const [contaId, setContaId] = useState(contas[0]?.id || '')
  const [categoriaId, setCategoriaId] = useState('cat-compras')
  const [membroId, setMembroId] = useState(membros[0]?.id || '')
  const [observacoes, setObservacoes] = useState('')
  const [erro, setErro] = useState('')

  if (!aberto) return null

  const valorNum = parseFloat(valorStr.replace(/\./g, '').replace(',', '.')) || 0

  const valorPorParcela =
    modoValor === 'parcela'
      ? valorNum
      : totalParcelas > 0
      ? valorNum / totalParcelas
      : 0

  const valorTotalCalculado =
    modoValor === 'total'
      ? valorNum
      : valorNum * totalParcelas

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setErro('')

    if (!descricao.trim()) {
      setErro('Informe uma descrição da compra parcelada.')
      return
    }

    if (valorPorParcela <= 0) {
      setErro('Informe um valor de parcela válido maior que zero.')
      return
    }

    if (totalParcelas < 2) {
      setErro('O número total de parcelas deve ser de no mínimo 2.')
      return
    }

    if (parcelaAtual < 1 || parcelaAtual > totalParcelas) {
      setErro('A parcela inicial deve estar entre 1 e o total de parcelas.')
      return
    }

    if (tipoParcelamento === 'cartao' && !cartaoId) {
      setErro('Selecione o cartão de crédito do parcelamento.')
      return
    }

    adicionarParcelamento({
      descricao: descricao.trim(),
      valorParcela: Math.round(valorPorParcela * 100) / 100,
      totalParcelas,
      parcelaInicial: parcelaAtual,
      primeiroVencimento,
      tipoParcelamento,
      cartaoId: tipoParcelamento === 'cartao' ? cartaoId : undefined,
      contaId: tipoParcelamento === 'carne' ? contaId : undefined,
      categoriaId: categoriaId || 'cat-compras',
      membroId,
      observacoes: observacoes.trim() || undefined,
    })

    // Limpar formulário
    setDescricao('')
    setValorStr('')
    setTotalParcelas(6)
    setParcelaAtual(1)
    setObservacoes('')
    aoFechar()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-100 overflow-hidden max-h-[92vh] flex flex-col">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Novo Parcelamento</h2>
            <p className="text-xs text-slate-500">
              Cadastre compras parceladas em cartão ou carnês / crediários
            </p>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Formulário com rolagem se necessário */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {erro && (
            <div className="flex items-center gap-2 p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{erro}</span>
            </div>
          )}

          {/* Seletor Tipo: Cartão de Crédito vs Carnê */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Tipo de Parcelamento
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTipoParcelamento('cartao')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold transition ${
                  tipoParcelamento === 'cartao'
                    ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-sm'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <CreditCard className="h-4 w-4" />
                Cartão de Crédito
              </button>

              <button
                type="button"
                onClick={() => setTipoParcelamento('carne')}
                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold transition ${
                  tipoParcelamento === 'carne'
                    ? 'bg-amber-50 border-amber-600 text-amber-800 shadow-sm'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Receipt className="h-4 w-4" />
                Carnê / Crediário / Boleto
              </button>
            </div>
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Nome da Compra / Bem Parcelado
            </label>
            <input
              type="text"
              required
              placeholder={
                tipoParcelamento === 'cartao'
                  ? 'Ex: Smartphone Galaxy, Geladeira Frost Free'
                  : 'Ex: Carnê Casas Bahia - Sofá Retrátil, Crediário Ótica'
              }
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Modo de valor & Valor */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Valor
              </label>
              <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                <button
                  type="button"
                  onClick={() => setModoValor('parcela')}
                  className={`px-2 py-0.5 rounded-lg transition ${
                    modoValor === 'parcela'
                      ? 'bg-slate-800 text-white font-bold'
                      : 'hover:bg-slate-100'
                  }`}
                >
                  Por Parcela
                </button>
                <button
                  type="button"
                  onClick={() => setModoValor('total')}
                  className={`px-2 py-0.5 rounded-lg transition ${
                    modoValor === 'total'
                      ? 'bg-slate-800 text-white font-bold'
                      : 'hover:bg-slate-100'
                  }`}
                >
                  Valor Total
                </button>
              </div>
            </div>

            <div className="relative">
              <span className="absolute left-3.5 top-2.5 text-slate-400 font-bold text-sm">
                R$
              </span>
              <input
                type="text"
                required
                placeholder="0,00"
                value={valorStr}
                onChange={(e) => setValorStr(e.target.value)}
                className="w-full rounded-xl border border-slate-300 pl-10 pr-4 py-2.5 text-base font-bold text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {valorNum > 0 && (
              <p className="text-[11px] text-slate-500 font-medium">
                {modoValor === 'parcela' ? (
                  <>
                    Total da compra: <strong className="text-slate-800">R$ {valorTotalCalculado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong> ({totalParcelas}x de R$ {valorNum.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})
                  </>
                ) : (
                  <>
                    Valor por parcela: <strong className="text-slate-800">R$ {valorPorParcela.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong> em {totalParcelas}x
                  </>
                )}
              </p>
            )}
          </div>

          {/* Parcelas: Total e Parcela Atual */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Total de Parcelas
              </label>
              <select
                value={totalParcelas}
                onChange={(e) => setTotalParcelas(Number(e.target.value))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-800 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                {[2, 3, 4, 5, 6, 8, 10, 12, 18, 24, 36, 48].map((n) => (
                  <option key={n} value={n}>
                    {n} vezes ({n}x)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Parcela Atual
              </label>
              <input
                type="number"
                min={1}
                max={totalParcelas}
                value={parcelaAtual}
                onChange={(e) => setParcelaAtual(Math.max(1, Math.min(totalParcelas, Number(e.target.value))))}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-semibold text-slate-800 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          {/* Vencimento da 1ª Parcela */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Data de Vencimento / Fechamento
            </label>
            <div className="relative">
              <input
                type="date"
                required
                value={primeiroVencimento}
                onChange={(e) => setPrimeiroVencimento(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          {/* Seletor Cartão ou Conta */}
          {tipoParcelamento === 'cartao' ? (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Cartão de Crédito
              </label>
              <div className="space-y-2">
                {cartoes.map((c) => (
                  <label
                    key={c.id}
                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition ${
                      cartaoId === c.id
                        ? 'border-blue-600 bg-blue-50/50 shadow-sm'
                        : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <BancoLogo banco={c.nome} tamanho="sm" />
                      <div>
                        <div className="font-bold text-xs text-slate-900">{c.nome}</div>
                        <div className="text-[10px] text-slate-500 capitalize">
                          {c.bandeira} • Fecha dia {c.diaFechamento} / Vence dia {c.diaVencimento}
                        </div>
                      </div>
                    </div>
                    <input
                      type="radio"
                      name="cartaoId"
                      value={c.id}
                      checked={cartaoId === c.id}
                      onChange={() => setCartaoId(c.id)}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Conta para Débito / Pagamento do Boleto
              </label>
              <select
                value={contaId}
                onChange={(e) => setContaId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} ({c.instituicao})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Categoria e Membro */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Categoria
              </label>
              <select
                value={categoriaId}
                onChange={(e) => setCategoriaId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-xs font-medium focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                {categorias
                  .filter((c) => c.tipo === 'despesa')
                  .map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.nome}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Responsável
              </label>
              <select
                value={membroId}
                onChange={(e) => setMembroId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-xs font-medium focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                {membros.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Observações (Opcional)
            </label>
            <input
              type="text"
              placeholder="Ex: Nota fiscal, loja onde comprou, garantia"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-xs focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Botões */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <Button
              type="button"
              variante="secundario"
              onClick={aoFechar}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button type="submit" variante="primario" className="text-xs font-bold">
              Cadastrar Parcelamento
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
