import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CORES, FUNDOS, SELO, SELO_FATURA, corDoTipo, corDoValor } from './cores'
import config from '../../tailwind.config.js'

/** Contraste WCAG 2.x entre duas cores #RRGGBB. */
function contraste(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

const PAPEIS = ['lucro', 'prejuizo', 'atencao', 'agendado', 'neutro', 'transferencia'] as const

describe('sistema de cores (#183)', () => {
  it('cada tom tem o papel que o dono pediu: azul lucro, vermelho prejuízo, âmbar atenção, verde agendado, cinza neutro, marinho transferência', () => {
    // matiz dominante de cada texto, para ninguém trocar "verde" por outro azul sem perceber
    const canal = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const [r1, g1, b1] = canal(CORES.lucro.DEFAULT); expect(b1).toBeGreaterThan(Math.max(r1, g1))
    const [r2, g2, b2] = canal(CORES.prejuizo.DEFAULT); expect(r2).toBeGreaterThan(Math.max(g2, b2))
    const [r3, g3, b3] = canal(CORES.atencao.DEFAULT); expect(r3).toBeGreaterThan(g3); expect(g3).toBeGreaterThan(b3)
    const [r4, g4, b4] = canal(CORES.agendado.DEFAULT); expect(g4).toBeGreaterThan(Math.max(r4, b4))
  })

  it('texto passa AA (≥ 4,5:1) no branco, no fundo do app e no fundo do próprio selo', () => {
    for (const p of PAPEIS) {
      const tom = CORES[p]
      expect(contraste(tom.DEFAULT, FUNDOS.branco), `${p} no branco`).toBeGreaterThanOrEqual(4.5)
      expect(contraste(tom.DEFAULT, FUNDOS.app), `${p} no fundo do app`).toBeGreaterThanOrEqual(4.5)
      expect(contraste(tom.DEFAULT, tom.fundo), `${p} no selo`).toBeGreaterThanOrEqual(4.5)
    }
    // vermelho do saldo negativo no card escuro do patrimônio (marinho)
    expect(contraste(CORES.prejuizo['sobre-escuro'], CORES.transferencia.DEFAULT)).toBeGreaterThanOrEqual(4.5)
    // botões cheios com texto branco (aba Receita/Despesa/Transferência, "Vencida")
    for (const p of ['lucro', 'prejuizo', 'transferencia'] as const) expect(contraste('#FFFFFF', CORES[p].DEFAULT)).toBeGreaterThanOrEqual(4.5)
  })

  it('barra, ponto e ícone sem texto (`marca`) passam de 3:1 no branco e no fundo do app', () => {
    for (const p of ['lucro', 'prejuizo', 'atencao', 'agendado', 'neutro'] as const) {
      expect(contraste(CORES[p].marca, FUNDOS.branco), `${p} marca no branco`).toBeGreaterThanOrEqual(3)
      expect(contraste(CORES[p].marca, FUNDOS.app), `${p} marca no fundo`).toBeGreaterThanOrEqual(3)
    }
  })

  it('o Tailwind lê a mesma fonte: text-lucro, bg-agendado-fundo… são estes hex, e o laranja/verde antigos saíram', () => {
    const cores = config.theme.extend.colors as Record<string, unknown>
    for (const p of PAPEIS) expect(cores[p]).toEqual(CORES[p])
    expect(cores.negativo).toEqual(CORES.prejuizo) // erro e ação destrutiva: o mesmo vermelho
    expect(cores.azul).toEqual({ DEFAULT: CORES.lucro.DEFAULT, claro: CORES.lucro.fundo }) // Relatórios usam text-azul
    for (const antigo of ['positivo', 'planejado', 'pago']) expect(cores[antigo]).toBeUndefined()
  })

  it('valor com sinal: positivo azul, negativo vermelho, zero cinza; tipo: receita azul, despesa vermelha, transferência marinho', () => {
    expect([corDoValor(1), corDoValor(-1), corDoValor(0)]).toEqual(['text-lucro', 'text-prejuizo', 'text-neutro'])
    expect([corDoTipo('income'), corDoTipo('expense'), corDoTipo('transfer')]).toEqual(['text-lucro', 'text-prejuizo', 'text-transferencia'])
  })

  it('selos: Planejado verde, Pago azul, Vencido vermelho; fatura aberta verde, fechada (a pagar) atenção, paga azul', () => {
    expect(SELO.planejado).toBe('bg-agendado-fundo text-agendado')
    expect(SELO.pago).toBe('bg-lucro-fundo text-lucro')
    expect(SELO.vencido).toBe('bg-prejuizo-fundo text-prejuizo')
    expect(SELO_FATURA.aberta.estilo).toBe(SELO.planejado)
    expect(SELO_FATURA.fechada.estilo).toBe('bg-atencao-fundo text-atencao')
    expect(SELO_FATURA.vencida.estilo).toBe(SELO.vencido)
    expect(SELO_FATURA.paga.estilo).toBe(SELO.pago)
  })
})

describe('nenhuma tela usa cor solta (#183)', () => {
  const raiz = join(__dirname, '..')
  const arquivos = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
  })
  const fontes = arquivos(raiz).map((p) => ({ nome: relative(raiz, p).replace(/\\/g, '/'), texto: readFileSync(p, 'utf8') }))

  it('sem os tokens antigos (positivo, planejado, pago) nem a paleta crua do Tailwind (green-, amber-, red-, orange-…)', () => {
    const proibido = /\b(?:text|bg|border|fill|stroke|ring|outline|divide|from|to|decoration)-(?:positivo|planejado|pago|(?:green|emerald|lime|teal|amber|yellow|orange|red|rose)-\d{2,3})\b/g
    const achados = fontes.flatMap((f) => [...f.texto.matchAll(proibido)].map((m) => `${f.nome}: ${m[0]}`))
    expect(achados).toEqual([])
  })

  it('sem hex nem rgba escrito nas telas: só nas fontes de cor (lib/cores, gráficos/cores) e nas marcas (bancos, logo, categorias)', () => {
    const permitidos = ['lib/cores.ts', 'components/graficos/cores.ts', 'lib/bancos.ts', 'lib/visualCategoria.tsx', 'components/layout/Marca.tsx']
    const cor = /['"`](?:#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))['"`]/g
    const achados = fontes.filter((f) => !permitidos.includes(f.nome))
      .flatMap((f) => [...f.texto.matchAll(cor)].map((m) => `${f.nome}: ${m[0]}`))
    expect(achados).toEqual([])
  })
})
