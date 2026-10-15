import { useState } from 'react'
import { useFinanceStore, EmprestimoDivida } from '../lib/store'
import { formatBRL } from '../lib/format'
import { Button } from '../components/ui/Button'
import {
  Plus, X, ShieldAlert, Zap
} from 'lucide-react'

export default function Emprestimos() {
  const { emprestimos, contas, adicionarEmprestimo, amortizarEmprestimo, totalDividas } = useFinanceStore()
  const [modalNovoAberto, setModalNovoAberto] = useState(false)
  const [modalAmortizarAberto, setModalAmortizarAberto] = useState(false)
  const [emprestimoSelecionado, setEmprestimoSelecionado] = useState<EmprestimoDivida | null>(null)

  // Form states novo empréstimo
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState<EmprestimoDivida['tipo']>('financiamento_imovel')
  const [instituicao, setInstituicao] = useState('Caixa Econômica')
  const [saldoDevedorStr, setSaldoDevedorStr] = useState('')
  const [valorTotalStr, setValorTotalStr] = useState('')
  const [parcelasTotais, setParcelasTotais] = useState(120)
  const [parcelasPagas, setParcelasPagas] = useState(12)
  const [valorParcelaStr, setValorParcelaStr] = useState('')
  const [taxaJurosStr, setTaxaJurosStr] = useState('9.5')
  const [diaVencimento, setDiaVencimento] = useState(10)

  // Form states amortização
  const [valorAmortizarStr, setValorAmortizarStr] = useState('')
  const [contaDebitoId, setContaDebitoId] = useState(contas[0]?.id || '')

  // Simulador de Amortização
  const [valorSimulado, setValorSimulado] = useState(5000)

  const totalParcelasMensais = emprestimos.reduce((acc, e) => acc + e.valorParcela, 0)

  const handleSalvarNovo = (e: React.FormEvent) => {
    e.preventDefault()
    const saldo = parseFloat(saldoDevedorStr.replace(/\./g, '').replace(',', '.'))
    const totalOrig = parseFloat(valorTotalStr.replace(/\./g, '').replace(',', '.')) || saldo
    const parcela = parseFloat(valorParcelaStr.replace(/\./g, '').replace(',', '.'))
    const taxa = parseFloat(taxaJurosStr.replace(',', '.')) || 0

    if (isNaN(saldo) || saldo <= 0) return

    adicionarEmprestimo({
      nome,
      tipo,
      instituicao: instituicao || 'Banco',
      saldoDevedor: saldo,
      valorTotalOriginal: totalOrig,
      parcelasTotais: Number(parcelasTotais),
      parcelasPagas: Number(parcelasPagas),
      valorParcela: parcela || 0,
      taxaJurosAnual: taxa,
      diaVencimento: Number(diaVencimento),
    })

    setNome('')
    setSaldoDevedorStr('')
    setValorTotalStr('')
    setValorParcelaStr('')
    setModalNovoAberto(false)
  }

  const handleConfirmarAmortizacao = (e: React.FormEvent) => {
    e.preventDefault()
    if (!emprestimoSelecionado) return
    const valor = parseFloat(valorAmortizarStr.replace(/\./g, '').replace(',', '.'))
    if (isNaN(valor) || valor <= 0) return

    amortizarEmprestimo(emprestimoSelecionado.id, valor, contaDebitoId || undefined)
    setValorAmortizarStr('')
    setModalAmortizarAberto(false)
  }

  return (
    <div className="space-y-6">
      {/* Topo / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-rose-600" />
            <h1 className="text-2xl font-bold tracking-tight text-marinho">
              Empréstimos, Financiamentos & Dívidas
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Controle de saldo devedor, juros, parcelas e simulação de amortização antecipada
          </p>
        </div>

        <Button
          variante="primario"
          onClick={() => setModalNovoAberto(true)}
          className="flex items-center gap-1.5 shadow-sm text-xs"
        >
          <Plus className="h-4 w-4" /> + Cadastrar Financiamento
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Saldo Devedor Total
          </span>
          <p className="text-2xl font-bold text-rose-600">{formatBRL(totalDividas)}</p>
          <p className="text-xs text-slate-400">{emprestimos.length} contratos ativos</p>
        </div>

        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Parcelas Comprometidas no Mês
          </span>
          <p className="text-2xl font-bold text-slate-900">{formatBRL(totalParcelasMensais)}</p>
          <p className="text-xs text-slate-400">Custo fixo mensal de amortização</p>
        </div>

        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Estratégia Recomendada
          </span>
          <p className="text-base font-bold text-azul mt-1">Método Avalanche</p>
          <p className="text-xs text-slate-500">Amortizar primeiro a dívida de maior taxa de juros</p>
        </div>

        <div className="rounded-2xl bg-white p-5 border border-slate-200/80 shadow-sm space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Economia Potencial
          </span>
          <p className="text-2xl font-bold text-emerald-600">Até 65%</p>
          <p className="text-xs text-slate-500">Redução de juros com amortizações extraordinárias</p>
        </div>
      </div>

      {/* Simulador Interativo de Amortização (Plano Técnico) */}
      <div className="rounded-2xl bg-gradient-to-r from-blue-900 to-slate-900 text-white p-6 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-400/20 text-cyan-300 text-xs font-semibold">
              <Zap className="h-3.5 w-3.5" /> Simulador de Amortização Extraordinária
            </div>
            <h2 className="text-lg font-bold">Quanto você economiza amortizando direto no saldo devedor?</h2>
            <p className="text-xs text-slate-300 max-w-xl">
              Ao antecipar pagamentos, você abate 100% de juros futuros e diminui drasticamente o prazo do contrato.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-white/10 p-2 rounded-xl backdrop-blur">
            <span className="text-xs text-slate-300 font-medium">Aporte extra:</span>
            <input
              type="range"
              min={1000}
              max={30000}
              step={1000}
              value={valorSimulado}
              onChange={e => setValorSimulado(Number(e.target.value))}
              className="accent-cyan-400 cursor-pointer"
            />
            <span className="text-sm font-bold text-cyan-300 min-w-[90px] text-right">
              {formatBRL(valorSimulado)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-white/10 text-xs">
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <span className="text-slate-400">Parcelas Eliminadas (Estimativa):</span>
            <p className="text-lg font-bold text-white mt-0.5">
              ≈ {Math.max(2, Math.round(valorSimulado / 1800))} parcelas do final
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <span className="text-slate-400">Juros Poupados Futuros:</span>
            <p className="text-lg font-bold text-emerald-400 mt-0.5">
              ≈ {formatBRL(valorSimulado * 1.85)} economizados
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10">
            <span className="text-slate-400">Redução no Prazo Final:</span>
            <p className="text-lg font-bold text-cyan-300 mt-0.5">
              Antecipa quitação em até {Math.round(valorSimulado / 1000)} meses
            </p>
          </div>
        </div>
      </div>

      {/* Grid de Contratos de Dívida / Financiamento */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {emprestimos.map(emp => {
          const percPago = emp.parcelasTotais > 0 ? (emp.parcelasPagas / emp.parcelasTotais) * 100 : 0
          const parcelasRestantes = emp.parcelasTotais - emp.parcelasPagas

          return (
            <div
              key={emp.id}
              className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-sm space-y-4 hover:border-azul/50 transition flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{emp.nome}</h3>
                    <p className="text-xs text-slate-400">
                      {emp.instituicao} • Taxa de {emp.taxaJurosAnual}% a.a.
                    </p>
                  </div>

                  <Button
                    variante="secundario"
                    onClick={() => {
                      setEmprestimoSelecionado(emp)
                      setModalAmortizarAberto(true)
                    }}
                    className="!min-h-8 !px-3 !text-xs font-semibold text-rose-600 border-rose-200 hover:bg-rose-50"
                  >
                    Amortizar Saldo
                  </Button>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-2 text-xs">
                  <div className="flex justify-between items-baseline">
                    <span className="text-slate-500">Saldo Devedor Atual:</span>
                    <span className="text-lg font-bold text-rose-600">{formatBRL(emp.saldoDevedor)}</span>
                  </div>

                  <div className="flex justify-between items-baseline text-slate-500">
                    <span>Valor da Parcela Mensal:</span>
                    <span className="font-bold text-slate-800">{formatBRL(emp.valorParcela)} (Dia {emp.diaVencimento})</span>
                  </div>

                  <div className="flex justify-between items-baseline text-slate-500">
                    <span>Valor Original Contratado:</span>
                    <span>{formatBRL(emp.valorTotalOriginal)}</span>
                  </div>
                </div>

                {/* Progresso de Pagamento das Parcelas */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Progresso: {emp.parcelasPagas} de {emp.parcelasTotais} parcelas</span>
                    <span className="font-bold text-azul">{percPago.toFixed(0)}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="h-full bg-azul transition-all duration-300"
                      style={{ width: `${percPago}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400">Restam {parcelasRestantes} parcelas</p>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>Vencimento todo dia {emp.diaVencimento}</span>
                <span className="text-rose-600 font-semibold">Financiamento Ativo</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modal Novo Empréstimo */}
      {modalNovoAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50">
              <h2 className="text-base font-bold text-marinho">Cadastrar Financiamento ou Dívida</h2>
              <button
                type="button"
                onClick={() => setModalNovoAberto(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSalvarNovo} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Identificação do Financiamento
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Financiamento Apartamento, Empréstimo Reforma"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Tipo de Contrato
                  </label>
                  <select
                    value={tipo}
                    onChange={e => setTipo(e.target.value as any)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="financiamento_imovel">Imobiliário</option>
                    <option value="financiamento_veiculo">Veículo</option>
                    <option value="consignado">Consignado</option>
                    <option value="emprestimo_pessoal">Empréstimo Pessoal</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Instituição Credora
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Caixa, Itaú, Santander"
                    value={instituicao}
                    onChange={e => setInstituicao(e.target.value)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Saldo Devedor Atual (R$)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: 250000,00"
                    value={saldoDevedorStr}
                    onChange={e => setSaldoDevedorStr(e.target.value)}
                    className="w-full h-11 px-3 text-sm font-semibold rounded-lg border border-slate-300 text-right"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Valor da Parcela (R$)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: 2200,00"
                    value={valorParcelaStr}
                    onChange={e => setValorParcelaStr(e.target.value)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 text-right font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Parcelas Totais
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={parcelasTotais}
                    onChange={e => setParcelasTotais(Number(e.target.value))}
                    className="w-full h-10 px-2 text-center text-xs rounded-lg border border-slate-300"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Já Pagas
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={parcelasPagas}
                    onChange={e => setParcelasPagas(Number(e.target.value))}
                    className="w-full h-10 px-2 text-center text-xs rounded-lg border border-slate-300"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Taxa Juros (% a.a.)
                  </label>
                  <input
                    type="text"
                    value={taxaJurosStr}
                    onChange={e => setTaxaJurosStr(e.target.value)}
                    className="w-full h-10 px-2 text-center text-xs rounded-lg border border-slate-300"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Dia Vencimento
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={diaVencimento}
                    onChange={e => setDiaVencimento(Number(e.target.value) || 1)}
                    className="w-full h-10 px-2 text-center text-xs rounded-lg border border-slate-300"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <Button variante="secundario" onClick={() => setModalNovoAberto(false)} type="button">
                  Cancelar
                </Button>
                <Button variante="primario" type="submit">
                  Salvar Financiamento
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Amortizar Saldo Devedor */}
      {modalAmortizarAberto && emprestimoSelecionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50">
              <h2 className="text-base font-bold text-marinho">Amortizar Dívida Antecipadamente</h2>
              <button
                type="button"
                onClick={() => setModalAmortizarAberto(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmarAmortizacao} className="p-6 space-y-4">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                <p className="text-xs text-slate-500 font-medium">Contrato</p>
                <p className="text-sm font-bold text-slate-900">{emprestimoSelecionado.nome}</p>
                <div className="flex justify-between text-xs text-slate-600 pt-1">
                  <span>Saldo devedor atual:</span>
                  <span className="font-bold text-rose-600">{formatBRL(emprestimoSelecionado.saldoDevedor)}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Conta para Débito do Valor
                </label>
                <select
                  value={contaDebitoId}
                  onChange={e => setContaDebitoId(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {contas.map(c => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Valor da Amortização Extraordinária (R$)
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: 5000,00"
                  value={valorAmortizarStr}
                  onChange={e => setValorAmortizarStr(e.target.value)}
                  className="w-full h-11 px-3 text-sm font-semibold rounded-lg border border-slate-300 text-right"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <Button variante="secundario" onClick={() => setModalAmortizarAberto(false)} type="button">
                  Cancelar
                </Button>
                <Button variante="primario" type="submit">
                  Confirmar Amortização
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
