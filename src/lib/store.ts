import { useState, useEffect } from 'react'

export interface Conta {
  id: string
  nome: string
  tipo: 'corrente' | 'poupanca' | 'investimento' | 'dinheiro'
  instituicao: string
  saldoInicial: number
  cor: string
  ativa: boolean
  moeda?: 'BRL' | 'USD' | 'EUR'
  cotacao?: number // ex: 5.65 para USD, 6.15 para EUR
  codigoBanco?: string
}

export interface CartaoCredito {
  id: string
  nome: string
  bandeira: 'visa' | 'mastercard' | 'elo' | 'amex'
  limiteTotal: number
  diaFechamento: number
  diaVencimento: number
  cor: string
  contaPadraoDebitoId?: string
}

export interface Categoria {
  id: string
  nome: string
  icone: string
  cor: string
  tipo: 'despesa' | 'receita'
  classificacao: 'essencial' | 'estilo_vida' | 'investimento' // As 3 regras do 50-30-20
}

export interface Lancamento {
  id: string
  descricao: string
  valor: number
  data: string // YYYY-MM-DD
  tipo: 'receita' | 'despesa' | 'transferencia'
  status: 'pago' | 'pendente'
  categoriaId: string
  contaId?: string // para conta corrente / dinheiro
  cartaoId?: string // se foi no cartão de crédito
  contaDestinoId?: string // para transferências
  membroId?: string
  parcelaAtual?: number
  totalParcelas?: number
  grupoParcelamentoId?: string
  tipoParcelamento?: 'cartao' | 'carne' | 'boleto'
  recorrente?: boolean
  observacoes?: string
  subtipoDespesa?: 'fixo' | 'assinatura' | 'variavel' | 'ressarcimento'
  subtipoReceita?: 'salario' | 'extra' | 'investimento' | 'reembolso'
}

export interface Orcamento {
  id: string
  mes: string // YYYY-MM
  categoriaId: string
  limite: number
}

export interface AporteMeta {
  id: string
  data: string
  valor: number
  contaId?: string
  nota?: string
}

export interface MetaSonho {
  id: string
  titulo: string
  icone: string
  valorAlvo: number
  valorAtual: number
  dataAlvo: string // YYYY-MM-DD
  cor: string
  descricao?: string
  historicoAportes: AporteMeta[]
}

export interface MembroFamilia {
  id: string
  nome: string
  papel: 'Administrador' | 'Membro' | 'Dependente'
  avatar: string
  email?: string
}

export interface BemPatrimonial {
  id: string
  nome: string
  tipo: 'imovel' | 'veiculo' | 'terreno' | 'outro'
  valorMercado: number
  valorCompra: number
  dataAquisicao: string
  quitado: boolean
  observacoes?: string
}

export interface Investimento {
  id: string
  nome: string
  classe: 'renda_fixa' | 'acoes' | 'fiis' | 'cripto' | 'previdencia' | 'exterior'
  instituicao: string
  valorInvestido: number
  valorAtual: number
  rendimentoTotal: number
  proventosUltimoMes: number
}

export interface EmprestimoDivida {
  id: string
  nome: string
  tipo: 'financiamento_imovel' | 'financiamento_veiculo' | 'emprestimo_pessoal' | 'consignado' | 'outro'
  instituicao: string
  saldoDevedor: number
  valorTotalOriginal: number
  parcelasTotais: number
  parcelasPagas: number
  valorParcela: number
  taxaJurosAnual: number
  diaVencimento: number
}

export interface EstadoFinanceiro {
  contas: Conta[]
  cartoes: CartaoCredito[]
  categorias: Categoria[]
  lancamentos: Lancamento[]
  orcamentos: Orcamento[]
  metas: MetaSonho[]
  membros: MembroFamilia[]
  bens: BemPatrimonial[]
  investimentos: Investimento[]
  emprestimos: EmprestimoDivida[]
}

const CATEGORIAS_PADRAO: Categoria[] = [
  // 50% - Essenciais
  { id: 'cat-moradia', nome: 'Moradia & Aluguel', icone: 'Home', cor: '#3B82F6', tipo: 'despesa', classificacao: 'essencial' },
  { id: 'cat-alimentacao', nome: 'Alimentação & Mercado', icone: 'ShoppingCart', cor: '#10B981', tipo: 'despesa', classificacao: 'essencial' },
  { id: 'cat-transporte', nome: 'Transporte & Carro', icone: 'Car', cor: '#F59E0B', tipo: 'despesa', classificacao: 'essencial' },
  { id: 'cat-saude', nome: 'Saúde & Farmácia', icone: 'HeartPulse', cor: '#EF4444', tipo: 'despesa', classificacao: 'essencial' },
  { id: 'cat-educacao', nome: 'Educação & Cursos', icone: 'GraduationCap', cor: '#8B5CF6', tipo: 'despesa', classificacao: 'essencial' },

  // 30% - Estilo de Vida & Lazer
  { id: 'cat-lazer', nome: 'Lazer & Restaurantes', icone: 'Utensils', cor: '#EC4899', tipo: 'despesa', classificacao: 'estilo_vida' },
  { id: 'cat-compras', nome: 'Compras & Vestuário', icone: 'ShoppingBag', cor: '#6366F1', tipo: 'despesa', classificacao: 'estilo_vida' },
  { id: 'cat-servicos', nome: 'Assinaturas & Apps', icone: 'Tv', cor: '#06B6D4', tipo: 'despesa', classificacao: 'estilo_vida' },
  { id: 'cat-outros-desp', nome: 'Outras Despesas', icone: 'Layers', cor: '#64748B', tipo: 'despesa', classificacao: 'estilo_vida' },

  // 20% - Poupança & Investimentos
  { id: 'cat-reserva-aporte', nome: 'Reserva & Aportes', icone: 'ShieldCheck', cor: '#14B8A6', tipo: 'despesa', classificacao: 'investimento' },
  { id: 'cat-previdencia', nome: 'Previdência & Futuro', icone: 'Lock', cor: '#0D9488', tipo: 'despesa', classificacao: 'investimento' },

  // Receitas
  { id: 'cat-salario', nome: 'Salário & Remuneração', icone: 'Briefcase', cor: '#10B981', tipo: 'receita', classificacao: 'essencial' },
  { id: 'cat-rendimentos', nome: 'Dividendos & Proventos', icone: 'TrendingUp', cor: '#059669', tipo: 'receita', classificacao: 'investimento' },
  { id: 'cat-extra', nome: 'Renda Extra & Freela', icone: 'Coins', cor: '#34D399', tipo: 'receita', classificacao: 'estilo_vida' },
  { id: 'cat-reembolso', nome: 'Ressarcimentos & Reembolsos', icone: 'RotateCcw', cor: '#0284C7', tipo: 'receita', classificacao: 'essencial' },
  { id: 'cat-outros-rec', nome: 'Outras Receitas', icone: 'PlusCircle', cor: '#22C55E', tipo: 'receita', classificacao: 'essencial' },
]

