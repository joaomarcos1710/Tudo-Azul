import { describe, expect, it } from 'vitest'
import { ATALHOS, divisoes, moverPeriodo, periodoDoCiclo, periodoDoCicloDe, periodoDoMes, rotuloPeriodo, rotulosLinha } from './periodoRelatorio'

/**
 * Mês e ciclo (dono, 22/11/2026: "mês é mês, 01 a 30/31; período é o que escolhemos"). "Este mês" é sempre o mês de
 * calendário. O ciclo da pessoa (dia 20 nas Preferências: 20 a 19) é um período à escolha ("Meu ciclo"), com a mesma
 * chave do Orçamento: o mês em que o ciclo começa.
 */
describe('mês de calendário e ciclo da pessoa', () => {
  it('"Este mês" é sempre de 1 ao último dia, qualquer que seja o dia das Preferências', () => {
    expect(periodoDoMes('2026-11')).toEqual({ tipo: 'mes', de: '2026-11-01', ate: '2026-11-30' })
    expect(periodoDoMes('2028-02')).toEqual({ tipo: 'mes', de: '2028-02-01', ate: '2028-02-29' })
    expect(ATALHOS.find((a) => a.chave === 'mes')!.criar('2026-11-21')).toEqual({ tipo: 'mes', de: '2026-11-01', ate: '2026-11-30' })
  })

  it('ciclo com dia 20: a chave é o mês em que começa (20/11 a 19/12), inclusive na virada do ano e em fevereiro', () => {
    expect(periodoDoCiclo('2026-11', 20)).toEqual({ tipo: 'ciclo', de: '2026-11-20', ate: '2026-12-19' })
    expect(periodoDoCiclo('2026-12', 20)).toEqual({ tipo: 'ciclo', de: '2026-12-20', ate: '2027-01-19' })
    expect(periodoDoCiclo('2027-02', 28)).toEqual({ tipo: 'ciclo', de: '2027-02-28', ate: '2027-03-27' })
  })

  it('o ciclo de hoje: do dia 20 em diante é o que começa neste mês; antes do dia 20 ainda vale o do mês anterior', () => {
    expect(periodoDoCicloDe('2026-11-20', 20)).toEqual({ tipo: 'ciclo', de: '2026-11-20', ate: '2026-12-19' })
    expect(periodoDoCicloDe('2026-11-19', 20)).toEqual({ tipo: 'ciclo', de: '2026-10-20', ate: '2026-11-19' })
    expect(periodoDoCicloDe('2027-01-05', 20)).toEqual({ tipo: 'ciclo', de: '2026-12-20', ate: '2027-01-19' })
  })

  it('as setas: o mês anda de mês em mês; o ciclo anda de ciclo em ciclo, sem perder o dia', () => {
    expect(moverPeriodo(periodoDoMes('2026-01'), 1)).toEqual({ tipo: 'mes', de: '2026-02-01', ate: '2026-02-28' })
    const nov = periodoDoCiclo('2026-11', 20)
    expect(moverPeriodo(nov, 1)).toEqual({ tipo: 'ciclo', de: '2026-12-20', ate: '2027-01-19' })
    expect(moverPeriodo(nov, -1)).toEqual({ tipo: 'ciclo', de: '2026-10-20', ate: '2026-11-19' })
    expect(moverPeriodo(moverPeriodo(nov, 1), -1)).toEqual(nov)
  })

  it('rótulos: o mês pelo nome; o ciclo pelas datas (o nome esconderia a parte do mês seguinte)', () => {
    expect(rotuloPeriodo(periodoDoMes('2026-11'))).toBe('Novembro de 2026')
    expect(rotuloPeriodo(periodoDoCiclo('2026-11', 20))).toBe('20/11 a 19/12/2026')
    expect(rotuloPeriodo(periodoDoCiclo('2026-12', 20))).toBe('20/12 a 19/01/2027')
    const c = periodoDoCiclo('2026-11', 20)
    expect(rotulosLinha(c.de, c.ate, 'total', c).curto).toBe('20/11 a 19/12/2026')
    expect(rotulosLinha('2026-11-01', '2026-11-30', 'total', periodoDoMes('2026-11')).curto).toBe('Nov de 2026')
  })

  it('no ciclo a divisão "Mensal" fica apagada (ele é um período só, não dois pedaços de calendário)', () => {
    const mensal = (p: ReturnType<typeof periodoDoMes>) => divisoes(p).find((d) => d.chave === 'month')!
    expect(mensal(periodoDoCiclo('2026-11', 20)).ativa).toBe(false)
    expect(mensal({ tipo: 'livre', de: '2026-11-20', ate: '2026-12-19' }).ativa).toBe(true)
  })
})
