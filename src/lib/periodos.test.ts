import { describe, expect, it } from 'vitest'
import { limitesDoMes, somarMeses } from './lancamentos'
import {
  diasDoIntervalo, intervaloDoPeriodo, MAX_DIAS_PERSONALIZADO, periodoAnterior, periodoQueContem,
  periodoSeguinte, PeriodoInvalidoError, rotuloDoPeriodo, validarPersonalizado,
  type Periodo,
} from './periodos'

const ciclo = (dia: number, ref: string): Periodo => ({ tipo: 'ciclo', dia, ref })
const mes = (m: string): Periodo => ({ tipo: 'mes', mes: m })
const iv = (p: Periodo) => intervaloDoPeriodo(p)
const par = (p: Periodo) => {
  const { de, ate } = iv(p)
  return [de, ate]
}

/** Calendário de referência, escrito à parte da implementação (Date.UTC). */
const ultimoDia = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate()
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const dia = (s: string) => Date.parse(`${s}T00:00:00Z`)
const MS = 86_400_000
const todosOsMeses = (): string[] => {
  const out: string[] = []
  for (let a = 2000; a <= 2099; a++) for (let m = 1; m <= 12; m++) out.push(`${a}-${String(m).padStart(2, '0')}`)
  return out
}

describe('mês-calendário', () => {
  it('é igual a limitesDoMes nos 1.200 meses de 2000-01 a 2099-12', () => {
    const meses = todosOsMeses()
    expect(meses).toHaveLength(1200)
    for (const m of meses) expect(par(mes(m))).toEqual(limitesDoMes(m))
  })

  it('navega como somarMeses, sem lacuna entre um mês e o seguinte', () => {
    for (const m of todosOsMeses().slice(1, -1)) {
      expect(periodoSeguinte(mes(m))).toEqual(mes(somarMeses(m, 1)))
      expect(periodoAnterior(mes(m))).toEqual(mes(somarMeses(m, -1)))
      const ate = iv(mes(m)).ate
      expect(iv(periodoSeguinte(mes(m))).de).toBe(iso(dia(ate) + MS))
    }
  })

  it('fevereiro comum e bissexto, e virada de ano', () => {
    expect(par(mes('2027-02'))).toEqual(['2027-02-01', '2027-02-28'])
    expect(par(mes('2028-02'))).toEqual(['2028-02-01', '2028-02-29'])
    expect(par(mes('2099-02'))).toEqual(['2099-02-01', '2099-02-28']) // 2100 não é bissexto, mas fica fora da faixa de mês
    expect(par(mes('2096-02'))).toEqual(['2096-02-01', '2096-02-29'])
    expect(par(mes('2000-02'))).toEqual(['2000-02-01', '2000-02-29']) // 2000 é
    expect(periodoSeguinte(mes('2026-12'))).toEqual(mes('2027-01'))
    expect(periodoAnterior(mes('2027-01'))).toEqual(mes('2026-12'))
  })

  it('período que contém uma data, sem configuração, é o mês dela', () => {
    expect(periodoQueContem('2026-10-26', { dia: null })).toEqual(mes('2026-10'))
    expect(periodoQueContem('2028-02-29', { dia: null })).toEqual(mes('2028-02'))
  })
})