const MEMBROS_PADRAO: MembroFamilia[] = [
  { id: 'membro-1', nome: 'João Marcos', papel: 'Administrador', avatar: 'JM', email: 'joaomarcos1710@gmail.com' },
  { id: 'membro-2', nome: 'Mariana Silva', papel: 'Membro', avatar: 'MS', email: 'mariana@exemplo.com' },
  { id: 'membro-3', nome: 'Filhos (Educação)', papel: 'Dependente', avatar: 'FE' },
]

const CONTAS_PADRAO: Conta[] = [
  { id: 'conta-nubank', nome: 'Nubank Conta', tipo: 'corrente', instituicao: 'Nubank', codigoBanco: '260', saldoInicial: 4250.80, cor: '#820AD1', ativa: true, moeda: 'BRL', cotacao: 1 },
  { id: 'conta-itau', nome: 'Itaú Personalité', tipo: 'corrente', instituicao: 'Itaú', codigoBanco: '341', saldoInicial: 8920.00, cor: '#EC7000', ativa: true, moeda: 'BRL', cotacao: 1 },
  { id: 'conta-dinheiro', nome: 'Carteira Física', tipo: 'dinheiro', instituicao: 'Dinheiro', saldoInicial: 350.00, cor: '#10B981', ativa: true, moeda: 'BRL', cotacao: 1 },
  { id: 'conta-reserva', nome: 'Tesouro / CDB Reserva', tipo: 'investimento', instituicao: 'XP Investimentos', codigoBanco: '102', saldoInicial: 25400.00, cor: '#002D62', ativa: true, moeda: 'BRL', cotacao: 1 },
  // Contas Internacionais em Dólar e Euro solicitadas pelo usuário
  { id: 'conta-nomad', nome: 'Nomad Global (Conta Dólar)', tipo: 'corrente', instituicao: 'Nomad', saldoInicial: 3450.00, cor: '#FFD400', ativa: true, moeda: 'USD', cotacao: 5.65 },
  { id: 'conta-wise', nome: 'Wise Multi-currency (Euro)', tipo: 'corrente', instituicao: 'Wise', saldoInicial: 1280.00, cor: '#9FE870', ativa: true, moeda: 'EUR', cotacao: 6.15 },
]

const CARTOES_PADRAO: CartaoCredito[] = [
  { id: 'cartao-nu', nome: 'Nubank Ultravioleta', bandeira: 'mastercard', limiteTotal: 15000, diaFechamento: 5, diaVencimento: 12, cor: '#820AD1', contaPadraoDebitoId: 'conta-nubank' },
  { id: 'cartao-xp', nome: 'XP Visa Infinite', bandeira: 'visa', limiteTotal: 25000, diaFechamento: 20, diaVencimento: 28, cor: '#002D62', contaPadraoDebitoId: 'conta-itau' },
]

const hoje = new Date()
const anoAtual = hoje.getFullYear()
const mesNum = String(hoje.getMonth() + 1).padStart(2, '0')
const mesAtualStr = `${anoAtual}-${mesNum}`

