import type { HTMLAttributes } from 'react'

export type BancoId =
  | 'nubank'
  | 'itau'
  | 'bradesco'
  | 'santander'
  | 'bb'
  | 'inter'
  | 'caixa'
  | 'c6'
  | 'xp'
  | 'btg'
  | 'original'
  | 'pagbank'
  | 'mercadopago'
  | 'picpay'
  | 'safra'
  | 'sicoob'
  | 'sicredi'
  | 'neon'
  | 'banrisul'
  | 'brb'
  | 'pan'
  | 'bmg'
  | 'stone'
  | 'cora'
  | 'nomad'
  | 'wise'
  | 'avenue'
  | 'c6global'
  | 'dinheiro'
  | 'generico'

export interface BancoInfo {
  id: BancoId
  codigo: string
  nome: string
  nomeCurto: string
  cor: string
  corTexto: string
  moedaPadrao: 'BRL' | 'USD' | 'EUR'
  svgPath: string
  bgFundo?: string
}

/**
 * Catálogo baseado no repositório Bancos-em-SVG (Tgentil/Bancos-em-SVG)
 * e especificações COMPE Febraban / lecdt.com bancos-brasil
 */
export const BANCOS_BRASIL: Record<BancoId, BancoInfo> = {
  nubank: {
    id: 'nubank',
    codigo: '260',
    nome: 'Nu Pagamentos S.A. (Nubank)',
    nomeCurto: 'Nubank',
    cor: '#820AD1',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/nubank.svg',
    bgFundo: '#820AD1',
  },
  itau: {
    id: 'itau',
    codigo: '341',
    nome: 'Itaú Unibanco S.A.',
    nomeCurto: 'Itaú',
    cor: '#EC7000',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/itau.svg',
    bgFundo: '#FFFFFF',
  },
  bradesco: {
    id: 'bradesco',
    codigo: '237',
    nome: 'Banco Bradesco S.A.',
    nomeCurto: 'Bradesco',
    cor: '#CC092F',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/bradesco.svg',
    bgFundo: '#FFFFFF',
  },
  santander: {
    id: 'santander',
    codigo: '033',
    nome: 'Banco Santander (Brasil) S.A.',
    nomeCurto: 'Santander',
    cor: '#EC0000',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/santander.svg',
    bgFundo: '#FFFFFF',
  },
  bb: {
    id: 'bb',
    codigo: '001',
    nome: 'Banco do Brasil S.A.',
    nomeCurto: 'Banco do Brasil',
    cor: '#003399',
    corTexto: '#FCDE00',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/bb.svg',
    bgFundo: '#FCDE00',
  },
  inter: {
    id: 'inter',
    codigo: '077',
    nome: 'Banco Inter S.A.',
    nomeCurto: 'Inter',
    cor: '#FF7A00',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/inter.svg',
    bgFundo: '#FFFFFF',
  },
  caixa: {
    id: 'caixa',
    codigo: '104',
    nome: 'Caixa Econômica Federal',
    nomeCurto: 'Caixa',
    cor: '#005CA9',
    corTexto: '#F37021',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/caixa.svg',
    bgFundo: '#FFFFFF',
  },
  c6: {
    id: 'c6',
    codigo: '336',
    nome: 'Banco C6 S.A.',
    nomeCurto: 'C6 Bank',
    cor: '#1A1A1A',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/c6.svg',
    bgFundo: '#1A1A1A',
  },
  xp: {
    id: 'xp',
    codigo: '102',
    nome: 'XP Investimentos CCTVM S.A.',
    nomeCurto: 'XP',
    cor: '#002D62',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/xp.svg',
    bgFundo: '#000000',
  },
  btg: {
    id: 'btg',
    codigo: '208',
    nome: 'Banco BTG Pactual S.A.',
    nomeCurto: 'BTG Pactual',
    cor: '#001E62',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/btg.svg',
    bgFundo: '#001E62',
  },
  safra: {
    id: 'safra',
    codigo: '422',
    nome: 'Banco Safra S.A.',
    nomeCurto: 'Safra',
    cor: '#12263F',
    corTexto: '#D4AF37',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/safra.svg',
    bgFundo: '#12263F',
  },
  sicoob: {
    id: 'sicoob',
    codigo: '756',
    nome: 'Banco Cooperativo Sicoob',
    nomeCurto: 'Sicoob',
    cor: '#003641',
    corTexto: '#00AE9D',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/sicoob.svg',
    bgFundo: '#003641',
  },
  sicredi: {
    id: 'sicredi',
    codigo: '748',
    nome: 'Banco Cooperativo Sicredi',
    nomeCurto: 'Sicredi',
    cor: '#00843D',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/sicredi.svg',
    bgFundo: '#FFFFFF',
  },
  neon: {
    id: 'neon',
    codigo: '655',
    nome: 'Neon Pagamentos',
    nomeCurto: 'Neon',
    cor: '#00A3FF',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/neon.svg',
    bgFundo: '#FFFFFF',
  },
  banrisul: {
    id: 'banrisul',
    codigo: '041',
    nome: 'Banco do Estado do Rio Grande do Sul',
    nomeCurto: 'Banrisul',
    cor: '#004F9F',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/banrisul.svg',
    bgFundo: '#FFFFFF',
  },
  brb: {
    id: 'brb',
    codigo: '070',
    nome: 'Banco de Brasília S.A.',
    nomeCurto: 'BRB',
    cor: '#003B71',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/brb.svg',
    bgFundo: '#003B71',
  },
  original: {
    id: 'original',
    codigo: '212',
    nome: 'Banco Original S.A.',
    nomeCurto: 'Original',
    cor: '#00965E',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/original.svg',
    bgFundo: '#FFFFFF',
  },
  pagbank: {
    id: 'pagbank',
    codigo: '290',
    nome: 'PagBank (PagSeguro)',
    nomeCurto: 'PagBank',
    cor: '#00B175',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/pagbank.svg',
    bgFundo: '#FFFFFF',
  },
  mercadopago: {
    id: 'mercadopago',
    codigo: '323',
    nome: 'Mercado Pago IP Ltda',
    nomeCurto: 'Mercado Pago',
    cor: '#009EE3',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/mercadopago.svg',
    bgFundo: '#009EE3',
  },
  picpay: {
    id: 'picpay',
    codigo: '380',
    nome: 'PicPay Instituição de Pagamento',
    nomeCurto: 'PicPay',
    cor: '#11C76F',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/picpay.svg',
    bgFundo: '#11C76F',
  },
  stone: {
    id: 'stone',
    codigo: '197',
    nome: 'Stone Pagamentos S.A.',
    nomeCurto: 'Stone',
    cor: '#00A868',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/stone.svg',
    bgFundo: '#FFFFFF',
  },
  cora: {
    id: 'cora',
    codigo: '403',
    nome: 'Cora Sociedade de Crédito Direto',
    nomeCurto: 'Cora',
    cor: '#FE3C72',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/cora.svg',
    bgFundo: '#FFFFFF',
  },
  pan: {
    id: 'pan',
    codigo: '623',
    nome: 'Banco Pan S.A.',
    nomeCurto: 'Pan',
    cor: '#0084FF',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/pan.svg',
    bgFundo: '#FFFFFF',
  },
  bmg: {
    id: 'bmg',
    codigo: '318',
    nome: 'Banco BMG S.A.',
    nomeCurto: 'BMG',
    cor: '#FF5A00',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/bmg.svg',
    bgFundo: '#FFFFFF',
  },
  // Contas Internacionais em Dólar e Euro
  nomad: {
    id: 'nomad',
    codigo: 'USD',
    nome: 'Nomad Global (Conta Dólar)',
    nomeCurto: 'Nomad (USD)',
    cor: '#FFD400',
    corTexto: '#111827',
    moedaPadrao: 'USD',
    svgPath: '/bancos/nomad.svg',
    bgFundo: '#FFD400',
  },
  wise: {
    id: 'wise',
    codigo: 'EUR',
    nome: 'Wise Multi-currency Account',
    nomeCurto: 'Wise (EUR)',
    cor: '#9FE870',
    corTexto: '#163300',
    moedaPadrao: 'EUR',
    svgPath: '/bancos/wise.svg',
    bgFundo: '#9FE870',
  },
  avenue: {
    id: 'avenue',
    codigo: 'USD',
    nome: 'Avenue Securities LLC',
    nomeCurto: 'Avenue (USD)',
    cor: '#0A192F',
    corTexto: '#00E5FF',
    moedaPadrao: 'USD',
    svgPath: '/bancos/avenue.svg',
    bgFundo: '#0A192F',
  },
  c6global: {
    id: 'c6global',
    codigo: 'EUR',
    nome: 'C6 Conta Global Euro',
    nomeCurto: 'C6 Global (EUR)',
    cor: '#27272A',
    corTexto: '#FFFFFF',
    moedaPadrao: 'EUR',
    svgPath: '/bancos/c6.svg',
    bgFundo: '#27272A',
  },
  dinheiro: {
    id: 'dinheiro',
    codigo: 'ESP',
    nome: 'Carteira / Dinheiro em Espécie',
    nomeCurto: 'Dinheiro Físico',
    cor: '#10B981',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/dinheiro.svg',
    bgFundo: '#10B981',
  },
  generico: {
    id: 'generico',
    codigo: '000',
    nome: 'Outra Instituição Financeira',
    nomeCurto: 'Outro',
    cor: '#2563EB',
    corTexto: '#FFFFFF',
    moedaPadrao: 'BRL',
    svgPath: '/bancos/generico.svg',
    bgFundo: '#3B82F6',
  },
}

