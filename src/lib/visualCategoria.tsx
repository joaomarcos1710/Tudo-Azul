import type { ReactNode } from 'react'
import type { Categoria, TipoCategoria } from './categorias'

/**
 * Ícone e cor de cada categoria. O app SUGERE pelo nome (nada é gravado); só a escolha da pessoa vai para o banco
 * (colunas `icon` e `color` de categories). Subcategoria sem escolha própria herda da categoria mãe.
 * A cor nunca identifica sozinha: o nome sempre aparece ao lado e o valor continua nas cores de receita/despesa.
 */

/** Traços dos ícones (viewBox 24, traço de 1.8, mesmo estilo do menu). A chave é o que vai para `icon` no banco. */
export const ICONES = {
  carrinho: { rotulo: 'Carrinho', svg: <><path d="M3 4h2l2.4 11h10.8L21 7.5H6.2" /><circle cx="9.5" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></> },
  casa: { rotulo: 'Casa', svg: <><path d="M3.5 11 12 4l8.5 7" /><path d="M5.5 9.5V20h13V9.5" /><path d="M10 20v-5.5h4V20" /></> },
  garfo: { rotulo: 'Talheres', svg: <><path d="M7 3v7a2 2 0 0 0 2 2v9M11 3v7a2 2 0 0 1-2 2M9 3v6" /><path d="M17 21V3c-2 1.5-3 4-3 7h3" /></> },
  carro: { rotulo: 'Carro', svg: <><path d="M5 16.5V12l1.8-4.5h10.4L19 12v4.5H5Z" /><path d="M3.5 12h17" /><circle cx="8" cy="16.5" r="1.8" /><circle cx="16" cy="16.5" r="1.8" /></> },
  coracao: { rotulo: 'Coração', svg: <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z" /> },
  capelo: { rotulo: 'Estudo', svg: <><path d="M2.5 9 12 4.5 21.5 9 12 13.5 2.5 9Z" /><path d="M6.5 11v4.5c1.5 1.5 3.5 2.2 5.5 2.2s4-.7 5.5-2.2V11M21.5 9v5" /></> },
  haltere: { rotulo: 'Esporte', svg: <><path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" /></> },
  ingresso: { rotulo: 'Lazer', svg: <><path d="M3 8a2 2 0 0 0 0 4v4h18v-4a2 2 0 0 1 0-4V4H3v4Z" transform="translate(0 2)" /><path d="M14 6v12" strokeDasharray="2 2" /></> },
  play: { rotulo: 'Assinatura', svg: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m10 9.5 4.5 2.5-4.5 2.5v-5Z" /></> },
  sacola: { rotulo: 'Compras', svg: <><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 10V6.5a3 3 0 0 1 6 0V10" /></> },
  aviao: { rotulo: 'Viagem', svg: <path d="M21 15.5 13.5 11V5a1.5 1.5 0 0 0-3 0v6L3 15.5V17l7.5-2.5V19L8.5 20.5V22l3.5-1 3.5 1v-1.5L13.5 19v-4.5L21 17v-1.5Z" /> },
  recibo: { rotulo: 'Recibo', svg: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" /><path d="M9 8h6M9 12h6M9 16h3" /></> },
  raio: { rotulo: 'Energia', svg: <path d="M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8Z" /> },
  wifi: { rotulo: 'Internet', svg: <><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0" /><circle cx="12" cy="19.2" r="0.9" /></> },
  pata: { rotulo: 'Pet', svg: <><circle cx="7" cy="10" r="1.8" /><circle cx="10.5" cy="6.5" r="1.8" /><circle cx="14.5" cy="6.5" r="1.8" /><circle cx="18" cy="10" r="1.8" /><path d="M8.5 17.5c0-2.5 1.6-4.5 3.5-4.5s3.5 2 3.5 4.5c0 1.6-1.5 2.5-3.5 2.5s-3.5-.9-3.5-2.5Z" /></> },
  presente: { rotulo: 'Presente', svg: <><rect x="3.5" y="8" width="17" height="4" rx="1" /><path d="M5 12v8.5h14V12M12 8v12.5M12 8c-1.5-3.5-5.5-4-5.5-1.5S10 8 12 8Zm0 0c1.5-3.5 5.5-4 5.5-1.5S14 8 12 8Z" /></> },
  maleta: { rotulo: 'Trabalho', svg: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5h6v2M3 12.5h18" /></> },
  grafico: { rotulo: 'Investimento', svg: <><path d="M3 20h18" /><path d="m4 15 5-5 4 4 7-7" /><path d="M15 7h5v5" /></> },
  cifrao: { rotulo: 'Dinheiro', svg: <><circle cx="12" cy="12" r="9" /><path d="M15 9c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.4 0-2.5-.5-3-1.5M12 6v1.5M12 16.5V18" /></> },
  etiqueta: { rotulo: 'Etiqueta', svg: <><path d="M3 12V4h8l10 10-8 8L3 12Z" /><circle cx="7.5" cy="8.5" r="1" /></> },
} satisfies Record<string, { rotulo: string; svg: ReactNode }>

export type ChaveIcone = keyof typeof ICONES

/**
 * Cores de categoria. Fora vermelho, verde e âmbar (são de despesa, receita e planejado). Validadas no verificador de
 * paleta: as 4 cores têm distância ≥ 15 entre si para visão normal; para daltônicos azul e violeta ficam próximas, por
 * isso a cor nunca vem sem o ícone e o nome. Grafite é a neutra (genérico e "Sem categoria"). Todas com contraste ≥ 3:1
 * para o ícone branco por cima.
 */
export const CORES = [
  { hex: '#0891B2', rotulo: 'Ciano' },
  { hex: '#2563EB', rotulo: 'Azul' },
  { hex: '#9333EA', rotulo: 'Violeta' },
  { hex: '#DB2777', rotulo: 'Rosa' },
  { hex: '#475569', rotulo: 'Grafite' },
] as const

const [CIANO, AZUL, VIOLETA, ROSA, GRAFITE] = CORES.map((c) => c.hex)

export interface Visual { icone: ChaveIcone; cor: string }

/** Palavras (sem acento, minúsculas) → visual. A primeira regra que casa vence; ordem importa. */
const REGRAS: { palavras: string[]; tipo?: TipoCategoria; visual: Visual }[] = [
  { palavras: ['13', 'decimo', 'plr', 'bonus', 'ferias', 'premio'], tipo: 'income', visual: { icone: 'presente', cor: ROSA } },
  { palavras: ['presente', 'doacao'], visual: { icone: 'presente', cor: ROSA } },
  { palavras: ['salario', 'prolabore', 'pro', 'freela', 'freelance', 'trabalho', 'honorario'], tipo: 'income', visual: { icone: 'maleta', cor: AZUL } },
  { palavras: ['rendimento', 'investimento', 'dividendo', 'juros', 'aplicacao'], tipo: 'income', visual: { icone: 'grafico', cor: CIANO } },
  { palavras: ['imposto', 'taxa', 'tarifa', 'iof', 'ir', 'iptu', 'ipva', 'multa', 'tributo'], visual: { icone: 'recibo', cor: GRAFITE } },
  { palavras: ['mercado', 'supermercado', 'feira', 'hortifruti', 'acougue', 'padaria'], visual: { icone: 'carrinho', cor: CIANO } },
  { palavras: ['moradia', 'aluguel', 'condominio', 'casa', 'apartamento', 'reforma'], visual: { icone: 'casa', cor: AZUL } },
  { palavras: ['restaurante', 'lanche', 'ifood', 'delivery', 'comida', 'alimentacao', 'cafe', 'bar'], visual: { icone: 'garfo', cor: ROSA } },
  { palavras: ['transporte', 'uber', 'combustiv', 'gasolina', 'carro', 'estacionamento', 'pedagio', 'onibus', 'metro', 'moto'], visual: { icone: 'carro', cor: VIOLETA } },
  { palavras: ['saude', 'farmacia', 'medico', 'dentista', 'hospital', 'remedio', 'exame', 'terapia'], visual: { icone: 'coracao', cor: ROSA } },
  { palavras: ['educacao', 'escola', 'faculdade', 'curso', 'livro', 'estudo'], visual: { icone: 'capelo', cor: VIOLETA } },
  { palavras: ['academia', 'crossfit', 'esporte', 'corrida', 'treino', 'musculacao'], visual: { icone: 'haltere', cor: CIANO } },
  { palavras: ['assinatura', 'streaming', 'netflix', 'spotify'], visual: { icone: 'play', cor: VIOLETA } },
  { palavras: ['lazer', 'cinema', 'show', 'passeio', 'diversao', 'jogo'], visual: { icone: 'ingresso', cor: ROSA } },
  { palavras: ['viagem', 'viagens', 'passagem', 'hotel', 'ferias'], visual: { icone: 'aviao', cor: CIANO } },
  { palavras: ['luz', 'energia', 'agua', 'gas'], visual: { icone: 'raio', cor: AZUL } },
  { palavras: ['internet', 'telefone', 'celular', 'tv'], visual: { icone: 'wifi', cor: AZUL } },
  { palavras: ['pet', 'veterinario', 'racao', 'cachorro', 'gato'], visual: { icone: 'pata', cor: VIOLETA } },
  { palavras: ['compras', 'roupa', 'roupas', 'vestuario', 'shopping', 'pessoais', 'beleza'], visual: { icone: 'sacola', cor: ROSA } },
  { palavras: ['receita', 'receitas', 'reembolso', 'entrada'], tipo: 'income', visual: { icone: 'cifrao', cor: AZUL } },
]

function palavrasDe(nome: string): string[] {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/** Palavra curta (até 3 letras: "ir", "tv", "13") só casa inteira; as demais casam pelo começo (plural, "restaurantes"). */
function casa(palavra: string, chave: string): boolean {
  return chave.length <= 3 ? palavra === chave : palavra.startsWith(chave)
}

/** Sugestão pelo nome. Sem palavra conhecida: etiqueta grafite (despesa) ou cifrão azul (receita). */
export function sugerirVisual(nome: string, tipo: TipoCategoria): Visual {
  const palavras = palavrasDe(nome)
  const regra = REGRAS.find((r) => (!r.tipo || r.tipo === tipo) && r.palavras.some((k) => palavras.some((p) => casa(p, k))))
  if (regra) return regra.visual
  return tipo === 'income' ? { icone: 'cifrao', cor: AZUL } : { icone: 'etiqueta', cor: GRAFITE }
}

function ehIcone(v: string | null | undefined): v is ChaveIcone {
  return !!v && Object.prototype.hasOwnProperty.call(ICONES, v)
}
function ehCor(v: string | null | undefined): v is string {
  return !!v && /^#[0-9a-fA-F]{6}$/.test(v)
}

/**
 * Visual final, campo a campo: escolha da própria categoria; senão, a da mãe (resolvida); senão, a sugestão pelo nome.
 * "Sem categoria" é sempre etiqueta grafite. Ícone desconhecido no banco (ex.: de uma versão futura) cai na sugestão.
 */
export function visualDaCategoria(c: Categoria, porId: Map<string, Categoria>): Visual {
  if (c.sistema) return { icone: 'etiqueta', cor: GRAFITE }
  const mae = c.paiId ? porId.get(c.paiId) : undefined
  const base = mae ? visualDaCategoria(mae, porId) : sugerirVisual(c.nome, c.tipo)
  return { icone: ehIcone(c.icone) ? c.icone : base.icone, cor: ehCor(c.cor) ? c.cor : base.cor }
}

/** Visual de uma linha (lançamento, parcela) pelo id da categoria; sem categoria ou ainda não carregada = "Sem categoria". */
export function visualPorId(id: string | null | undefined, porId: Map<string, Categoria>, tipo: TipoCategoria): Visual {
  const c = id ? porId.get(id) : undefined
  return visualDaCategoria(c ?? { id: '', nome: 'Sem categoria', tipo, paiId: null, sistema: true, ativa: true, eventual: false }, porId)
}

/** Ícones fixos de linhas sem categoria (não aparecem no seletor). */
const ICONES_FIXOS = {
  transferencia: <path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" />,
  cartao: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 9.5h19M6 15h4" /></>,
}

/** Círculo com o ícone. Decorativo: o nome da categoria (ou o tipo da linha) sempre vem ao lado em texto. */
export function IconeCategoria({ visual, fixo, tamanho = 'normal' }: {
  visual?: Visual; fixo?: keyof typeof ICONES_FIXOS; tamanho?: 'normal' | 'pequeno'
}) {
  const caixa = tamanho === 'pequeno' ? 'h-7 w-7' : 'h-8 w-8'
  const lado = tamanho === 'pequeno' ? 15 : 17
  const chave = fixo ?? visual?.icone ?? 'etiqueta'
  return (
    <span aria-hidden="true" data-icone={chave} className={`inline-flex ${caixa} shrink-0 items-center justify-center rounded-full text-white`}
      style={{ backgroundColor: fixo ? GRAFITE : visual?.cor ?? GRAFITE }}>
      <svg width={lado} height={lado} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {fixo ? ICONES_FIXOS[fixo] : ICONES[chave as ChaveIcone].svg}
      </svg>
    </span>
  )
}
