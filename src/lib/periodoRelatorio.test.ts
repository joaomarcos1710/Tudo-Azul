import { describe, expect, it } from 'vitest'
import { ATALHOS, divisoes, moverPeriodo, periodoDoMes, periodoDoMesDe, rotuloPeriodo, rotulosLinha } from './periodoRelatorio'

/**
 * O "mês" da pessoa (dono, 21/11/2026: "pode fazer o dia 20 em todas as telas"). Com o dia 20 nas Preferências, "Este
 * mês" em Lançamentos e Relatórios é o ciclo de 20 a 19, com a mesma chave do Orçamento (o mês em que o ciclo começa).
 */
describe('mês da pessoa: calendário (dia 1) ou ciclo (dia 2 a 28)', () => {
  it('dia 1 (padrão) continua o mês de calendário', () => {
    expect(periodoDoMes('2026-11')).toEqual({ tipo: 'mes', de: '2026-11-01', ate: '2026-11-30' })
    expect(periodoDoMes('2026-11', 1)).toEqual({ tipo: 'mes', de: '2026-11-01', ate: '2026-11-30' })
    expect(periodoDoMesDe('2026-11-21')).toEqual({ tipo: 'mes', de: '2026-11-01', ate: '2026-11-30' })
  })

  it('dia 20: a chave é o mês em que o ciclo começa (20/11 a 19/12), inclusive na virada do ano e em fevereiro', () => {
    expect(periodoDoMes('2026-11', 20)).toEqual({ tipo: 'mes', de: '2026-11-20', ate: '2026-12-19' })
    expect(periodoDoMes('2026-12', 20)).toEqual({ tipo: 'mes', de: '2026-12-20', ate: '2027-01-19' })
    expect(periodoDoMes('2027-02', 28)).toEqual({ tipo: 'mes', de: '2027-02-28', ate: '2027-03-27' })
  })

  it('o ciclo de hoje: do dia 20 em diante é o que começa neste mês; antes do dia 20 ainda vale o do mês anterior', () => {
    expect(periodoDoMesDe('2026-11-20', 20)).toEqual({ tipo: 'mes', de: '2026-11-20', ate: '2026-12-19' })
    expect(periodoDoMesDe('2026-11-21', 20)).toEqual({ tipo: 'mes', de: '2026-11-20', ate: '2026-12-19' })
    expect(periodoDoMesDe('2026-11-19', 20)).toEqual({ tipo: 'mes', de: '2026-10-20', ate: '2026-11-19' })
    expect(periodoDoMesDe('2027-01-05', 20)).toEqual({ tipo: 'mes', de: '2026-12-20', ate: '2027-01-19' })
  })

  it('as setas andam de ciclo em ciclo, sem perder o dia', () => {
    const nov = periodoDoMes('2026-11', 20)
    expect(moverPeriodo(nov, 1)).toEqual({ tipo: 'mes', de: '2026-12-20', ate: '2027-01-19' })
    expect(moverPeriodo(nov, -1)).toEqual({ tipo: 'mes', de: '2026-10-20', ate: '2026-11-19' })
    expect(moverPeriodo(moverPeriodo(nov, 1), -1)).toEqual(nov)
    // o mês de calendário continua andando por meses cheios
    expect(moverPeriodo(periodoDoMes('2026-01'), 1)).toEqual({ tipo: 'mes', de: '2026-02-01', ate: '2026-02-28' })
  })

  it('"Este mês" do menu usa o dia da pessoa; os outros atalhos não mudam', () => {
    const esteMes = ATALHOS.find((a) => a.chave === 'mes')!
    expect(esteMes.criar('2026-11-21', 20)).toEqual({ tipo: 'mes', de: '2026-11-20', ate: '2026-12-19' })
    expect(esteMes.criar('2026-11-21')).toEqual({ tipo: 'mes', de: '2026-11-01', ate: '2026-11-30' })
    for (const a of ATALHOS.filter((x) => x.chave !== 'mes')) expect(a.criar('2026-11-21', 20)).toEqual(a.criar('2026-11-21'))
  })

  it('o ciclo aparece pelas datas, não pelo nome do mês (que esconderia a parte de dezembro)', () => {
    expect(rotuloPeriodo(periodoDoMes('2026-11', 20))).toBe('20/11 a 19/12/2026')
    expect(rotuloPeriodo(periodoDoMes('2026-12', 20))).toBe('20/12 a 19/01/2027')
    expect(rotuloPeriodo(periodoDoMes('2026-11'))).toBe('Novembro de 2026')
    const p = periodoDoMes('2026-11', 20)
    expect(rotulosLinha(p.de, p.ate, 'total', p).curto).toBe('20/11 a 19/12/2026')
    expect(rotulosLinha('2026-11-01', '2026-11-30', 'total', periodoDoMes('2026-11')).curto).toBe('Nov de 2026')
  })

  it('no ciclo a divisão "Mensal" fica apagada: ele é um mês só para a pessoa (não dois pedaços de calendário)', () => {
    const mensal = (p: ReturnType<typeof periodoDoMes>) => divisoes(p).find((d) => d.chave === 'month')!
    expect(mensal(periodoDoMes('2026-11', 20)).ativa).toBe(false)
    expect(mensal(periodoDoMes('2026-11')).ativa).toBe(false)
    expect(mensal({ tipo: 'livre', de: '2026-11-20', ate: '2026-12-19' }).ativa).toBe(true)
  })
})