describe('ciclo: exemplos da especificação', () => {
  it('D=20 em 2026 (atravessa a virada do ano)', () => {
    expect(par(ciclo(20, '2026-10'))).toEqual(['2026-10-20', '2026-11-19'])
    expect(par(ciclo(20, '2026-11'))).toEqual(['2026-11-20', '2026-12-19'])
    expect(par(ciclo(20, '2026-12'))).toEqual(['2026-12-20', '2027-01-19'])
  })

  it('D=31 em 2027 (ano comum)', () => {
    expect(par(ciclo(31, '2027-01'))).toEqual(['2027-01-31', '2027-02-27'])
    expect(par(ciclo(31, '2027-02'))).toEqual(['2027-02-28', '2027-03-30'])
    expect(par(ciclo(31, '2027-03'))).toEqual(['2027-03-31', '2027-04-29'])
    expect(par(ciclo(31, '2027-04'))).toEqual(['2027-04-30', '2027-05-30'])
  })

  it('D=30 em 2027', () => {
    expect(par(ciclo(30, '2027-01'))).toEqual(['2027-01-30', '2027-02-27'])
    expect(par(ciclo(30, '2027-02'))).toEqual(['2027-02-28', '2027-03-29'])
  })

  it('D=29 em 2028 (bissexto) e em 2027 (comum)', () => {
    expect(par(ciclo(29, '2028-01'))).toEqual(['2028-01-29', '2028-02-28'])
    expect(par(ciclo(29, '2028-02'))).toEqual(['2028-02-29', '2028-03-28'])
    expect(par(ciclo(29, '2027-01'))).toEqual(['2027-01-29', '2027-02-27'])
    expect(par(ciclo(29, '2027-02'))).toEqual(['2027-02-28', '2027-03-28'])
  })

  it('D=1 é o mês-calendário, em todos os 1.200 meses', () => {
    for (const m of todosOsMeses()) expect(par(ciclo(1, m))).toEqual(limitesDoMes(m))
  })

  it('a fronteira de D=20: 19/11 ainda é de outubro e 20/11 já é de novembro', () => {
    expect(periodoQueContem('2026-11-19', { dia: 20 })).toEqual(ciclo(20, '2026-10'))
    expect(periodoQueContem('2026-11-20', { dia: 20 })).toEqual(ciclo(20, '2026-11'))
    expect(periodoQueContem('2027-01-19', { dia: 20 })).toEqual(ciclo(20, '2026-12'))
    expect(periodoQueContem('2027-01-20', { dia: 20 })).toEqual(ciclo(20, '2027-01'))
  })

  it('dia 29/02 de ano bissexto com D=29 abre o ciclo de fevereiro; 28/02 ainda é de janeiro', () => {
    expect(periodoQueContem('2028-02-28', { dia: 29 })).toEqual(ciclo(29, '2028-01'))
    expect(periodoQueContem('2028-02-29', { dia: 29 })).toEqual(ciclo(29, '2028-02'))
    // ano comum: o ciclo de fevereiro começa dia 28 (último dia existente)
    expect(periodoQueContem('2027-02-27', { dia: 29 })).toEqual(ciclo(29, '2027-01'))
    expect(periodoQueContem('2027-02-28', { dia: 29 })).toEqual(ciclo(29, '2027-02'))
  })
})

describe('ciclo: todos os dias de início, 2000 a 2099', () => {
  it('início = min(D, último dia do mês); sem lacuna nem sobreposição; 28 a 31 dias', () => {
    const meses = todosOsMeses()
    for (let D = 1; D <= 31; D++) {
      let fimAnterior: string | null = null
      for (const m of meses) {
        const [a, mm] = m.split('-').map(Number)
        const { de, ate } = iv(ciclo(D, m))
        // início esperado, calculado por fora da implementação
        expect(de).toBe(`${m}-${String(Math.min(D, ultimoDia(a, mm))).padStart(2, '0')}`)
        expect(de <= ate).toBe(true)
        const n = (dia(ate) - dia(de)) / MS + 1
        expect(n).toBeGreaterThanOrEqual(28)
        expect(n).toBeLessThanOrEqual(31)
        // o ciclo começa exatamente um dia depois do fim do anterior
        if (fimAnterior) expect(de).toBe(iso(dia(fimAnterior) + MS))
        fimAnterior = ate
      }
    }
  }, 120_000)

  it('periodoQueContem acerta as pontas de todos os ciclos e a navegação é contínua', () => {
    const meses = todosOsMeses().slice(1, -1) // as pontas da faixa ficam para o teste de limites
    for (let D = 1; D <= 31; D++) {
      for (const m of meses) {
        const p = ciclo(D, m)
        const { de, ate } = iv(p)
        expect(periodoQueContem(de, { dia: D })).toEqual(p)
        expect(periodoQueContem(ate, { dia: D })).toEqual(p)
        const seg = periodoSeguinte(p)
        const ant = periodoAnterior(p)
        expect(periodoQueContem(iso(dia(ate) + MS), { dia: D })).toEqual(seg)
        expect(periodoQueContem(iso(dia(de) - MS), { dia: D })).toEqual(ant)
        expect(iv(seg).de).toBe(iso(dia(ate) + MS))
        expect(iv(ant).ate).toBe(iso(dia(de) - MS))
        expect(periodoAnterior(seg)).toEqual(p)
        expect(periodoSeguinte(ant)).toEqual(p)
      }
    }
  }, 120_000)

  it('cada data pertence a exatamente um ciclo (varredura de todas as datas, D representativos)', () => {
    for (const D of [1, 15, 20, 28, 29, 30, 31]) {
      const refs = todosOsMeses()
      const intervalos = refs.map((r) => iv(ciclo(D, r)))
      let i = 0
      // do primeiro dia do primeiro ciclo ao último dia do último ciclo
      for (let t = dia(intervalos[0].de); t <= dia(intervalos[intervalos.length - 1].ate); t += MS) {
        const d = iso(t)
        while (intervalos[i].ate < d) i++
        const donos = [intervalos[i], intervalos[i + 1]].filter((x) => x && x.de <= d && d <= x.ate)
        expect(donos).toHaveLength(1)
        const p = periodoQueContem(d, { dia: D })
        expect(p.tipo === 'ciclo' && p.ref === refs[i] && p.dia === D).toBe(true)
      }
    }
  }, 120_000)
})

