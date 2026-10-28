import { describe, expect, it } from 'vitest'
import { diaDaSemana, proximasOcorrencias, rotuloFrequencia } from './recorrencias'
import type { Recorrencia } from './recorrencias'

type Regra = Pick<Recorrencia, 'unidade' | 'cada' | 'dia' | 'inicio' | 'fim'>
const mes = (dia: number, inicio: string, cada = 1, fim: string | null = null): Regra => ({ unidade: 'month', cada, dia, inicio, fim })
const semana = (inicio: string, cada = 1, fim: string | null = null): Regra => ({ unidade: 'week', cada, dia: null, inicio, fim })

// Os mesmos casos de supabase/tests/database/22_recurrence_frequency.test.sql (RF2–RF9): a prévia da tela
// tem de mostrar as mesmas datas que o banco vai gerar.
describe('proximasOcorrencias (mesma regra do banco, migration 016)', () => {
  it('mensal dia 31: último dia nos meses curtos, sem escorregar (RF2)', () => {
    expect(proximasOcorrencias(mes(31, '2027-01-01'), '2027-01-01', 5))
      .toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31'])
  })
  it('anual dia 29 em fevereiro: 28/02 no ano comum, 29/02 no bissexto (RF3)', () => {
    expect(proximasOcorrencias(mes(29, '2028-02-01', 12), '2028-01-01', 5))
      .toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29'])
  })
  it('trimestral dia 31 (RF4)', () => {
    expect(proximasOcorrencias(mes(31, '2027-01-01', 3), '2027-01-01', 4)).toEqual(['2027-01-31', '2027-04-30', '2027-07-31', '2027-10-31'])
  })
  it('semestral: dia 10 de março já passou do início (15/03), começa em setembro (RF5)', () => {
    expect(proximasOcorrencias(mes(10, '2027-03-15', 6), '2027-01-01', 3)).toEqual(['2027-09-10', '2028-03-10', '2028-09-10'])
  })
  it('bimestral dia 30: fevereiro bissexto vira 29 (RF6)', () => {
    expect(proximasOcorrencias(mes(30, '2027-12-01', 2), '2027-12-01', 4)).toEqual(['2027-12-30', '2028-02-29', '2028-04-30', '2028-06-30'])
  })
  it('semanal e quinzenal = a cada 7 e 14 dias (RF7, RF8)', () => {
    expect(proximasOcorrencias(semana('2027-01-01'), '2027-01-01', 5)).toEqual(['2027-01-01', '2027-01-08', '2027-01-15', '2027-01-22', '2027-01-29'])
    expect(proximasOcorrencias(semana('2027-01-01', 2), '2027-01-01', 5)).toEqual(['2027-01-01', '2027-01-15', '2027-01-29', '2027-02-12', '2027-02-26'])
  })
  it('data final é a última ocorrência possível; janela no meio da série (RF9)', () => {
    expect(proximasOcorrencias(semana('2027-01-01', 2, '2027-01-20'), '2027-01-01', 10)).toEqual(['2027-01-01', '2027-01-15'])
    expect(proximasOcorrencias(semana('2027-01-01'), '2027-01-10', 1)).toEqual(['2027-01-15'])
    expect(proximasOcorrencias(mes(15, '2027-01-01', 5), '2027-01-01', 3)).toEqual(['2027-01-15', '2027-06-15', '2027-11-15'])
  })
  it('passa de ano e de dezembro sem erro de mês', () => {
    expect(proximasOcorrencias(mes(5, '2027-11-01', 1), '2027-11-01', 3)).toEqual(['2027-11-05', '2027-12-05', '2028-01-05'])
  })
})

describe('rotuloFrequencia', () => {
  it('descreve cada frequência em português', () => {
    expect(rotuloFrequencia({ unidade: 'month', cada: 1, dia: 10, inicio: '2027-01-01' })).toBe('Todo dia 10')
    expect(rotuloFrequencia({ unidade: 'month', cada: 3, dia: 31, inicio: '2027-01-01' })).toBe('Trimestral · dia 31')
    expect(rotuloFrequencia({ unidade: 'month', cada: 12, dia: 20, inicio: '2027-02-01' })).toBe('Anual · 20 de fevereiro')
    expect(rotuloFrequencia({ unidade: 'month', cada: 5, dia: 15, inicio: '2027-01-01' })).toBe('A cada 5 meses · dia 15')
    expect(rotuloFrequencia({ unidade: 'week', cada: 1, dia: null, inicio: '2027-01-01' })).toBe('Toda sexta')
    expect(rotuloFrequencia({ unidade: 'week', cada: 1, dia: null, inicio: '2027-01-02' })).toBe('Todo sábado')
    expect(rotuloFrequencia({ unidade: 'week', cada: 2, dia: null, inicio: '2027-01-01' })).toBe('Quinzenal · sexta')
    expect(rotuloFrequencia({ unidade: 'week', cada: 3, dia: null, inicio: '2027-01-05' })).toBe('A cada 3 semanas · terça')
  })
  it('dia da semana sem fuso (data é só data)', () => {
    expect(diaDaSemana('2026-10-28')).toBe('quarta')
    expect(diaDaSemana('2028-02-29')).toBe('terça')
  })
})