export const LISTA_BANCOS_BRASIL: BancoInfo[] = Object.values(BANCOS_BRASIL)

export function identificarBanco(nomeOuInstituicao: string): BancoId {
  const t = (nomeOuInstituicao || '').toLowerCase()
  if (t.includes('nomad')) return 'nomad'
  if (t.includes('wise')) return 'wise'
  if (t.includes('avenue')) return 'avenue'
  if (t.includes('c6 global') || t.includes('global')) return 'c6global'
  if (t.includes('nu') || t.includes('roxinho')) return 'nubank'
  if (t.includes('ita') || t.includes('itau')) return 'itau'
  if (t.includes('bradesco')) return 'bradesco'
  if (t.includes('santander')) return 'santander'
  if (t.includes('brasil') || t.includes('bb') || t.includes('banco do brasil')) return 'bb'
  if (t.includes('inter')) return 'inter'
  if (t.includes('caixa') || t.includes('cef')) return 'caixa'
  if (t.includes('c6')) return 'c6'
  if (t.includes('xp')) return 'xp'
  if (t.includes('btg')) return 'btg'
  if (t.includes('safra')) return 'safra'
  if (t.includes('sicoob')) return 'sicoob'
  if (t.includes('sicredi')) return 'sicredi'
  if (t.includes('neon')) return 'neon'
  if (t.includes('banrisul')) return 'banrisul'
  if (t.includes('brb')) return 'brb'
  if (t.includes('original')) return 'original'
  if (t.includes('pagbank') || t.includes('pagseguro')) return 'pagbank'
  if (t.includes('mercado') || t.includes('pago')) return 'mercadopago'
  if (t.includes('picpay')) return 'picpay'
  if (t.includes('stone')) return 'stone'
  if (t.includes('cora')) return 'cora'
  if (t.includes('pan')) return 'pan'
  if (t.includes('bmg')) return 'bmg'
  if (t.includes('dinheiro') || t.includes('carteira') || t.includes('física') || t.includes('espécie')) return 'dinheiro'
  return 'generico'
}