describe('personalizado: validação', () => {
  it('aceita um dia só, e 366 dias contando os dois extremos', () => {
    expect(validarPersonalizado('2026-10-20', '2026-10-20')).toEqual({
      ok: true, intervalo: { de: '2026-10-20', ate: '2026-10-20' }, dias: 1,
    })
    const um = validarPersonalizado('2028-01-01', '2028-12-31') // bissexto: 366 dias
    expect(um).toMatchObject({ ok: true, dias: 366 })
    expect(validarPersonalizado('2026-10-20', '2027-10-20')).toMatchObject({ ok: true, dias: 366 }) // sem 29/02
  })

  it('recusa 367 dias, com mensagem clara', () => {
    const r = validarPersonalizado('2027-10-20', '2028-10-20') // inclui 29/02/2028: 367 dias
    expect(r).toMatchObject({ ok: false, motivo: 'muito_longo' })
    if (!r.ok) expect(r.mensagem).toMatch(/Máximo de 366 dias.*367/)
    expect(validarPersonalizado('2027-01-01', '2027-12-31')).toMatchObject({ ok: true, dias: 365 })
    expect(validarPersonalizado('2026-01-01', '2027-01-02')).toMatchObject({ ok: false, motivo: 'muito_longo' })
    expect(MAX_DIAS_PERSONALIZADO).toBe(366)
  })

  it('recusa intervalo invertido', () => {
    expect(validarPersonalizado('2026-10-21', '2026-10-20')).toMatchObject({ ok: false, motivo: 'invertido' })
  })

  it('recusa datas que não existem', () => {
    for (const [de, ate] of [
      ['2027-02-29', '2027-03-05'], ['2026-04-31', '2026-05-05'], ['2026-13-01', '2026-12-01'],
      ['2026-00-10', '2026-12-01'], ['2026-10-00', '2026-10-05'], ['2026-10-01', '2026-02-30'],
    ]) {
      expect(validarPersonalizado(de, ate)).toMatchObject({ ok: false, motivo: 'data_inexistente' })
    }
    expect(validarPersonalizado('2028-02-29', '2028-03-01')).toMatchObject({ ok: true }) // bissexto existe
  })

  it('recusa formato inválido e tipos que não são texto', () => {
    for (const x of ['', '2026-1-01', '26-10-01', '2026/10/01', '01/10/2026', '2026-10-01T00:00', ' 2026-10-01', 'abc']) {
      expect(validarPersonalizado(x, '2026-10-05')).toMatchObject({ ok: false, motivo: 'formato' })
      expect(validarPersonalizado('2026-10-01', x)).toMatchObject({ ok: false, motivo: 'formato' })
    }
    for (const x of [null, undefined, 20261001, {}]) {
      expect(validarPersonalizado(x, '2026-10-05')).toMatchObject({ ok: false, motivo: 'formato' })
    }
  })

  it('recusa datas fora de 2000-01-01 a 2100-12-31 e aceita as bordas', () => {
    expect(validarPersonalizado('1999-12-31', '2000-01-05')).toMatchObject({ ok: false, motivo: 'fora_da_faixa' })
    expect(validarPersonalizado('2100-12-30', '2101-01-01')).toMatchObject({ ok: false, motivo: 'fora_da_faixa' })
    expect(validarPersonalizado('0050-01-01', '2000-01-05')).toMatchObject({ ok: false, motivo: 'fora_da_faixa' })
    expect(validarPersonalizado('2000-01-01', '2000-01-31')).toMatchObject({ ok: true })
    expect(validarPersonalizado('2100-12-01', '2100-12-31')).toMatchObject({ ok: true })
  })

  it('não corrige nada: o intervalo devolvido é exatamente o informado', () => {
    const r = validarPersonalizado('2026-10-20', '2026-11-05')
    expect(r).toEqual({ ok: true, intervalo: { de: '2026-10-20', ate: '2026-11-05' }, dias: 17 })
  })

  it('diasDoIntervalo conta os dois extremos', () => {
    expect(diasDoIntervalo('2026-10-20', '2026-10-20')).toBe(1)
    expect(diasDoIntervalo('2026-10-01', '2026-10-31')).toBe(31)
    expect(diasDoIntervalo('2028-02-28', '2028-03-01')).toBe(3)
  })

  it('intervaloDoPeriodo de personalizado inválido lança, em vez de devolver outro intervalo', () => {
    expect(iv({ tipo: 'personalizado', de: '2026-10-20', ate: '2026-11-05' })).toEqual({ de: '2026-10-20', ate: '2026-11-05' })
    expect(() => iv({ tipo: 'personalizado', de: '2026-11-05', ate: '2026-10-20' })).toThrow(PeriodoInvalidoError)
    expect(() => iv({ tipo: 'personalizado', de: '2027-10-20', ate: '2028-10-20' })).toThrow(/366/)
  })
})

