// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Cents } from '../lib/format'

const mock = vi.hoisted(() => ({
  listarOrcamentos: vi.fn(),
  definirOrcamento: vi.fn(),
  removerOrcamento: vi.fn(),
  copiarDoMesAnterior: vi.fn(),
  listarCategorias: vi.fn(),
}))
vi.mock('../lib/FamiliaContext', () => ({
  useFamilia: () => ({ familia: { id: 'h1', nome: 'Casa', papel: 'owner' }, carregando: false, erro: false, recarregar: vi.fn() }),
}))
vi.mock('../lib/orcamentos', () => ({
  listarOrcamentos: mock.listarOrcamentos, definirOrcamento: mock.definirOrcamento,
  removerOrcamento: mock.removerOrcamento, copiarDoMesAnterior: mock.copiarDoMesAnterior,
}))
vi.mock('../lib/categorias', async (o) => ({ ...(await o<typeof import('../lib/categorias')>()), listarCategorias: mock.listarCategorias }))
// data e mês fixos: o teste não depende do dia em que roda
const hojeFixo = vi.hoisted(() => ({ v: '2026-10-10' }))
vi.mock('../lib/contas', async (o) => ({ ...(await o<typeof import('../lib/contas')>()), hojeSP: () => hojeFixo.v }))
vi.mock('../lib/format', async (o) => ({ ...(await o<typeof import('../lib/format')>()), currentMonth: () => hojeFixo.v.slice(0, 7) }))

import Orcamentos from './Orcamentos'

const c = (n: number) => n as Cents
const cat = (id: string, nome: string, extra: Record<string, unknown> = {}) =>
  ({ id, nome, tipo: 'expense', paiId: null, sistema: false, ativa: true, eventual: false, ...extra })
const orc = (extra: Record<string, unknown> = {}) => ({
  categoriaId: 'mercado', nome: 'Mercado', limite: c(100000), gasto: c(30000), previsto: c(20000), ritmo: c(63000),
  projetado: c(113000), sobra: c(-13000), ...extra,
})