interface LogoProps extends HTMLAttributes<HTMLSpanElement> {
  banco: string | BancoId
  tamanho?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  redondo?: boolean
}

const dimensoes = {
  xs: 'h-5 w-5 p-0.5',
  sm: 'h-6 w-6 p-0.5',
  md: 'h-8 w-8 p-1',
  lg: 'h-10 w-10 p-1.5',
  xl: 'h-12 w-12 p-2',
}

export function BancoLogo({
  banco,
  tamanho = 'md',
  redondo = false,
  className = '',
  ...rest
}: LogoProps) {
  const bancoId: BancoId = (banco in BANCOS_BRASIL ? banco : identificarBanco(banco)) as BancoId
  const info = BANCOS_BRASIL[bancoId] || BANCOS_BRASIL.generico
  const dim = dimensoes[tamanho]
  const radius = redondo ? 'rounded-full' : 'rounded-xl'

  // Determina se a logo usa container com fundo especial
  const fundo = info.bgFundo || info.cor || '#FFFFFF'
  const isFundoClaro = fundo.toUpperCase() === '#FFFFFF' || fundo.toUpperCase() === '#FCDE00'

  return (
    <span
      {...rest}
      className={`inline-flex items-center justify-center shrink-0 overflow-hidden relative select-none shadow-sm transition-transform border ${
        isFundoClaro ? 'border-slate-200/80 shadow-slate-100' : 'border-black/5 shadow-black/10'
      } ${dim} ${radius} ${className}`}
      style={{ backgroundColor: fundo }}
      title={`${info.nomeCurto} ${info.codigo !== '000' && info.codigo !== 'ESP' ? `(COMPE ${info.codigo})` : ''}`}
    >
      <img
        src={info.svgPath}
        alt={info.nomeCurto}
        loading="lazy"
        className="h-full w-full object-contain pointer-events-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.05)]"
        onError={(e) => {
          // Fallback elegante se falhar
          const target = e.currentTarget
          target.style.display = 'none'
          const parent = target.parentElement
          if (parent && !parent.querySelector('.logo-fallback')) {
            const fallback = document.createElement('span')
            fallback.className = 'logo-fallback font-black text-[9px] uppercase tracking-tighter'
            fallback.style.color = info.corTexto
            fallback.textContent = info.nomeCurto.slice(0, 2)
            parent.appendChild(fallback)
          }
        }}
      />
    </span>
  )
}

export function MoedaBadge({ moeda = 'BRL' }: { moeda?: 'BRL' | 'USD' | 'EUR' }) {
  if (moeda === 'USD') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-900 border border-amber-300">
        <span>🇺🇸</span> USD $
      </span>
    )
  }
  if (moeda === 'EUR') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-900 border border-blue-300">
        <span>🇪🇺</span> EUR €
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-900 border border-emerald-300">
      <span>🇧🇷</span> BRL R$
    </span>
  )
}

export function BandeiraCartaoLogo({ bandeira = 'visa' }: { bandeira: string }) {
  const b = (bandeira || '').toLowerCase()
  if (b === 'mastercard') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500 inline-block -mr-1.5 opacity-90" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-500 inline-block opacity-90" />
        <span className="ml-1">Mastercard</span>
      </span>
    )
  }
  if (b === 'elo') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-black text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded-md border border-yellow-200">
        Elo
      </span>
    )
  }
  if (b === 'amex') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-black text-cyan-800 bg-cyan-50 px-2 py-0.5 rounded-md border border-cyan-200">
        Amex
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-black italic text-blue-700 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200">
      VISA
    </span>
  )
}