describe('personalizado: navegação', () => {
  it('o seguinte e o anterior têm a mesma duração e ficam colados, sem lacuna nem sobreposição', () => {
    const p: Periodo = { tipo: 'personalizado', de: '2026-10-20', ate: '2026-11-05' } // 17 dias
    expect(periodoSeguinte(p)).toEqual({ tipo: 'personalizado', de: '2026-11-06', ate: '2026-11-22' })
    expect(periodoAnterior(p)).toEqual({ tipo: 'personalizado', de: '2026-10-03', ate: '2026-10-19' })
    expect(periodoAnterior(periodoSeguinte(p))).toEqual(p)
    expect(periodoSeguinte(periodoAnterior(p))).toEqual(p)
  })

  it('atravessa fevereiro bissexto e a virada de ano', () => {
    expect(periodoSeguinte({ tipo: 'personalizado', de: '2028-02-20', ate: '2028-02-29' })).toEqual({
      tipo: 'personalizado', de: '2028-03-01', ate: '2028-03-10',
    })
    expect(periodoSeguinte({ tipo: 'personalizado', de: '2026-12-25', ate: '2026-12-31' })).toEqual({
      tipo: 'personalizado', de: '2027-01-01', ate: '2027-01-07',
    })
  })

  it('não navega para fora da faixa: lança em vez de devolver outro período', () => {
    expect(() => periodoAnterior({ tipo: 'personalizado', de: '2000-01-01', ate: '2000-01-10' })).toThrow(PeriodoInvalidoError)
    expect(() => periodoSeguinte({ tipo: 'personalizado', de: '2100-12-20', ate: '2100-12-31' })).toThrow(PeriodoInvalidoError)
  })
})