const LANCAMENTOS_PADRAO: Lancamento[] = [
  // Receitas do mês
  { id: 'lanc-1', descricao: 'Salário Mensal', valor: 8500.00, data: `${mesAtualStr}-05`, tipo: 'receita', status: 'pago', categoriaId: 'cat-salario', contaId: 'conta-itau', membroId: 'membro-1', subtipoReceita: 'salario' },
  { id: 'lanc-2', descricao: 'Salário Mensal', valor: 6200.00, data: `${mesAtualStr}-05`, tipo: 'receita', status: 'pago', categoriaId: 'cat-salario', contaId: 'conta-nubank', membroId: 'membro-2', subtipoReceita: 'salario' },
  { id: 'lanc-3', descricao: 'Rendimento de FIIs / Dividendos', valor: 345.50, data: `${mesAtualStr}-15`, tipo: 'receita', status: 'pago', categoriaId: 'cat-rendimentos', contaId: 'conta-reserva', membroId: 'membro-1', subtipoReceita: 'investimento' },
  { id: 'lanc-4', descricao: 'Projeto Consultoria Extra', valor: 1800.00, data: `${mesAtualStr}-25`, tipo: 'receita', status: 'pendente', categoriaId: 'cat-extra', contaId: 'conta-nubank', membroId: 'membro-1', subtipoReceita: 'extra' },
  { id: 'lanc-reemb', descricao: 'Ressarcimento Viagem Corporativa', valor: 650.00, data: `${mesAtualStr}-18`, tipo: 'receita', status: 'pago', categoriaId: 'cat-reembolso', contaId: 'conta-nubank', membroId: 'membro-1', subtipoReceita: 'reembolso' },

  // Despesas Fixas / Moradia / Pagas
  { id: 'lanc-5', descricao: 'Aluguel do Apartamento', valor: 3100.00, data: `${mesAtualStr}-06`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-moradia', contaId: 'conta-itau', membroId: 'membro-1', recorrente: true, subtipoDespesa: 'fixo' },
  { id: 'lanc-6', descricao: 'Condomínio & Fundo de Reserva', valor: 780.00, data: `${mesAtualStr}-10`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-moradia', contaId: 'conta-itau', membroId: 'membro-1', recorrente: true, subtipoDespesa: 'fixo' },
  { id: 'lanc-7', descricao: 'Conta de Energia (Enel)', valor: 284.90, data: `${mesAtualStr}-12`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-moradia', contaId: 'conta-nubank', membroId: 'membro-2', subtipoDespesa: 'fixo' },
  { id: 'lanc-8', descricao: 'Internet Fibra 600MB', valor: 139.90, data: `${mesAtualStr}-15`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-moradia', contaId: 'conta-nubank', membroId: 'membro-2', recorrente: true, subtipoDespesa: 'fixo' },

  // Assinaturas & Apps
  { id: 'lanc-app1', descricao: 'Netflix & Spotify Família', valor: 79.80, data: `${mesAtualStr}-14`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-servicos', cartaoId: 'cartao-nu', recorrente: true, subtipoDespesa: 'assinatura' },
  { id: 'lanc-app2', descricao: 'ChatGPT Plus & Google One', valor: 135.00, data: `${mesAtualStr}-16`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-servicos', cartaoId: 'cartao-nu', recorrente: true, subtipoDespesa: 'assinatura' },
  { id: 'lanc-app3', descricao: 'Gympass / Academia Família', valor: 189.90, data: `${mesAtualStr}-10`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-saude', cartaoId: 'cartao-nu', recorrente: true, subtipoDespesa: 'assinatura' },

  // Cartão Nubank & XP (Alimentação, compras do dia a dia)
  { id: 'lanc-9', descricao: 'Supermercado Pão de Açúcar', valor: 642.30, data: `${mesAtualStr}-03`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-alimentacao', cartaoId: 'cartao-nu', membroId: 'membro-2', subtipoDespesa: 'variavel' },
  { id: 'lanc-10', descricao: 'Feira da Semana & Hortifrúti', valor: 145.00, data: `${mesAtualStr}-08`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-alimentacao', contaId: 'conta-dinheiro', membroId: 'membro-1', subtipoDespesa: 'variavel' },
  { id: 'lanc-11', descricao: 'Jantar Família Pizzaria', valor: 210.00, data: `${mesAtualStr}-11`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-lazer', cartaoId: 'cartao-nu', membroId: 'membro-1', subtipoDespesa: 'variavel' },
  { id: 'lanc-12', descricao: 'Abastecimento Posto Shell', valor: 240.00, data: `${mesAtualStr}-09`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-transporte', cartaoId: 'cartao-nu', membroId: 'membro-1', subtipoDespesa: 'variavel' },

  // --- PARCELAS ATIVAS NO CARTÃO DE CRÉDITO ---
  { id: 'lanc-parc-1', descricao: 'Notebook Dell Inspiron Trabalho', valor: 349.90, data: `${mesAtualStr}-12`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-compras', cartaoId: 'cartao-nu', parcelaAtual: 4, totalParcelas: 10, grupoParcelamentoId: 'grp-parc-note', tipoParcelamento: 'cartao', subtipoDespesa: 'variavel', observacoes: 'Notebook para trabalho parcelado em 10x sem juros' },
  { id: 'lanc-parc-2', descricao: 'Geladeira Frost Free Inverter', valor: 289.00, data: `${mesAtualStr}-12`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-moradia', cartaoId: 'cartao-nu', parcelaAtual: 2, totalParcelas: 12, grupoParcelamentoId: 'grp-parc-gelad', tipoParcelamento: 'cartao', subtipoDespesa: 'variavel', observacoes: 'Troca da geladeira parcelada em 12x no cartão Nu' },
  { id: 'lanc-parc-3', descricao: 'Passagens Aéreas Férias Família', valor: 412.50, data: `${mesAtualStr}-28`, tipo: 'despesa', status: 'pendente', categoriaId: 'cat-lazer', cartaoId: 'cartao-xp', parcelaAtual: 5, totalParcelas: 6, grupoParcelamentoId: 'grp-parc-passagem', tipoParcelamento: 'cartao', subtipoDespesa: 'variavel', observacoes: 'Passagens de ida e volta férias de julho' },

  // --- PARCELAS EM CARNÊS E CREDIÁRIOS ---
  { id: 'lanc-carne-1', descricao: 'Carnê Casas Bahia - Sofá Retrátil 3L', valor: 195.00, data: `${mesAtualStr}-15`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-moradia', contaId: 'conta-itau', parcelaAtual: 3, totalParcelas: 8, grupoParcelamentoId: 'grp-carne-sofa', tipoParcelamento: 'carne', subtipoDespesa: 'fixo', recorrente: true, observacoes: 'Carnê da sala de estar - 8 parcelas' },
  { id: 'lanc-carne-2', descricao: 'Crediário Ótica - Óculos de Grau', valor: 120.00, data: `${mesAtualStr}-18`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-saude', contaId: 'conta-nubank', parcelaAtual: 2, totalParcelas: 5, grupoParcelamentoId: 'grp-carne-oculos', tipoParcelamento: 'carne', subtipoDespesa: 'fixo', recorrente: true, observacoes: 'Crediário da ótica com boleto mensal' },
  { id: 'lanc-carne-3', descricao: 'Carnê C&C - Reforma Banheiro', valor: 310.00, data: `${mesAtualStr}-25`, tipo: 'despesa', status: 'pendente', categoriaId: 'cat-moradia', contaId: 'conta-itau', parcelaAtual: 4, totalParcelas: 6, grupoParcelamentoId: 'grp-carne-reforma', tipoParcelamento: 'carne', subtipoDespesa: 'fixo', recorrente: true, observacoes: 'Pisos e torneiras parcelados no carnê de loja' },

  // Ressarcimento pendente
  { id: 'lanc-ressarc', descricao: 'Almoço com Cliente (Aguardando Reembolso)', valor: 185.00, data: `${mesAtualStr}-17`, tipo: 'despesa', status: 'pago', categoriaId: 'cat-lazer', cartaoId: 'cartao-xp', subtipoDespesa: 'ressarcimento' },

  // Despesas Pendentes / A Vencer
  { id: 'lanc-15', descricao: 'Mensalidade Escola dos Filhos', valor: 1450.00, data: `${mesAtualStr}-20`, tipo: 'despesa', status: 'pendente', categoriaId: 'cat-educacao', contaId: 'conta-itau', membroId: 'membro-3', recorrente: true, subtipoDespesa: 'fixo' },
  { id: 'lanc-16', descricao: 'Plano de Saúde Unimed', valor: 980.00, data: `${mesAtualStr}-22`, tipo: 'despesa', status: 'pendente', categoriaId: 'cat-saude', contaId: 'conta-itau', recorrente: true, subtipoDespesa: 'fixo' },
  { id: 'lanc-17', descricao: 'Compras Mercado Fim de Mês', valor: 550.00, data: `${mesAtualStr}-24`, tipo: 'despesa', status: 'pendente', categoriaId: 'cat-alimentacao', cartaoId: 'cartao-nu', subtipoDespesa: 'variavel' },
]

const ORCAMENTOS_PADRAO: Orcamento[] = [
  { id: 'orc-1', mes: mesAtualStr, categoriaId: 'cat-moradia', limite: 4500 },
  { id: 'orc-2', mes: mesAtualStr, categoriaId: 'cat-alimentacao', limite: 1800 },
  { id: 'orc-3', mes: mesAtualStr, categoriaId: 'cat-transporte', limite: 700 },
  { id: 'orc-4', mes: mesAtualStr, categoriaId: 'cat-saude', limite: 1200 },
  { id: 'orc-5', mes: mesAtualStr, categoriaId: 'cat-educacao', limite: 1600 },
  { id: 'orc-6', mes: mesAtualStr, categoriaId: 'cat-lazer', limite: 800 },
  { id: 'orc-7', mes: mesAtualStr, categoriaId: 'cat-compras', limite: 1000 },
  { id: 'orc-8', mes: mesAtualStr, categoriaId: 'cat-servicos', limite: 450 },
  { id: 'orc-9', mes: mesAtualStr, categoriaId: 'cat-reserva-aporte', limite: 1500 },
]

const METAS_PADRAO: MetaSonho[] = [
  {
    id: 'meta-reserva',
    titulo: 'Reserva de Emergência (6 meses)',
    icone: 'ShieldCheck',
    valorAlvo: 50000.00,
    valorAtual: 25400.00,
    dataAlvo: `${anoAtual + 1}-12-31`,
    cor: '#10B981',
    descricao: 'Segurança financeira familiar para cobrir 6 meses de custos fixos essenciais.',
    historicoAportes: [
      { id: 'ap-1', data: `${mesAtualStr}-05`, valor: 1000, nota: 'Aporte mensal do salário' },
      { id: 'ap-2', data: `${anoAtual}-01-10`, valor: 5000, nota: 'Aporte de 13º salário' },
    ],
  },
  {
    id: 'meta-viagem',
    titulo: 'Viagem de Férias da Família',
    icone: 'Plane',
    valorAlvo: 12000.00,
    valorAtual: 7800.00,
    dataAlvo: `${anoAtual + 1}-07-15`,
    cor: '#3B82F6',
    descricao: 'Passagens aéreas e hotel para férias de praia em família.',
    historicoAportes: [
      { id: 'ap-3', data: `${mesAtualStr}-07`, valor: 800, nota: 'Poupança de férias' },
    ],
  },
  {
    id: 'meta-carro',
    titulo: 'Troca de Carro (Sem Dívidas)',
    icone: 'Car',
    valorAlvo: 40000.00,
    valorAtual: 14500.00,
    dataAlvo: `${anoAtual + 2}-06-30`,
    cor: '#F59E0B',
    descricao: 'Objetivo de trocar de veículo à vista sem juros de financiamento.',
    historicoAportes: [
      { id: 'ap-4', data: `${mesAtualStr}-06`, valor: 1200, nota: 'Aporte mensal planejado' },
    ],
  },
]

const BENS_PADRAO: BemPatrimonial[] = [
  {
    id: 'bem-1',
    nome: 'Apartamento Residencial (110m²)',
    tipo: 'imovel',
    valorMercado: 680000.00,
    valorCompra: 520000.00,
    dataAquisicao: `${anoAtual - 4}-03-15`,
    quitado: false,
    observacoes: 'Imóvel principal da família, com financiamento ativo.',
  },
  {
    id: 'bem-2',
    nome: 'Toyota Corolla Sedan 2022',
    tipo: 'veiculo',
    valorMercado: 118000.00,
    valorCompra: 125000.00,
    dataAquisicao: `${anoAtual - 2}-08-20`,
    quitado: true,
    observacoes: 'Carro da família, totalmente quitado.',
  },
  {
    id: 'bem-3',
    nome: 'Lote Condomínio no Interior',
    tipo: 'terreno',
    valorMercado: 145000.00,
    valorCompra: 90000.00,
    dataAquisicao: `${anoAtual - 3}-11-10`,
    quitado: true,
    observacoes: 'Terreno de investimento para construção futura.',
  },
]

const INVESTIMENTOS_PADRAO: Investimento[] = [
  {
    id: 'inv-1',
    nome: 'Tesouro Selic 2029 (Reserva)',
    classe: 'renda_fixa',
    instituicao: 'XP Investimentos',
    valorInvestido: 22000.00,
    valorAtual: 25400.00,
    rendimentoTotal: 3400.00,
    proventosUltimoMes: 265.40,
  },
  {
    id: 'inv-2',
    nome: 'CDB 110% CDI Liquidez Diária',
    classe: 'renda_fixa',
    instituicao: 'Nubank',
    valorInvestido: 10000.00,
    valorAtual: 11250.00,
    rendimentoTotal: 1250.00,
    proventosUltimoMes: 112.50,
  },
  {
    id: 'inv-3',
    nome: 'Fundos Imobiliários (HGLG11, KNCR11)',
    classe: 'fiis',
    instituicao: 'XP Investimentos',
    valorInvestido: 35000.00,
    valorAtual: 38200.00,
    rendimentoTotal: 3200.00,
    proventosUltimoMes: 345.50,
  },
  {
    id: 'inv-4',
    nome: 'Ações Brasil (WEGE3, ITUB4, BBSE3)',
    classe: 'acoes',
    instituicao: 'BTG Pactual',
    valorInvestido: 28000.00,
    valorAtual: 33400.00,
    rendimentoTotal: 5400.00,
    proventosUltimoMes: 180.00,
  },
  {
    id: 'inv-5',
    nome: 'ETF S&P 500 (IVV / VOO)',
    classe: 'exterior',
    instituicao: 'Nomad / Avenue',
    valorInvestido: 15000.00,
    valorAtual: 19500.00,
    rendimentoTotal: 4500.00,
    proventosUltimoMes: 45.00,
  },
]

const EMPRESTIMOS_PADRAO: EmprestimoDivida[] = [
  {
    id: 'emp-1',
    nome: 'Financiamento Imobiliário Caixa (Apartamento)',
    tipo: 'financiamento_imovel',
    instituicao: 'Caixa Econômica',
    saldoDevedor: 284000.00,
    valorTotalOriginal: 360000.00,
    parcelasTotais: 360,
    parcelasPagas: 76,
    valorParcela: 2450.00,
    taxaJurosAnual: 8.9,
    diaVencimento: 10,
  },
  {
    id: 'emp-2',
    nome: 'Crédito Consignado / Reforma',
    tipo: 'consignado',
    instituicao: 'Itaú',
    saldoDevedor: 18500.00,
    valorTotalOriginal: 30000.00,
    parcelasTotais: 36,
    parcelasPagas: 14,
    valorParcela: 980.00,
    taxaJurosAnual: 14.5,
    diaVencimento: 5,
  },
]

const STORAGE_KEY = 'tudo_azul_finance_data_v4'

function carregarEstadoInicial(): EstadoFinanceiro {
  try {
    const salvo = localStorage.getItem(STORAGE_KEY)
    if (salvo) {
      const parsed = JSON.parse(salvo)
      if (parsed.contas && parsed.lancamentos) {
        return {
          ...parsed,
          bens: parsed.bens || BENS_PADRAO,
          investimentos: parsed.investimentos || INVESTIMENTOS_PADRAO,
          emprestimos: parsed.emprestimos || EMPRESTIMOS_PADRAO,
        }
      }
    }
  } catch (e) {
    console.error('Falha ao carregar estado do localStorage', e)
  }
  return {
    contas: CONTAS_PADRAO,
    cartoes: CARTOES_PADRAO,
    categorias: CATEGORIAS_PADRAO,
    lancamentos: LANCAMENTOS_PADRAO,
    orcamentos: ORCAMENTOS_PADRAO,
    metas: METAS_PADRAO,
    membros: MEMBROS_PADRAO,
    bens: BENS_PADRAO,
    investimentos: INVESTIMENTOS_PADRAO,
    emprestimos: EMPRESTIMOS_PADRAO,
  }
}

// Global state store with listeners for real-time React updates
let estadoAtual: EstadoFinanceiro = carregarEstadoInicial()
const listeners = new Set<() => void>()

function notificar() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(estadoAtual))
  } catch (e) {
    console.warn('Erro ao persistir no localStorage', e)
  }
  listeners.forEach(fn => fn())
}

export function useFinanceStore() {
  const [estado, setEstado] = useState<EstadoFinanceiro>(estadoAtual)

  useEffect(() => {
    const listener = () => setEstado({ ...estadoAtual })
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  // Actions - Lançamentos
  const adicionarLancamento = (
    dados: Omit<Lancamento, 'id'>,
    opcoesParcelamento?: { totalParcelas: number }
  ) => {
    if (opcoesParcelamento && opcoesParcelamento.totalParcelas > 1) {
      const grupoId = `grupo-${Date.now()}`
      const total = opcoesParcelamento.totalParcelas
      const valorPorParcela = Math.round((dados.valor / total) * 100) / 100
      const novos: Lancamento[] = []

      const [ano, mes, dia] = dados.data.split('-').map(Number)

      for (let p = 1; p <= total; p++) {
        const d = new Date(ano, mes - 1 + (p - 1), dia)
        const anoStr = d.getFullYear()
        const mesStr = String(d.getMonth() + 1).padStart(2, '0')
        const diaStr = String(d.getDate()).padStart(2, '0')
        const dataParcela = `${anoStr}-${mesStr}-${diaStr}`

        novos.push({
          ...dados,
          id: `lanc-${Date.now()}-${p}`,
          descricao: `${dados.descricao} (${p}/${total})`,
          valor: valorPorParcela,
          data: dataParcela,
          status: p === 1 ? dados.status : 'pendente',
          parcelaAtual: p,
          totalParcelas: total,
          grupoParcelamentoId: grupoId,
        })
      }
      estadoAtual = {
        ...estadoAtual,
        lancamentos: [...novos, ...estadoAtual.lancamentos],
      }
    } else {
      const novo: Lancamento = {
        ...dados,
        id: `lanc-${Date.now()}`,
      }
      estadoAtual = {
        ...estadoAtual,
        lancamentos: [novo, ...estadoAtual.lancamentos],
      }
    }
    notificar()
  }

  const editarLancamento = (id: string, dados: Partial<Lancamento>) => {
    estadoAtual = {
      ...estadoAtual,
      lancamentos: estadoAtual.lancamentos.map(l => (l.id === id ? { ...l, ...dados } : l)),
    }
    notificar()
  }

  const excluirLancamento = (id: string) => {
    estadoAtual = {
      ...estadoAtual,
      lancamentos: estadoAtual.lancamentos.filter(l => l.id !== id),
    }
    notificar()
  }

  const toggleStatusLancamento = (id: string) => {
    estadoAtual = {
      ...estadoAtual,
      lancamentos: estadoAtual.lancamentos.map(l => {
        if (l.id === id) {
          return { ...l, status: l.status === 'pago' ? 'pendente' : 'pago' }
        }
        return l
      }),
    }
    notificar()
  }

  const adicionarParcelamento = (dados: {
    descricao: string
    valorParcela: number
    totalParcelas: number
    parcelaInicial?: number
    primeiroVencimento: string // YYYY-MM-DD
    tipoParcelamento: 'cartao' | 'carne' | 'boleto'
    cartaoId?: string
    contaId?: string
    categoriaId: string
    membroId?: string
    observacoes?: string
  }) => {
    const grupoId = `grp-${Date.now()}`
    const pInicial = dados.parcelaInicial || 1
    const partes = (dados.primeiroVencimento || new Date().toISOString().slice(0, 10)).split('-').map(Number)
    const anoBase = partes[0] || new Date().getFullYear()
    const mesBase = partes[1] || (new Date().getMonth() + 1)
    const diaBase = partes[2] || 10
    const novos: Lancamento[] = []

    for (let i = pInicial; i <= dados.totalParcelas; i++) {
      const offsetMes = i - pInicial
      const d = new Date(anoBase, mesBase - 1 + offsetMes, diaBase)
      const a = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const diaStr = String(diaBase).padStart(2, '0')
      const dataLanc = `${a}-${m}-${diaStr}`

      novos.push({
        id: `parc-${Date.now()}-${i}`,
        descricao: `${dados.descricao} (${i}/${dados.totalParcelas})`,
        valor: dados.valorParcela,
        data: dataLanc,
        tipo: 'despesa',
        status: offsetMes === 0 ? 'pendente' : 'pendente',
        categoriaId: dados.categoriaId,
        cartaoId: dados.tipoParcelamento === 'cartao' ? dados.cartaoId : undefined,
        contaId: dados.tipoParcelamento !== 'cartao' ? dados.contaId : undefined,
        membroId: dados.membroId,
        parcelaAtual: i,
        totalParcelas: dados.totalParcelas,
        grupoParcelamentoId: grupoId,
        tipoParcelamento: dados.tipoParcelamento,
        subtipoDespesa: dados.tipoParcelamento === 'carne' ? 'fixo' : 'variavel',
        observacoes: dados.observacoes,
      })
    }

    estadoAtual = {
      ...estadoAtual,
      lancamentos: [...novos, ...estadoAtual.lancamentos],
    }
    notificar()
  }

  // Categorias
  const adicionarCategoria = (cat: Omit<Categoria, 'id'>) => {
    const nova: Categoria = {
      ...cat,
      id: `cat-${Date.now()}`,
    }
    estadoAtual = {
      ...estadoAtual,
      categorias: [...estadoAtual.categorias, nova],
    }
    notificar()
  }

  const editarCategoria = (id: string, cat: Partial<Categoria>) => {
    estadoAtual = {
      ...estadoAtual,
      categorias: estadoAtual.categorias.map(c => (c.id === id ? { ...c, ...cat } : c)),
    }
    notificar()
  }

  const excluirCategoria = (id: string) => {
    estadoAtual = {
      ...estadoAtual,
      categorias: estadoAtual.categorias.filter(c => c.id !== id),
    }
    notificar()
  }

  // Contas
  const adicionarConta = (conta: Omit<Conta, 'id'>) => {
    const nova: Conta = {
      ...conta,
      id: `conta-${Date.now()}`,
    }
    estadoAtual = {
      ...estadoAtual,
      contas: [...estadoAtual.contas, nova],
    }
    notificar()
  }

  const editarConta = (id: string, conta: Partial<Conta>) => {
    estadoAtual = {
      ...estadoAtual,
      contas: estadoAtual.contas.map(c => (c.id === id ? { ...c, ...conta } : c)),
    }
    notificar()
  }

  const excluirConta = (id: string) => {
    estadoAtual = {
      ...estadoAtual,
      contas: estadoAtual.contas.filter(c => c.id !== id),
    }
    notificar()
  }

  // Cartões
  const adicionarCartao = (cartao: Omit<CartaoCredito, 'id'>) => {
    const novo: CartaoCredito = {
      ...cartao,
      id: `cartao-${Date.now()}`,
    }
    estadoAtual = {
      ...estadoAtual,
      cartoes: [...estadoAtual.cartoes, novo],
    }
    notificar()
  }

  const pagarFatura = (cartaoId: string, contaId: string, valor: number, data: string) => {
    const cartao = estadoAtual.cartoes.find(c => c.id === cartaoId)
    const conta = estadoAtual.contas.find(c => c.id === contaId)
    if (!cartao || !conta) return

    const novoLancamento: Lancamento = {
      id: `fatura-pgto-${Date.now()}`,
      descricao: `Pagamento Fatura ${cartao.nome}`,
      valor,
      data,
      tipo: 'transferencia',
      status: 'pago',
      categoriaId: 'cat-outros-desp',
      contaId,
      observacoes: `Quitação de fatura do cartão ${cartao.nome}`,
    }

    estadoAtual = {
      ...estadoAtual,
      lancamentos: [novoLancamento, ...estadoAtual.lancamentos],
    }
    notificar()
  }

  // Orçamentos
  const salvarOrcamento = (categoriaId: string, mes: string, limite: number) => {
    const existente = estadoAtual.orcamentos.find(o => o.categoriaId === categoriaId && o.mes === mes)
    if (existente) {
      estadoAtual = {
        ...estadoAtual,
        orcamentos: estadoAtual.orcamentos.map(o => (o.id === existente.id ? { ...o, limite } : o)),
      }
    } else {
      const novo: Orcamento = {
        id: `orc-${Date.now()}`,
        mes,
        categoriaId,
        limite,
      }
      estadoAtual = {
        ...estadoAtual,
        orcamentos: [...estadoAtual.orcamentos, novo],
      }
    }
    notificar()
  }

  // Metas / Sonhos
  const adicionarMeta = (meta: Omit<MetaSonho, 'id' | 'historicoAportes'>) => {
    const nova: MetaSonho = {
      ...meta,
      id: `meta-${Date.now()}`,
      historicoAportes: [],
    }
    estadoAtual = {
      ...estadoAtual,
      metas: [...estadoAtual.metas, nova],
    }
    notificar()
  }

  const aportarMeta = (metaId: string, valor: number, contaId?: string, nota?: string) => {
    const dataIso = new Date().toISOString().slice(0, 10)
    estadoAtual = {
      ...estadoAtual,
      metas: estadoAtual.metas.map(m => {
        if (m.id === metaId) {
          const novoAporte: AporteMeta = {
            id: `ap-${Date.now()}`,
            data: dataIso,
            valor,
            contaId,
            nota,
          }
          return {
            ...m,
            valorAtual: m.valorAtual + valor,
            historicoAportes: [novoAporte, ...m.historicoAportes],
          }
        }
        return m
      }),
    }

    if (contaId) {
      const meta = estadoAtual.metas.find(m => m.id === metaId)
      const novoLanc: Lancamento = {
        id: `lanc-meta-${Date.now()}`,
        descricao: `Aporte Sonho: ${meta?.titulo || 'Objetivo'}`,
        valor,
        data: dataIso,
        tipo: 'transferencia',
        status: 'pago',
        categoriaId: 'cat-reserva-aporte',
        contaId,
      }
      estadoAtual = {
        ...estadoAtual,
        lancamentos: [novoLanc, ...estadoAtual.lancamentos],
      }
    }

    notificar()
  }

  // Bens Patrimoniais
  const adicionarBem = (bem: Omit<BemPatrimonial, 'id'>) => {
    const novo: BemPatrimonial = {
      ...bem,
      id: `bem-${Date.now()}`,
    }
    estadoAtual = {
      ...estadoAtual,
      bens: [novo, ...estadoAtual.bens],
    }
    notificar()
  }

  const excluirBem = (id: string) => {
    estadoAtual = {
      ...estadoAtual,
      bens: estadoAtual.bens.filter(b => b.id !== id),
    }
    notificar()
  }

  // Investimentos
  const adicionarInvestimento = (inv: Omit<Investimento, 'id'>) => {
    const novo: Investimento = {
      ...inv,
      id: `inv-${Date.now()}`,
    }
    estadoAtual = {
      ...estadoAtual,
      investimentos: [novo, ...estadoAtual.investimentos],
    }
    notificar()
  }

  const excluirInvestimento = (id: string) => {
    estadoAtual = {
      ...estadoAtual,
      investimentos: estadoAtual.investimentos.filter(i => i.id !== id),
    }
    notificar()
  }

  // Empréstimos & Dívidas
  const adicionarEmprestimo = (emp: Omit<EmprestimoDivida, 'id'>) => {
    const novo: EmprestimoDivida = {
      ...emp,
      id: `emp-${Date.now()}`,
    }
    estadoAtual = {
      ...estadoAtual,
      emprestimos: [novo, ...estadoAtual.emprestimos],
    }
    notificar()
  }

  const amortizarEmprestimo = (id: string, valorAmortizado: number, contaOrigemId?: string) => {
    estadoAtual = {
      ...estadoAtual,
      emprestimos: estadoAtual.emprestimos.map(e => {
        if (e.id === id) {
          const novoSaldo = Math.max(0, e.saldoDevedor - valorAmortizado)
          const novasPagas = Math.min(e.parcelasTotais, e.parcelasPagas + 1)
          return {
            ...e,
            saldoDevedor: novoSaldo,
            parcelasPagas: novasPagas,
          }
        }
        return e
      }),
    }

    if (contaOrigemId) {
      const emp = estadoAtual.emprestimos.find(e => e.id === id)
      const novoLanc: Lancamento = {
        id: `lanc-amort-${Date.now()}`,
        descricao: `Amortização: ${emp?.nome || 'Financiamento'}`,
        valor: valorAmortizado,
        data: new Date().toISOString().slice(0, 10),
        tipo: 'despesa',
        status: 'pago',
        categoriaId: 'cat-moradia',
        contaId: contaOrigemId,
        subtipoDespesa: 'fixo',
      }
      estadoAtual = {
        ...estadoAtual,
        lancamentos: [novoLanc, ...estadoAtual.lancamentos],
      }
    }

    notificar()
  }

  const importarLancamentos = (novos: Omit<Lancamento, 'id'>[]) => {
    const criados = novos.map((n, i) => ({
      ...n,
      id: `import-${Date.now()}-${i}`,
    }))
    estadoAtual = {
      ...estadoAtual,
      lancamentos: [...criados, ...estadoAtual.lancamentos],
    }
    notificar()
  }

  const resetarDadosPadrao = () => {
    estadoAtual = {
      contas: CONTAS_PADRAO,
      cartoes: CARTOES_PADRAO,
      categorias: CATEGORIAS_PADRAO,
      lancamentos: LANCAMENTOS_PADRAO,
      orcamentos: ORCAMENTOS_PADRAO,
      metas: METAS_PADRAO,
      membros: MEMBROS_PADRAO,
      bens: BENS_PADRAO,
      investimentos: INVESTIMENTOS_PADRAO,
      emprestimos: EMPRESTIMOS_PADRAO,
    }
    notificar()
  }

  // --- CÁLCULOS E DERIVAÇÕES FINANCEIRAS ---

  // Saldo real na moeda da conta
  const calcularSaldoConta = (contaId: string): number => {
    const conta = estado.contas.find(c => c.id === contaId)
    if (!conta) return 0
    let saldo = conta.saldoInicial

    for (const l of estado.lancamentos) {
      if (l.status !== 'pago') continue

      if (l.tipo === 'receita' && l.contaId === contaId) {
        saldo += l.valor
      } else if (l.tipo === 'despesa' && l.contaId === contaId) {
        saldo -= l.valor
      } else if (l.tipo === 'transferencia') {
        if (l.contaId === contaId) saldo -= l.valor
        if (l.contaDestinoId === contaId) saldo += l.valor
      }
    }
    return saldo
  }

  // Saldo da conta convertido em BRL
  const calcularSaldoContaEmBRL = (contaId: string): number => {
    const conta = estado.contas.find(c => c.id === contaId)
    if (!conta) return 0
    const saldoOriginal = calcularSaldoConta(contaId)
    const taxa = conta.cotacao || (conta.moeda === 'USD' ? 5.65 : conta.moeda === 'EUR' ? 6.15 : 1)
    return saldoOriginal * taxa
  }

  // Saldo total de todas as contas em BRL (inclui conversão de USD e EUR)
  const saldoTotalContas = estado.contas
    .filter(c => c.ativa)
    .reduce((acc, c) => acc + calcularSaldoContaEmBRL(c.id), 0)

  // Total de Bens Patrimoniais
  const totalBensPatrimoniais = estado.bens.reduce((acc, b) => acc + b.valorMercado, 0)

  // Total em Investimentos
  const totalInvestimentos = estado.investimentos.reduce((acc, i) => acc + i.valorAtual, 0)

  // Total de Dívidas / Empréstimos
  const totalDividas = estado.emprestimos.reduce((acc, e) => acc + e.saldoDevedor, 0)

  // Patrimônio Líquido Total
  const patrimonioLiquidoTotal = saldoTotalContas + totalBensPatrimoniais + totalInvestimentos - totalDividas

  // Fatura do cartão
  const calcularFaturaCartao = (cartaoId: string, mesYm: string): number => {
    return estado.lancamentos
      .filter(l => l.cartaoId === cartaoId && l.data.startsWith(mesYm) && l.tipo === 'despesa')
      .reduce((acc, l) => acc + l.valor, 0)
  }

  // Totais do mês
  const calcularTotaisMes = (mesYm: string) => {
    let receitasPagas = 0
    let receitasPendentes = 0
    let despesasPagas = 0
    let despesasPendentes = 0

    // Separação por subtipos
    let despesasFixas = 0
    let despesasAssinaturas = 0
    let despesasVariaveis = 0
    let despesasRessarcimento = 0

    for (const l of estado.lancamentos) {
      if (!l.data.startsWith(mesYm)) continue
      if (l.tipo === 'transferencia') continue

      if (l.tipo === 'receita') {
        if (l.status === 'pago') receitasPagas += l.valor
        else receitasPendentes += l.valor
      } else if (l.tipo === 'despesa') {
        if (l.status === 'pago') {
          despesasPagas += l.valor
        } else {
          despesasPendentes += l.valor
        }

        const sub = l.subtipoDespesa || 'variavel'
        if (sub === 'fixo') despesasFixas += l.valor
        else if (sub === 'assinatura') despesasAssinaturas += l.valor
        else if (sub === 'ressarcimento') despesasRessarcimento += l.valor
        else despesasVariaveis += l.valor
      }
    }

    const totalReceitas = receitasPagas + receitasPendentes
    const totalDespesas = despesasPagas + despesasPendentes
    const resultadoRealizado = receitasPagas - despesasPagas
    const resultadoPrevisto = totalReceitas - totalDespesas
    const saldoProjetadoFimDoMes = saldoTotalContas + receitasPendentes - despesasPendentes
    const taxaComprometimento = receitasPagas > 0 ? (despesasPagas / receitasPagas) * 100 : 0

    return {
      receitasPagas,
      receitasPendentes,
      totalReceitas,
      despesasPagas,
      despesasPendentes,
      totalDespesas,
      resultadoRealizado,
      resultadoPrevisto,
      saldoProjetadoFimDoMes,
      taxaComprometimento,
      despesasFixas,
      despesasAssinaturas,
      despesasVariaveis,
      despesasRessarcimento,
    }
  }

  // Orçamentos consumidos no mês
  const calcularConsumoOrcamento = (categoriaId: string, mesYm: string) => {
    const orc = estado.orcamentos.find(o => o.categoriaId === categoriaId && o.mes === mesYm)
    const limite = orc ? orc.limite : 0

    const totalGasto = estado.lancamentos
      .filter(l => l.categoriaId === categoriaId && l.tipo === 'despesa' && l.data.startsWith(mesYm))
      .reduce((acc, l) => acc + l.valor, 0)

    const percentual = limite > 0 ? (totalGasto / limite) * 100 : 0
    const restante = limite - totalGasto

    return {
      limite,
      totalGasto,
      percentual,
      restante,
      estourado: totalGasto > limite && limite > 0,
      temOrcamento: limite > 0,
    }
  }

  return {
    ...estado,
    adicionarLancamento,
    adicionarParcelamento,
    editarLancamento,
    excluirLancamento,
    toggleStatusLancamento,
    adicionarCategoria,
    editarCategoria,
    excluirCategoria,
    adicionarConta,
    editarConta,
    excluirConta,
    adicionarCartao,
    pagarFatura,
    salvarOrcamento,
    adicionarMeta,
    aportarMeta,
    adicionarBem,
    excluirBem,
    adicionarInvestimento,
    excluirInvestimento,
    adicionarEmprestimo,
    amortizarEmprestimo,
    importarLancamentos,
    resetarDadosPadrao,
    calcularSaldoConta,
    calcularSaldoContaEmBRL,
    saldoTotalContas,
    totalBensPatrimoniais,
    totalInvestimentos,
    totalDividas,
    patrimonioLiquidoTotal,
    calcularFaturaCartao,
    calcularTotaisMes,
    calcularConsumoOrcamento,
  }
}
