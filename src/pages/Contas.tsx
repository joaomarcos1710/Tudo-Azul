import { useState } from 'react'
import { useFinanceStore, CartaoCredito } from '../lib/store'
import { formatBRL, currentMonth } from '../lib/format'
import { Button } from '../components/ui/Button'
import { ModalPagarFatura } from '../components/modals/ModalPagarFatura'
import {
  BancoLogo, BandeiraCartaoLogo, MoedaBadge,
  LISTA_BANCOS_BRASIL
} from '../components/ui/BancoLogo'
import { Wallet, CreditCard, X, Trash2 } from 'lucide-react'

export default function Contas() {
  const {
    contas,
    cartoes,
    saldoTotalContas,
    calcularSaldoConta,
    calcularSaldoContaEmBRL,
    calcularFaturaCartao,
    adicionarConta,
    excluirConta,
    adicionarCartao,
  } = useFinanceStore()

  const [mesAtual] = useState(currentMonth())
  const [modalNovaContaAberto, setModalNovaContaAberto] = useState(false)
  const [modalNovoCartaoAberto, setModalNovoCartaoAberto] = useState(false)
  const [modalFaturaAberto, setModalFaturaAberto] = useState(false)
  const [cartaoSelecionado, setCartaoSelecionado] = useState<CartaoCredito | null>(null)

  // Estados para nova conta
  const [bancoSelecionadoId, setBancoSelecionadoId] = useState<string>('nubank')
  const [nomeConta, setNomeConta] = useState('')
  const [instituicao, setInstituicao] = useState('Nubank')
  const [tipoConta, setTipoConta] = useState<'corrente' | 'poupanca' | 'investimento' | 'dinheiro'>('corrente')
  const [moedaConta, setMoedaConta] = useState<'BRL' | 'USD' | 'EUR'>('BRL')
  const [cotacaoStr, setCotacaoStr] = useState('1')
  const [saldoInicialStr, setSaldoInicialStr] = useState('')
  const [corConta, setCorConta] = useState('#820AD1')

  // Estados para novo cartão
  const [nomeCartao, setNomeCartao] = useState('')
  const [bandeira, setBandeira] = useState<'visa' | 'mastercard' | 'elo' | 'amex'>('visa')
  const [limiteTotalStr, setLimiteTotalStr] = useState('')
  const [diaFechamento, setDiaFechamento] = useState(5)
  const [diaVencimento, setDiaVencimento] = useState(12)
  const [corCartao, setCorCartao] = useState('#820AD1')

  const aoSelecionarBanco = (bancoId: string) => {
    setBancoSelecionadoId(bancoId)
    const banco = LISTA_BANCOS_BRASIL.find(b => b.id === bancoId)
    if (banco) {
      setInstituicao(banco.nomeCurto)
      if (!nomeConta || nomeConta === 'Conta Corrente' || LISTA_BANCOS_BRASIL.some(b => b.nomeCurto === nomeConta)) {
        setNomeConta(`${banco.nomeCurto} Conta`)
      }
      setCorConta(banco.cor)
      setMoedaConta(banco.moedaPadrao)
      if (banco.moedaPadrao === 'USD') setCotacaoStr('5.65')
      else if (banco.moedaPadrao === 'EUR') setCotacaoStr('6.15')
      else setCotacaoStr('1')
    }
  }

  const handleCriarConta = (e: React.FormEvent) => {
    e.preventDefault()
    const valor = parseFloat(saldoInicialStr.replace(/\./g, '').replace(',', '.')) || 0
    const cotacao = parseFloat(cotacaoStr.replace(',', '.')) || 1
    const bancoInfo = LISTA_BANCOS_BRASIL.find(b => b.id === bancoSelecionadoId)

    adicionarConta({
      nome: nomeConta || instituicao,
      instituicao: instituicao || nomeConta,
      tipo: tipoConta,
      saldoInicial: valor,
      cor: corConta,
      ativa: true,
      moeda: moedaConta,
      cotacao,
      codigoBanco: bancoInfo?.codigo !== '000' && bancoInfo?.codigo !== 'ESP' ? bancoInfo?.codigo : undefined,
    })

    setNomeConta('')
    setInstituicao('')
    setSaldoInicialStr('')
    setModalNovaContaAberto(false)
  }

  const handleCriarCartao = (e: React.FormEvent) => {
    e.preventDefault()
    const limite = parseFloat(limiteTotalStr.replace(/\./g, '').replace(',', '.')) || 0
    adicionarCartao({
      nome: nomeCartao,
      bandeira,
      limiteTotal: limite,
      diaFechamento: Number(diaFechamento),
      diaVencimento: Number(diaVencimento),
      cor: corCartao,
    })
    setNomeCartao('')
    setLimiteTotalStr('')
    setModalNovoCartaoAberto(false)
  }

  const handleExcluirConta = (contaId: string, nome: string) => {
    if (confirm(`Deseja realmente remover a conta "${nome}"?`)) {
      excluirConta(contaId)
    }
  }

  return (
    <div className="space-y-8">
      {/* Topo / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-marinho">Contas & Cartões de Crédito</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Gerencie contas correntes, contas internacionais (Dólar/Euro), carteiras e faturas
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variante="secundario"
            onClick={() => setModalNovoCartaoAberto(true)}
            className="flex items-center gap-1.5 shadow-sm text-xs"
          >
            <CreditCard className="h-4 w-4 text-purple-600" /> + Novo Cartão
          </Button>

          <Button
            variante="primario"
            onClick={() => setModalNovaContaAberto(true)}
            className="flex items-center gap-1.5 shadow-sm text-xs"
          >
            <Wallet className="h-4 w-4" /> + Nova Conta
          </Button>
        </div>
      </div>

      {/* Seção 1: Contas Bancárias (Uma embaixo da outra) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-azul" />
            <h2 className="text-lg font-bold text-marinho">Contas Bancárias & Carteiras (Lista Vertical)</h2>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-500">Saldo Consolidado em Reais: </span>
            <span className="text-base font-bold text-azul">{formatBRL(saldoTotalContas)}</span>
          </div>
        </div>

        {/* LISTA VERTICAL: UMA CONTA EMBAIXO DA OUTRA */}
        <div className="space-y-3">
          {contas.map(conta => {
            const saldoOriginal = calcularSaldoConta(conta.id)
            const saldoBRL = calcularSaldoContaEmBRL(conta.id)
            const moeda = conta.moeda || 'BRL'
            const isEstrangeira = moeda === 'USD' || moeda === 'EUR'
            const cotacao = conta.cotacao || (moeda === 'USD' ? 5.65 : moeda === 'EUR' ? 6.15 : 1)

            return (
              <div
                key={conta.id}
                className="rounded-2xl bg-white border border-slate-200/80 p-5 shadow-sm hover:border-azul/50 transition flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                {/* Lado Esquerdo: Logo do Banco, Instituição e Tipo */}
                <div className="flex items-center gap-3.5 min-w-0">
                  <BancoLogo banco={conta.instituicao || conta.nome} tamanho="xl" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-slate-900 truncate">{conta.nome}</h3>
                      <MoedaBadge moeda={moeda} />
                      <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {conta.tipo}
                      </span>
                    </div>

                    <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                      <span>{conta.instituicao}</span>
                      {conta.codigoBanco && (
                        <>
                          <span>•</span>
                          <span className="font-mono text-[11px] font-medium text-slate-600">
                            COMPE Febraban: {conta.codigoBanco}
                          </span>
                        </>
                      )}
                      {isEstrangeira && (
                        <>
                          <span>•</span>
                          <span className="text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded">
                            Cotação: R$ {cotacao.toFixed(2)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Lado Direito: Saldos e Ações */}
                <div className="flex items-center justify-between md:justify-end gap-6 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100">
                  <div className="text-left md:text-right">
                    {isEstrangeira ? (
                      <div>
                        <div className="text-lg font-bold text-slate-900">
                          {moeda === 'USD' ? '$' : '€'} {saldoOriginal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} {moeda}
                        </div>
                        <div className="text-xs font-semibold text-slate-500">
                          Equivalente a <strong className="text-azul">{formatBRL(saldoBRL)}</strong>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-lg font-bold text-slate-900">
                          {formatBRL(saldoOriginal)}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Saldo inicial: {formatBRL(conta.saldoInicial)}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleExcluirConta(conta.id, conta.nome)}
                      className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                      title="Excluir conta"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Banner de Cartões com Textura Fintech Wave */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-800 bg-[#071326] text-white shadow-xl p-6">
        <img
          src="/src/assets/images/fintech_wave_bg_1791936218093.jpg"
          alt="Fintech wave background"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover opacity-45 mix-blend-screen pointer-events-none"
        />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4 backdrop-blur-[1px]">
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              Gestão de Cartões & Crédito
            </span>
            <h2 className="text-lg md:text-xl font-bold">Controle Central de Limites & Faturas</h2>
            <p className="text-xs text-slate-300 max-w-lg">
              Visualize dias de fechamento, melhor data de compras e liquide faturas diretamente da conta corrente.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variante="primario"
              onClick={() => setModalNovoCartaoAberto(true)}
              className="!text-xs !min-h-9 !bg-cyan-500 hover:!bg-cyan-600 text-slate-950 font-bold shadow-md shadow-cyan-500/20"
            >
              + Adicionar Novo Cartão
            </Button>
          </div>
        </div>
      </div>

      {/* Seção 2: Cartões de Crédito */}
      <div className="space-y-4 pt-2">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-purple-600" />
            <h2 className="text-lg font-bold text-marinho">Cartões de Crédito Cadastrados</h2>
          </div>
          <span className="text-xs text-slate-500">
            Faturas em aberto não alteram o saldo bancário até o pagamento
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {cartoes.map(cartao => {
            const fatura = calcularFaturaCartao(cartao.id, mesAtual)
            const limiteDisponivel = Math.max(0, cartao.limiteTotal - fatura)
            const perc = (fatura / cartao.limiteTotal) * 100

            return (
              <div
                key={cartao.id}
                className="rounded-2xl bg-white border border-slate-200/80 p-6 shadow-sm space-y-5"
              >
                {/* Cabeçalho do Cartão */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <BancoLogo banco={cartao.nome} tamanho="lg" />
                    <div>
                      <h3 className="text-base font-bold text-slate-900">{cartao.nome}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <BandeiraCartaoLogo bandeira={cartao.bandeira} />
                        <span className="text-[11px] text-slate-400">Cartão de Crédito</span>
                      </div>
                    </div>
                  </div>

                  <Button
                    variante="secundario"
                    onClick={() => {
                      setCartaoSelecionado(cartao)
                      setModalFaturaAberto(true)
                    }}
                    className="!min-h-9 !px-3.5 !text-xs font-semibold text-azul"
                  >
                    Pagar Fatura
                  </Button>
                </div>

                {/* Ciclo de Fatura */}
                <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs">
                  <div>
                    <span className="text-slate-500">Dia de Fechamento:</span>
                    <p className="font-bold text-slate-800">Todo dia {cartao.diaFechamento}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Vencimento da Fatura:</span>
                    <p className="font-bold text-slate-800">Todo dia {cartao.diaVencimento}</p>
                  </div>
                </div>

                {/* Métricas de Limite */}
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-slate-500">
                      Fatura Atual: <strong className="text-rose-600 text-sm">{formatBRL(fatura)}</strong>
                    </span>
                    <span className="text-slate-500">
                      Limite Livre: <strong className="text-slate-700">{formatBRL(limiteDisponivel)}</strong>
                    </span>
                  </div>

                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        perc > 85 ? 'bg-rose-500' : perc > 60 ? 'bg-amber-500' : 'bg-azul'
                      }`}
                      style={{ width: `${Math.min(100, perc)}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                    <span>{perc.toFixed(1)}% do limite utilizado</span>
                    <span>Limite total: {formatBRL(cartao.limiteTotal)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Modal Criar Conta com Catálogo Bancos Brasil (lecdt.com/libs/bancos-brasil) */}
      {modalNovaContaAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50">
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-azul" />
                <h2 className="text-base font-bold text-marinho">Nova Conta Bancária</h2>
              </div>
              <button
                type="button"
                onClick={() => setModalNovaContaAberto(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCriarConta} className="p-6 space-y-4 overflow-y-auto">
              {/* Seletor Rápido de Instituição (Bancos Brasil) */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Selecione o Banco / Instituição (Catálogo Oficial Brasil & Exterior)
                </label>
                <select
                  value={bancoSelecionadoId}
                  onChange={e => aoSelecionarBanco(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white font-medium"
                >
                  {LISTA_BANCOS_BRASIL.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.nomeCurto} {b.codigo !== '000' && b.codigo !== 'ESP' ? `(COMPE ${b.codigo})` : ''} - {b.moedaPadrao}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Nome / Apelido da Conta
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Nubank Principal, Nomad Conta Dólar"
                  value={nomeConta}
                  onChange={e => setNomeConta(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Tipo de Conta
                  </label>
                  <select
                    value={tipoConta}
                    onChange={e => setTipoConta(e.target.value as any)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="corrente">Conta Corrente</option>
                    <option value="poupanca">Poupança</option>
                    <option value="investimento">Investimentos</option>
                    <option value="dinheiro">Carteira / Dinheiro</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Moeda da Conta
                  </label>
                  <select
                    value={moedaConta}
                    onChange={e => {
                      const novaMoeda = e.target.value as 'BRL' | 'USD' | 'EUR'
                      setMoedaConta(novaMoeda)
                      if (novaMoeda === 'USD') setCotacaoStr('5.65')
                      else if (novaMoeda === 'EUR') setCotacaoStr('6.15')
                      else setCotacaoStr('1')
                    }}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white font-bold"
                  >
                    <option value="BRL">🇧🇷 Real Brasileiro (BRL)</option>
                    <option value="USD">🇺🇸 Dólar Americano (USD)</option>
                    <option value="EUR">🇪🇺 Euro (EUR)</option>
                  </select>
                </div>
              </div>

              {/* Se for moeda estrangeira, campo de cotação */}
              {moedaConta !== 'BRL' && (
                <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200/80 space-y-1">
                  <label className="block text-xs font-bold text-blue-900 uppercase tracking-wider">
                    Cotação de Conversão em Reais (R$)
                  </label>
                  <input
                    type="text"
                    value={cotacaoStr}
                    onChange={e => setCotacaoStr(e.target.value)}
                    placeholder="Ex: 5.65"
                    className="w-full h-10 px-3 text-sm rounded-lg border border-blue-300 bg-white font-bold text-blue-950"
                  />
                  <p className="text-[11px] text-blue-700">
                    O saldo desta conta será convertido para calcular seu patrimônio consolidado.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Saldo Inicial ({moedaConta === 'USD' ? '$ USD' : moedaConta === 'EUR' ? '€ EUR' : 'R$ BRL'})
                </label>
                <input
                  type="text"
                  placeholder="0,00"
                  value={saldoInicialStr}
                  onChange={e => setSaldoInicialStr(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 text-right font-bold text-marinho"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Cor de Identificação
                </label>
                <div className="flex items-center gap-2">
                  {['#820AD1', '#EC7000', '#002D62', '#005CA9', '#FF7A00', '#FFD400', '#9FE870', '#10B981', '#2563EB'].map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCorConta(c)}
                      className={`h-7 w-7 rounded-full border-2 transition ${
                        corConta === c ? 'border-marinho scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <Button variante="secundario" onClick={() => setModalNovaContaAberto(false)} type="button">
                  Cancelar
                </Button>
                <Button variante="primario" type="submit">
                  Salvar Conta
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Criar Cartão */}
      {modalNovoCartaoAberto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50">
              <h2 className="text-base font-bold text-marinho">Novo Cartão de Crédito</h2>
              <button
                type="button"
                onClick={() => setModalNovoCartaoAberto(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCriarCartao} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Nome do Cartão
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Nubank Mastercard Black, XP Visa Infinite"
                  value={nomeCartao}
                  onChange={e => setNomeCartao(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Bandeira
                  </label>
                  <select
                    value={bandeira}
                    onChange={e => setBandeira(e.target.value as any)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="visa">Visa</option>
                    <option value="mastercard">Mastercard</option>
                    <option value="elo">Elo</option>
                    <option value="amex">American Express</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Limite Total (R$)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: 10000,00"
                    value={limiteTotalStr}
                    onChange={e => setLimiteTotalStr(e.target.value)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 text-right font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                    Dia Fechamento
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={diaFechamento}
                    onChange={e => setDiaFechamento(parseInt(e.target.value) || 1)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 text-center font-bold"
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
                    onChange={e => setDiaVencimento(parseInt(e.target.value) || 1)}
                    className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 text-center font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Cor do Cartão
                </label>
                <div className="flex items-center gap-2">
                  {['#820AD1', '#002D62', '#10B981', '#EC7000', '#2563EB', '#1F2937'].map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCorCartao(c)}
                      className={`h-7 w-7 rounded-full border-2 transition ${
                        corCartao === c ? 'border-marinho scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <Button variante="secundario" onClick={() => setModalNovoCartaoAberto(false)} type="button">
                  Cancelar
                </Button>
                <Button variante="primario" type="submit">
                  Salvar Cartão
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Pagar Fatura */}
      <ModalPagarFatura
        aberto={modalFaturaAberto}
        aoFechar={() => setModalFaturaAberto(false)}
        cartao={cartaoSelecionado}
        mesAtual={mesAtual}
      />
    </div>
  )
}
