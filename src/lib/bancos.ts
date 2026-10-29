import type { TipoConta } from './contas'

/**
 * Selo do banco de uma conta. O banco NÃO é guardado: é reconhecido pelo nome da conta ("Conta corrente Caixa Econômica",
 * "Nubank João"), como a sugestão de ícone das categorias. O selo é uma sigla sobre a cor de referência do banco, não o
 * logo oficial (marca de terceiro: arquivo de imagem licenciado seria outra etapa). Carteira em dinheiro nunca ganha selo.
 */
export interface Banco {
  chave: string
  nome: string
  /** 2 ou 3 letras mostradas no selo. */
  sigla: string
  /** Cor de fundo do selo (cor de referência do banco). */
  cor: string
  /** Cor da sigla, escolhida para ter contraste de pelo menos 3:1 com `cor`. */
  texto: string
  /** Como o nome da conta pode citar o banco (sem acento, minúsculas); casa palavra inteira. */
  palavras: string[]
}

export const BANCOS: Banco[] = [
  { chave: 'caixa', nome: 'Caixa Econômica Federal', sigla: 'CX', cor: '#005CA9', texto: '#FFFFFF', palavras: ['caixa economica federal', 'caixa economica', 'caixa federal', 'cef', 'caixa'] },
  { chave: 'nubank', nome: 'Nubank', sigla: 'Nu', cor: '#820AD1', texto: '#FFFFFF', palavras: ['nubank', 'nu'] },
  { chave: 'itau', nome: 'Itaú', sigla: 'It', cor: '#EC7000', texto: '#0B1F46', palavras: ['itau unibanco', 'itau', 'itaucard'] },
  { chave: 'bradesco', nome: 'Bradesco', sigla: 'Br', cor: '#CC092F', texto: '#FFFFFF', palavras: ['bradesco'] },
  { chave: 'santander', nome: 'Santander', sigla: 'Sa', cor: '#EC0000', texto: '#FFFFFF', palavras: ['santander'] },
  { chave: 'bb', nome: 'Banco do Brasil', sigla: 'BB', cor: '#FCFC30', texto: '#0038A8', palavras: ['banco do brasil', 'bb'] },
  { chave: 'inter', nome: 'Inter', sigla: 'In', cor: '#FF7A00', texto: '#1A1A1A', palavras: ['banco inter', 'inter'] },
  { chave: 'c6', nome: 'C6 Bank', sigla: 'C6', cor: '#242424', texto: '#FFFFFF', palavras: ['c6 bank', 'c6'] },
  { chave: 'btg', nome: 'BTG Pactual', sigla: 'BTG', cor: '#001E62', texto: '#FFFFFF', palavras: ['btg pactual', 'btg'] },
  { chave: 'xp', nome: 'XP', sigla: 'XP', cor: '#111111', texto: '#FFFFFF', palavras: ['xp investimentos', 'banco xp', 'xp'] },
  { chave: 'mercadopago', nome: 'Mercado Pago', sigla: 'MP', cor: '#009EE3', texto: '#00244D', palavras: ['mercado pago', 'mercadopago'] },
  { chave: 'picpay', nome: 'PicPay', sigla: 'Pp', cor: '#21C25E', texto: '#06331A', palavras: ['picpay'] },
  { chave: 'neon', nome: 'Neon', sigla: 'Ne', cor: '#00D9E8', texto: '#00323A', palavras: ['neon'] },
  { chave: 'next', nome: 'Next', sigla: 'Nx', cor: '#00FF5F', texto: '#003B16', palavras: ['next'] },
  { chave: 'pagbank', nome: 'PagBank', sigla: 'PB', cor: '#41B34A', texto: '#05260A', palavras: ['pagbank', 'pagseguro'] },
  { chave: 'original', nome: 'Banco Original', sigla: 'Or', cor: '#00A859', texto: '#00301A', palavras: ['banco original', 'original'] },
  { chave: 'will', nome: 'Will Bank', sigla: 'Wi', cor: '#FFD60A', texto: '#1A1A1A', palavras: ['will bank', 'willbank'] },
  { chave: 'safra', nome: 'Safra', sigla: 'Sf', cor: '#002D5A', texto: '#FFFFFF', palavras: ['safra'] },
  { chave: 'sicredi', nome: 'Sicredi', sigla: 'Sc', cor: '#2E7D0F', texto: '#FFFFFF', palavras: ['sicredi'] },
  { chave: 'sicoob', nome: 'Sicoob', sigla: 'Sb', cor: '#003641', texto: '#FFFFFF', palavras: ['sicoob'] },
  { chave: 'banrisul', nome: 'Banrisul', sigla: 'Bn', cor: '#00529B', texto: '#FFFFFF', palavras: ['banrisul'] },
  { chave: 'brb', nome: 'BRB', sigla: 'BRB', cor: '#005AA7', texto: '#FFFFFF', palavras: ['brb'] },
  { chave: 'revolut', nome: 'Revolut', sigla: 'Rv', cor: '#0666EB', texto: '#FFFFFF', palavras: ['revolut'] },
]

/** Sem acento, minúsculas, em palavras: "Conta Corrente Itaú João" → [conta, corrente, itau, joao]. */
function palavrasDe(nome: string): string[] {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

/** O nome cita a expressão como palavras seguidas e inteiras ("inter" casa em "Conta Inter", não em "Internacional"). */
function cita(palavras: string[], expressao: string): boolean {
  const alvo = expressao.split(' ')
  for (let i = 0; i + alvo.length <= palavras.length; i++) {
    if (alvo.every((p, k) => palavras[i + k] === p)) return true
  }
  return false
}

/** O banco citado no nome da conta, ou null (carteira em dinheiro nunca é banco: "Caixa da casa" não é a Caixa). */
export function bancoDaConta(nome: string, tipo: TipoConta): Banco | null {
  if (tipo === 'cash') return null
  const palavras = palavrasDe(nome)
  return BANCOS.find((b) => b.palavras.some((expr) => cita(palavras, expr))) ?? null
}

/** Logos colocados em `src/assets/bancos/<chave>.(svg|png|webp)`; a chave é a de `BANCOS`. Banco sem arquivo usa a sigla. */
const arquivos = import.meta.glob('../assets/bancos/*.{svg,png,webp}', { query: '?url', import: 'default', eager: true }) as Record<string, string>

export const LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(arquivos).map(([caminho, url]) => [caminho.replace(/^.*\//, '').replace(/\.[^.]+$/, ''), url]),
)
