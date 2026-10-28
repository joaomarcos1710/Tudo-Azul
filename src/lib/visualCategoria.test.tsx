import { describe, expect, it } from 'vitest'
import { CORES, ICONES, sugerirVisual, visualDaCategoria } from './visualCategoria'
import type { Categoria } from './categorias'

const icone = (nome: string, tipo: 'income' | 'expense' = 'expense') => sugerirVisual(nome, tipo).icone

describe('sugerirVisual', () => {
  it('as 17 categorias padrão do banco ganham ícone próprio (só "Outras despesas" fica no genérico)', () => {
    expect([
      icone('Salário', 'income'), icone('Rendimentos', 'income'), icone('Outras receitas', 'income'),
      icone('Moradia'), icone('Mercado'), icone('Restaurantes'), icone('Transporte'), icone('Saúde'), icone('Educação'),
      icone('Lazer'), icone('Assinaturas'), icone('Compras pessoais'), icone('Viagens'), icone('Impostos e taxas'), icone('Outras despesas'),
    ]).toEqual([
      'maleta', 'grafico', 'cifrao',
      'casa', 'carrinho', 'garfo', 'carro', 'coracao', 'capelo',
      'ingresso', 'play', 'sacola', 'aviao', 'recibo', 'etiqueta',
    ])
  })

  it('ignora acento e maiúsculas e aceita plural', () => {
    expect(icone('FARMÁCIA')).toBe('coracao')
    expect(icone('Combustíveis')).toBe('carro')
  })

  it('palavra curta só casa inteira: "IR" é imposto, "Irmão" não', () => {
    expect(icone('IR 2026')).toBe('recibo')
    expect(icone('Irmão')).toBe('etiqueta')
  })

  it('o tipo decide: férias em receita é presente; em despesa é viagem', () => {
    expect(icone('Férias', 'income')).toBe('presente')
    expect(icone('Férias', 'expense')).toBe('aviao')
    expect(icone('13º salário', 'income')).toBe('presente')
  })

  it('sem palavra conhecida: etiqueta (despesa) ou cifrão (receita)', () => {
    expect(sugerirVisual('Coisas do João', 'expense')).toEqual({ icone: 'etiqueta', cor: '#475569' })
    expect(icone('Venda do sofá', 'income')).toBe('cifrao')
  })

  it('sugestões só usam ícones e cores que existem', () => {
    const cores = CORES.map((c) => c.hex)
    for (const nome of ['Mercado', 'Saúde', 'Pet', 'Internet', 'Luz', 'Academia', 'Presentes']) {
      const v = sugerirVisual(nome, 'expense')
      expect(Object.keys(ICONES)).toContain(v.icone)
      expect(cores).toContain(v.cor)
    }
  })

  it('a paleta não usa vermelho, verde nem âmbar (cores de despesa, receita e planejado)', () => {
    for (const { hex } of CORES) expect(['#B91C1C', '#15803D', '#B45309', '#047857']).not.toContain(hex)
  })
})

describe('visualDaCategoria', () => {
  const cat = (id: string, nome: string, extra: Partial<Categoria> = {}): Categoria =>
    ({ id, nome, tipo: 'expense', paiId: null, sistema: false, ativa: true, eventual: false, ...extra })

  it('escolha própria > mãe > sugestão, campo a campo', () => {
    const mae = cat('m', 'Saúde', { cor: '#2563EB' })
    const filha = cat('f', 'Academia', { paiId: 'm' })
    const filhaComIcone = cat('g', 'Dentista', { paiId: 'm', icone: 'raio' })
    const porId = new Map([mae, filha, filhaComIcone].map((c) => [c.id, c]))
    expect(visualDaCategoria(mae, porId)).toEqual({ icone: 'coracao', cor: '#2563EB' })
    expect(visualDaCategoria(filha, porId)).toEqual({ icone: 'coracao', cor: '#2563EB' })
    expect(visualDaCategoria(filhaComIcone, porId)).toEqual({ icone: 'raio', cor: '#2563EB' })
  })

  it('ícone desconhecido ou cor inválida no banco caem na sugestão; "Sem categoria" é sempre etiqueta', () => {
    const c = cat('x', 'Mercado', { icone: 'foguete', cor: 'azul' })
    expect(visualDaCategoria(c, new Map())).toEqual(sugerirVisual('Mercado', 'expense'))
    expect(visualDaCategoria(cat('s', 'Sem categoria', { sistema: true, icone: 'casa' }), new Map()).icone).toBe('etiqueta')
  })
})
