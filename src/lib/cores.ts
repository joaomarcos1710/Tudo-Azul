/**
 * Sistema de cores do app (#183, pedido do dono): uma fonte só, lida pelo tailwind.config.js (classes `text-lucro`,
 * `bg-agendado-fundo`, …) e pelos gráficos em SVG (components/graficos/cores.ts). Nenhuma tela escreve hex solto.
 *
 * "azul para a gente fica como padrão de perfeito, lucro / vermelho prejuízo / amarelo atenção / verde para agendado"
 *  - lucro (azul): entrada, receita, saldo positivo, pago, "está tudo certo";
 *  - prejuizo (vermelho): saída, despesa, saldo negativo, vencida;
 *  - atencao (âmbar): aviso, fatura fechada a pagar, prazo perto, orçamento estourando;
 *  - agendado (verde): planejado, recorrente futuro, fatura aberta (a pagar no futuro). ATENÇÃO: nos bancos e no
 *    Organizze verde é "entrou"; aqui não. Todo verde vem com o rótulo "Planejado"/"Agendado" ao lado;
 *  - neutro (cinza): zero, sem efeito no saldo, inativo, arquivado;
 *  - transferencia (marinho): dinheiro que muda de conta, nem ganho nem perda.
 * Papéis de cada tom: DEFAULT = texto (≥ 4,5:1 no branco e no fundo do app); `fundo` = fundo de selo (o DEFAULT sobre
 * ele também passa de 4,5:1); `marca` = barra, ponto e ícone sem texto (≥ 3:1). O teste cores.test.ts mede tudo isso.
 * A cor nunca é a única informação: o sinal "−", o rótulo ("Planejado", "Vencida") e o ícone continuam.
 */
export const CORES = {
  lucro: { DEFAULT: '#2563EB', fundo: '#EAF2FF', marca: '#2a78d6', claro: '#60A5FA' },
  prejuizo: { DEFAULT: '#B91C1C', fundo: '#FEF2F2', borda: '#FECACA', marca: '#dc2626', claro: '#F87171', escuro: '#991B1B', 'sobre-escuro': '#FCA5A5' },
  atencao: { DEFAULT: '#B45309', fundo: '#FFFBEB', marca: '#D97706' },
  agendado: { DEFAULT: '#047857', fundo: '#D1FAE5', marca: '#059669' },
  neutro: { DEFAULT: '#475569', fundo: '#F1F5F9', marca: '#64748B' },
  transferencia: { DEFAULT: '#0B1F46', fundo: '#E8ECF4' },
} as const

/** Fundos onde o texto aparece: o branco dos cards e o fundo do app (`bg-fundo`). */
export const FUNDOS = { branco: '#FFFFFF', app: '#F7F9FC' } as const

/** Detalhes neutros dos gráficos (grade e eixo do zero): contexto, sem significado de dinheiro. */
export const GRAFICO = {
  grade: '#E2E8F0', eixo: '#94A3B8', destaque: '#EAF2FF', destaqueSobreArea: 'rgba(37,99,235,0.08)', contorno: '#FFFFFF',
  // saldo das contas como área clara ao fundo (Relatórios, #179): contexto, contraste baixo de propósito
  saldoArea: '#DBEAFE', saldoBorda: '#93C5FD',
} as const

/**
 * Cor do texto de um valor com sinal (saldo, resultado): positivo azul, negativo vermelho, zero cinza.
 * As classes estão escritas por inteiro para o Tailwind encontrá-las.
 */
export function corDoValor(v: number): 'text-lucro' | 'text-prejuizo' | 'text-neutro' {
  return v > 0 ? 'text-lucro' : v < 0 ? 'text-prejuizo' : 'text-neutro'
}

/** Cor do valor de um lançamento pelo tipo: receita azul, despesa vermelha, transferência marinho. */
export function corDoTipo(tipo: 'income' | 'expense' | 'transfer'): 'text-lucro' | 'text-prejuizo' | 'text-transferencia' {
  return tipo === 'income' ? 'text-lucro' : tipo === 'expense' ? 'text-prejuizo' : 'text-transferencia'
}

/** Selos de situação, iguais em todas as telas (Lançamentos, Calendário, Cartões, Recorrentes). */
export const SELO = {
  pago: 'bg-lucro-fundo text-lucro',
  planejado: 'bg-agendado-fundo text-agendado',
  atencao: 'bg-atencao-fundo text-atencao',
  vencido: 'bg-prejuizo-fundo text-prejuizo',
  neutro: 'bg-neutro-fundo text-neutro',
} as const

/**
 * Selo da situação de uma fatura de cartão (Cartões e Lançamentos): aberta = agendado (verde, a pagar no futuro);
 * fechada = atenção (âmbar, a pagar agora); vencida = prejuízo (vermelho); paga = tudo certo (azul).
 */
export const SELO_FATURA = {
  aberta: { texto: 'Aberta', estilo: SELO.planejado },
  fechada: { texto: 'Fechada', estilo: SELO.atencao },
  vencida: { texto: 'Vencida', estilo: SELO.vencido },
  paga: { texto: 'Paga', estilo: SELO.pago },
} as const

/**
 * Faixa de uso do orçamento (pedido do dono, 06/11/2026): até 50% azul (tudo certo), a partir de 50% azul claro,
 * de 70% amarelo (âmbar), de 90% vermelho claro e de 100% vermelho. Compara centavos inteiros (sem arredondar).
 * Os tons `claro` ficam abaixo de 3:1 no branco: a barra sempre vem com o percentual e o texto da situação ao lado,
 * então a cor não é a única informação.
 */
export type FaixaOrcamento = 'tranquilo' | 'metade' | 'atencao' | 'perto' | 'estourou'
export const BARRA_ORCAMENTO: Record<FaixaOrcamento, string> = {
  tranquilo: 'bg-lucro-marca',
  metade: 'bg-lucro-claro',
  atencao: 'bg-atencao-marca',
  perto: 'bg-prejuizo-claro',
  estourou: 'bg-prejuizo-marca',
}
export function faixaOrcamento(gasto: number, limite: number): FaixaOrcamento {
  if (limite <= 0 || gasto >= limite) return 'estourou'
  if (gasto * 10 >= limite * 9) return 'perto'
  if (gasto * 10 >= limite * 7) return 'atencao'
  if (gasto * 2 >= limite) return 'metade'
  return 'tranquilo'
}