beforeEach(() => {
  hojeFixo.v = '2026-10-10'
  mock.listarOrcamentos.mockResolvedValue([orc()])
  mock.listarCategorias.mockResolvedValue([
    cat('mercado', 'Mercado'), cat('lazer', 'Lazer'), cat('feira', 'Feira', { paiId: 'mercado' }), cat('antiga', 'Antiga', { ativa: false }),
    cat('semcat', 'Sem categoria', { sistema: true }), cat('salario', 'Salário', { tipo: 'income' }),
  ])
  for (const f of [mock.definirOrcamento, mock.removerOrcamento]) f.mockResolvedValue(undefined)
  mock.copiarDoMesAnterior.mockResolvedValue(2)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('Orçamentos', () => {
  it('mostra limite, gasto e a projeção do banco: vai passar do limite no ritmo atual', async () => {
    render(<Orcamentos />)
    expect(await screen.findByText('Mercado')).toBeTruthy()
    expect(screen.getByText('Limite R$ 1.000,00')).toBeTruthy()
    expect(screen.getByText('R$ 300,00')).toBeTruthy()
    expect(screen.getByText(/No ritmo atual vai passar do limite em R\$ 130,00/)).toBeTruthy()
    expect(screen.getByText(/projeção R\$ 1.130,00/)).toBeTruthy()
    expect(screen.getByText(/Gasto R\$ 300,00 \+ previsto R\$ 200,00 \+ ritmo do mês R\$ 630,00/)).toBeTruthy()
    expect(mock.listarOrcamentos).toHaveBeenCalledWith('h1', '2026-10', '2026-10-10')
  })

  it('projeção dentro do limite: mostra quanto sobra', async () => {
    mock.listarOrcamentos.mockResolvedValue([orc({ projetado: c(80000), sobra: c(20000) })])
    render(<Orcamentos />)
    expect(await screen.findByText(/No ritmo: projeção R\$ 800,00, sobram R\$ 200,00/)).toBeTruthy()
  })

  it('já estourou o limite: avisa o quanto, sem falar de projeção', async () => {
    mock.listarOrcamentos.mockResolvedValue([orc({ gasto: c(120000), projetado: c(150000), sobra: c(-50000), restante: c(-20000) })])
    render(<Orcamentos />)
    expect(await screen.findByText('Já passou do limite em R$ 200,00.')).toBeTruthy()
    expect(screen.queryByText(/No ritmo/)).toBeNull()
  })

  it('gasto exatamente no limite: "Chegou ao limite." (barra vermelha), nunca "sobram R$ 0,00" (#191)', async () => {
    // no mês corrente (com projeção) e num mês passado (sem projeção): os centavos do banco são iguais
    mock.listarOrcamentos.mockResolvedValue([orc({ gasto: c(100000), restante: c(0), projetado: c(100000), sobra: c(0) })])
    const u = userEvent.setup()
    const { container } = render(<Orcamentos />)
    const aviso = await screen.findByText('Chegou ao limite.')
    expect(aviso.className).toMatch(/text-prejuizo/)
    expect(screen.queryByText(/sobram/)).toBeNull()
    expect(screen.queryByText(/passou do limite/i)).toBeNull()
    expect(container.querySelector('[data-faixa]')?.getAttribute('data-faixa')).toBe('estourou')
    mock.listarOrcamentos.mockResolvedValue([orc({ gasto: c(100000), restante: c(0), previsto: null, ritmo: null, projetado: null, sobra: null })])
    await u.click(screen.getByRole('button', { name: 'Mês anterior' }))
    await vi.waitFor(() => expect(mock.listarOrcamentos).toHaveBeenLastCalledWith('h1', '2026-09', '2026-10-10'))
    expect(await screen.findByText('Chegou ao limite.')).toBeTruthy()
    expect(screen.queryByText(/sobram/)).toBeNull()
  })

  it('um centavo abaixo do limite: ainda dentro, sobra R$ 0,01', async () => {
    mock.listarOrcamentos.mockResolvedValue([orc({ gasto: c(99999), restante: c(1), previsto: null, ritmo: null, projetado: null, sobra: null })])
    const u = userEvent.setup()
    render(<Orcamentos />)
    await screen.findByText('Mercado')
    await u.click(screen.getByRole('button', { name: 'Mês anterior' }))
    expect(await screen.findByText(/Ainda dentro do limite: sobram R\$ 0,01/)).toBeTruthy()
    expect(screen.queryByText('Chegou ao limite.')).toBeNull()
  })

  it('mês passado: sem projeção, só o resultado', async () => {
    mock.listarOrcamentos.mockResolvedValue([orc({ gasto: c(90000), previsto: null, ritmo: null, projetado: null, sobra: null, restante: c(10000) })])
    const u = userEvent.setup()
    render(<Orcamentos />)
    await screen.findByText('Mercado')
    await u.click(screen.getByRole('button', { name: 'Mês anterior' }))
    expect(await screen.findByText(/Ainda dentro do limite: sobram R\$ 100,00/)).toBeTruthy()
    expect(mock.listarOrcamentos).toHaveBeenLastCalledWith('h1', '2026-09', '2026-10-10')
  })

  it('mês futuro com previsto acima do limite: avisa em vez de dizer que sobra', async () => {
    mock.listarOrcamentos.mockResolvedValue([orc({ gasto: c(0), previsto: c(40000), ritmo: c(0), projetado: c(40000), limite: c(30000), sobra: c(-10000) })])
    const u = userEvent.setup()
    render(<Orcamentos />)
    await screen.findByText('Mercado')
    await u.click(screen.getByRole('button', { name: 'Próximo mês' }))
    const aviso = await screen.findByText(/Atenção: com o que já está previsto, passa do limite em R\$ 100,00/)
    expect(aviso.className).toMatch(/text-atencao/)
    expect(screen.queryByText(/sobram/)).toBeNull()
  })

  it('trocar de mês rápido: a resposta velha não sobrescreve a do mês atual da tela', async () => {
    let soltarA: (v: unknown) => void = () => {}
    const lenta = new Promise((r) => { soltarA = r })
    mock.listarOrcamentos
      .mockReturnValueOnce(lenta) // outubro (carga inicial), chega por último
      .mockResolvedValueOnce([orc({ nome: 'Lazer', categoriaId: 'lazer' })]) // setembro, chega primeiro
    const u = userEvent.setup()
    render(<Orcamentos />)
    await u.click(await screen.findByRole('button', { name: 'Mês anterior' }))
    expect(await screen.findByText('Lazer')).toBeTruthy()
    soltarA([orc({ nome: 'Mercado' })])
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByText('Mercado')).toBeNull()
    expect(screen.getByText('Lazer')).toBeTruthy()
  })

  it('nos primeiros dias do mês avisa que a projeção é instável', async () => {
    hojeFixo.v = '2026-10-03'
    render(<Orcamentos />)
    expect(await screen.findByText(/Nos primeiros 7 dias do mês a projeção não inclui o ritmo/)).toBeTruthy()
  })

  it('sem orçamento: convida a definir ou copiar do mês anterior', async () => {
    mock.listarOrcamentos.mockResolvedValue([])
    const u = userEvent.setup()
    render(<Orcamentos />)
    expect(await screen.findByText(/Nenhum orçamento em/)).toBeTruthy()
    await u.click(screen.getByRole('button', { name: 'Copiar do mês anterior' }))
    expect(mock.copiarDoMesAnterior).toHaveBeenCalledWith('h1', '2026-10', '2026-09')
    expect(await screen.findByText(/2 limites copiados/)).toBeTruthy()
  })

  it('novo orçamento: só categorias principais de despesa, ativas e sem orçamento; grava em centavos', async () => {
    const u = userEvent.setup()
    render(<Orcamentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo orçamento' }))
    const opcoes = within(screen.getByLabelText('Categoria')).getAllByRole('option').map((o) => o.textContent)
    expect(opcoes).toEqual(['Escolha…', 'Lazer']) // Mercado já tem; Feira é subcategoria; Antiga está desativada; Sem categoria é do sistema
    await u.selectOptions(screen.getByLabelText('Categoria'), 'lazer')
    await u.type(screen.getByLabelText('Limite do mês (R$)'), '1.500,00')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.definirOrcamento).toHaveBeenCalledWith('h1', 'lazer', '2026-10', 150000)
  })

  it('valor zero, inválido ou categoria não escolhida não chegam ao banco', async () => {
    const u = userEvent.setup()
    render(<Orcamentos />)
    await u.click(await screen.findByRole('button', { name: 'Novo orçamento' }))
    await u.type(screen.getByLabelText('Limite do mês (R$)'), '0')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText(/Informe um valor maior que zero/)).toBeTruthy()
    expect(screen.getByText('Escolha a categoria.')).toBeTruthy()
    expect(mock.definirOrcamento).not.toHaveBeenCalled()
  })

  it('alterar o limite grava o novo valor', async () => {
    const u = userEvent.setup()
    render(<Orcamentos />)
    await u.click(await screen.findByRole('button', { name: 'Alterar limite' }))
    const campo = screen.getByLabelText('Limite do mês (R$)') as HTMLInputElement
    expect(campo.value).toBe('1.000,00')
    await u.clear(campo)
    await u.type(campo, '1.200,00')
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(mock.definirOrcamento).toHaveBeenCalledWith('h1', 'mercado', '2026-10', 120000)
  })

  it('remover pede confirmação e só então apaga', async () => {
    const u = userEvent.setup()
    const confirma = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<Orcamentos />)
    await u.click(await screen.findByRole('button', { name: 'Remover' }))
    expect(mock.removerOrcamento).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Remover' }))
    expect(mock.removerOrcamento).toHaveBeenCalledWith('h1', 'mercado', '2026-10')
    expect(confirma).toHaveBeenCalledTimes(2)
  })

  it('auditoria 5h: "Remover" no vermelho de perigo (como no menu ⋯) e ‹ › do mês com alvo de toque de 44px', async () => {
    render(<Orcamentos />)
    const remover = await screen.findByRole('button', { name: 'Remover' })
    expect(remover.className).toContain('text-negativo')
    expect(remover.className).not.toContain('text-azul')
    expect(screen.getByRole('button', { name: 'Mês anterior' }).className).toContain('min-w-11')
    expect(screen.getByRole('button', { name: 'Próximo mês' }).className).toContain('min-w-11')
  })

  it('erro do banco ao salvar aparece e o formulário continua aberto', async () => {
    mock.definirOrcamento.mockRejectedValue(new Error('falhou'))
    const u = userEvent.setup()
    render(<Orcamentos />)
    await u.click(await screen.findByRole('button', { name: 'Alterar limite' }))
    await u.click(screen.getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByLabelText('Limite do mês (R$)')).toBeTruthy()
  })

  it('"passou do limite em" usa o restante do banco, não uma conta na tela', async () => {
    // valor de propósito diferente de gasto − limite: prova que a tela mostra o número do banco
    mock.listarOrcamentos.mockResolvedValue([orc({ gasto: c(120000), projetado: c(150000), sobra: c(-50000), restante: c(-25000) })])
    render(<Orcamentos />)
    expect(await screen.findByText('Já passou do limite em R$ 250,00.')).toBeTruthy()
  })

  it('cor da barra pela faixa de uso (pedido do dono): 50% azul claro, 70% amarelo, 90% vermelho claro, 100% vermelho', async () => {
    const casos: [number, string, string][] = [
      [49999, 'tranquilo', 'bg-lucro-marca'], [50000, 'metade', 'bg-lucro-claro'], [69999, 'metade', 'bg-lucro-claro'],
      [70000, 'atencao', 'bg-atencao-marca'], [90000, 'perto', 'bg-prejuizo-claro'], [99999, 'perto', 'bg-prejuizo-claro'],
      [100000, 'estourou', 'bg-prejuizo-marca'], [130000, 'estourou', 'bg-prejuizo-marca'],
    ]
    mock.listarOrcamentos.mockResolvedValue(casos.map(([g], i) => orc({ categoriaId: `c${i}`, nome: `Cat ${i}`, gasto: c(g), restante: c(100000 - g) })))
    const { container } = render(<Orcamentos />)
    await screen.findByText('Cat 0')
    const barras = [...container.querySelectorAll('[data-faixa]')]
    expect(barras.map((b) => b.getAttribute('data-faixa'))).toEqual(casos.map(([, f]) => f))
    barras.forEach((b, i) => expect(b.className).toContain(casos[i][2]))
  })

  it('mostra o percentual usado ao lado da barra e no rótulo para leitor de tela', async () => {
    mock.listarOrcamentos.mockResolvedValue([orc({ gasto: c(72550) })])
    render(<Orcamentos />)
    expect(await screen.findByText('72%')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Gasto R$ 725,50 de R$ 1.000,00, 72% do limite' })).toBeTruthy()
  })
})