describe('entradas inválidas: erro explícito, nunca outro período', () => {
  it('mês e ciclo fora do formato ou da faixa', () => {
    for (const m of ['2026-13', '2026-00', '2026-1', '26-10', '', '1999-12', '2100-01', '2026-10-01']) {
      expect(() => iv(mes(m))).toThrow(PeriodoInvalidoError)
      expect(() => iv(ciclo(20, m))).toThrow(PeriodoInvalidoError)
    }
    // @ts-expect-error mês que não é texto
    expect(() => iv({ tipo: 'mes', mes: 202610 })).toThrow(PeriodoInvalidoError)
  })

  it('dia do ciclo precisa ser inteiro de 1 a 31', () => {
    for (const d of [0, 32, -1, 1.5, NaN, Infinity]) {
      expect(() => iv(ciclo(d, '2026-10'))).toThrow(/1 a 31/)
      expect(() => periodoQueContem('2026-10-20', { dia: d })).toThrow(PeriodoInvalidoError)
    }
    // @ts-expect-error dia em texto
    expect(() => iv(ciclo('20', '2026-10'))).toThrow(PeriodoInvalidoError)
  })

  it('periodoQueContem recusa data inválida ou fora da faixa', () => {
    for (const d of ['2027-02-29', '2026-10-5', '', '1999-12-31', '2101-01-01']) {
      expect(() => periodoQueContem(d, { dia: null })).toThrow(PeriodoInvalidoError)
      expect(() => periodoQueContem(d, { dia: 20 })).toThrow(PeriodoInvalidoError)
    }
  })

  it('bordas da faixa de referência: o ciclo que não cabe em 2000-01 a 2100-12 lança', () => {
    expect(par(ciclo(20, '2000-01'))).toEqual(['2000-01-20', '2000-02-19'])
    expect(par(ciclo(20, '2099-12'))).toEqual(['2099-12-20', '2100-01-19'])
    expect(() => periodoAnterior(ciclo(20, '2000-01'))).toThrow(PeriodoInvalidoError)
    expect(() => periodoSeguinte(ciclo(20, '2099-12'))).toThrow(PeriodoInvalidoError)
    expect(() => periodoAnterior(mes('2000-01'))).toThrow(PeriodoInvalidoError)
    expect(() => periodoSeguinte(mes('2099-12'))).toThrow(PeriodoInvalidoError)
    // 01/01/2000 com D=20 pertence ao ciclo de dez/1999, fora da faixa
    expect(() => periodoQueContem('2000-01-05', { dia: 20 })).toThrow(PeriodoInvalidoError)
    expect(periodoQueContem('2000-01-05', { dia: 1 })).toEqual(ciclo(1, '2000-01'))
    // com D=1 o último ciclo é 2100-12, fora de MES_MAX, então também lança
    expect(() => periodoQueContem('2100-12-31', { dia: 1 })).toThrow(PeriodoInvalidoError)
    expect(periodoQueContem('2099-12-31', { dia: 1 })).toEqual(ciclo(1, '2099-12'))
  })

  it('tipo desconhecido', () => {
    // @ts-expect-error tipo inexistente
    expect(() => iv({ tipo: 'semana' })).toThrow(PeriodoInvalidoError)
    // @ts-expect-error vazio
    expect(() => iv(undefined)).toThrow(PeriodoInvalidoError)
    // @ts-expect-error vazio
    expect(() => rotuloDoPeriodo(null)).toThrow(PeriodoInvalidoError)
  })
})

describe('rótulos', () => {
  it('mês', () => {
    expect(rotuloDoPeriodo(mes('2026-10'))).toBe('Outubro de 2026')
    expect(rotuloDoPeriodo(mes('2027-03'))).toBe('Março de 2027')
  })

  it('ciclo traz o mês de início e as datas efetivas', () => {
    expect(rotuloDoPeriodo(ciclo(20, '2026-10'))).toBe('Ciclo de outubro/2026 · 20/10 a 19/11')
    expect(rotuloDoPeriodo(ciclo(20, '2026-11'))).toBe('Ciclo de novembro/2026 · 20/11 a 19/12')
    expect(rotuloDoPeriodo(ciclo(31, '2027-02'))).toBe('Ciclo de fevereiro/2027 · 28/02 a 30/03')
    expect(rotuloDoPeriodo(ciclo(29, '2028-02'))).toBe('Ciclo de fevereiro/2028 · 29/02 a 28/03')
    expect(rotuloDoPeriodo(ciclo(1, '2026-10'))).toBe('Ciclo de outubro/2026 · 01/10 a 31/10')
  })

  it('ciclo que atravessa a virada do ano mostra o ano nas duas datas', () => {
    expect(rotuloDoPeriodo(ciclo(20, '2026-12'))).toBe('Ciclo de dezembro/2026 · 20/12/2026 a 19/01/2027')
    expect(rotuloDoPeriodo(ciclo(31, '2026-12'))).toBe('Ciclo de dezembro/2026 · 31/12/2026 a 30/01/2027')
  })

  it('personalizado sempre com o ano', () => {
    expect(rotuloDoPeriodo({ tipo: 'personalizado', de: '2026-10-20', ate: '2026-11-05' })).toBe('20/10/2026 a 05/11/2026')
    expect(rotuloDoPeriodo({ tipo: 'personalizado', de: '2026-12-25', ate: '2027-01-05' })).toBe('25/12/2026 a 05/01/2027')
  })

  it('o rótulo do ciclo bate com as datas de intervaloDoPeriodo em todos os ciclos de 2026 a 2028', () => {
    for (let D = 1; D <= 31; D++) {
      for (const m of todosOsMeses().filter((x) => x >= '2026-01' && x <= '2028-12')) {
        const { de, ate } = iv(ciclo(D, m))
        const br = (s: string) => `${s.slice(8)}/${s.slice(5, 7)}`
        const rot = rotuloDoPeriodo(ciclo(D, m))
        expect(rot).toContain(br(de))
        expect(rot).toContain(br(ate))
        expect(rot.includes(de.slice(0, 4) + ' a ')).toBe(de.slice(0, 4) !== ate.slice(0, 4))
      }
    }
  })
})
