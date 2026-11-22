import { describe, expect, it } from 'vitest'
import { assinaturaDaListagem, filtrosDaUrl, periodoDaUrl, urlComListagem } from './urlLancamentos'

const u = (q: string) => new URLSearchParams(q)

describe('período e filtros de Lançamentos no endereço (handoff, item g)', () => {
  it('sem nada: o mês atual e nenhum filtro', () => {
    expect(periodoDaUrl(u(''), '2026-11')).toEqual({ tipo: 'mes', de: '2026-11-01', ate: '2026-11-30' })
    expect(filtrosDaUrl(u(''))).toEqual({})
  })

  it('o ciclo vai no endereço como período (periodo=ciclo&de&ate); ?mes= é sempre o mês de calendário', () => {
    const ciclo = { tipo: 'ciclo' as const, de: '2026-11-20', ate: '2026-12-19' }
    const url = urlComListagem(u(''), ciclo, {})
    expect(url.toString()).toBe('periodo=ciclo&de=2026-11-20&ate=2026-12-19')
    expect(periodoDaUrl(url, '2026-11')).toEqual(ciclo)
    expect(periodoDaUrl(u('mes=2026-12'), '2026-11')).toEqual({ tipo: 'mes', de: '2026-12-01', ate: '2026-12-31' })
  })

  it('?mes= abre o mês; mês inválido cai no atual', () => {
    expect(periodoDaUrl(u('mes=2026-02'), '2026-11')).toEqual({ tipo: 'mes', de: '2026-02-01', ate: '2026-02-28' })
    expect(periodoDaUrl(u('mes=2026-13'), '2026-11').de).toBe('2026-11-01')
    expect(periodoDaUrl(u('mes=abc'), '2026-11').de).toBe('2026-11-01')
  })

  it('outro período: ?periodo=&de=&ate=; data impossível, invertida ou longa demais cai no mês', () => {
    expect(periodoDaUrl(u('periodo=livre&de=2026-10-05&ate=2026-11-20'), '2026-11')).toEqual({ tipo: 'livre', de: '2026-10-05', ate: '2026-11-20' })
    expect(periodoDaUrl(u('periodo=meses&de=2026-09-01&ate=2026-11-30'), '2026-11').tipo).toBe('meses')
    expect(periodoDaUrl(u('periodo=livre&de=2026-02-30&ate=2026-03-10'), '2026-11').tipo).toBe('mes')
    expect(periodoDaUrl(u('periodo=livre&de=2026-11-20&ate=2026-10-05'), '2026-11').tipo).toBe('mes')
    expect(periodoDaUrl(u('periodo=livre&de=2000-01-01&ate=2026-11-20'), '2026-11').tipo).toBe('mes')
    expect(periodoDaUrl(u('periodo=xyz&de=2026-10-05&ate=2026-11-20'), '2026-11').tipo).toBe('mes')
  })

  it('filtros: ids, tipo, situação, fixos e parcelados; valor desconhecido é ignorado', () => {
    expect(filtrosDaUrl(u('conta=a1&categoria=g-2&cartao=k1&tipo=transferencia&situacao=pendente&fixos=1&parcelados=1'))).toEqual({
      contaId: 'a1', categoriaId: 'g-2', cartaoId: 'k1', tipo: 'transfer', situacao: 'planned', soFixos: true, soParcelados: true,
    })
    expect(filtrosDaUrl(u('tipo=receita&situacao=pago'))).toEqual({ tipo: 'income', situacao: 'paid' })
    expect(filtrosDaUrl(u('tipo=xyz&situacao=talvez&fixos=sim&conta=a b'))).toEqual({})
  })

  it('ida e volta: escrever e ler devolve o mesmo; ?novo= e outras chaves ficam', () => {
    const periodo = { tipo: 'livre' as const, de: '2026-10-05', ate: '2026-11-20' }
    const filtros = { contaId: 'a1', tipo: 'expense' as const, soFixos: true }
    const n = urlComListagem(u('novo=despesa&mes=2026-01&categoria=velha'), periodo, filtros)
    expect(n.get('novo')).toBe('despesa')
    expect(n.get('mes')).toBeNull()
    expect(n.get('categoria')).toBeNull()
    expect(periodoDaUrl(n, '2026-11')).toEqual(periodo)
    expect(filtrosDaUrl(n)).toEqual(filtros)
    expect(urlComListagem(u(''), { tipo: 'mes', de: '2026-03-01', ate: '2026-03-31' }, {}).toString()).toBe('mes=2026-03')
  })

  it('?busca= (PR 2 do handoff): texto sem os espaços das pontas; vazio ou com mais de 100 letras é ignorado; ida e volta', () => {
    expect(filtrosDaUrl(u('busca=%20flora%20energia%20'))).toEqual({ busca: 'flora energia' })
    expect(filtrosDaUrl(u('busca=%20%20'))).toEqual({})
    expect(filtrosDaUrl(u(`busca=${'a'.repeat(101)}`))).toEqual({})
    expect(filtrosDaUrl(u(`busca=${'a'.repeat(100)}`)).busca).toHaveLength(100)
    const ida = urlComListagem(u(''), periodoDaUrl(u('mes=2026-10'), '2026-11'), { busca: '  100% Flóra  ', tipo: 'expense' })
    expect(ida.get('busca')).toBe('100% Flóra')
    expect(filtrosDaUrl(ida)).toEqual({ busca: '100% Flóra', tipo: 'expense' })
    expect(urlComListagem(ida, periodoDaUrl(ida), { tipo: 'expense' }).has('busca')).toBe(false)
    expect(assinaturaDaListagem(u('busca=a'))).not.toBe(assinaturaDaListagem(u('busca=b')))
  })

  it('a assinatura só muda com período ou filtro (não com ?novo=)', () => {
    expect(assinaturaDaListagem(u('mes=2026-10&novo=despesa'))).toBe(assinaturaDaListagem(u('mes=2026-10')))
    expect(assinaturaDaListagem(u('mes=2026-10'))).not.toBe(assinaturaDaListagem(u('mes=2026-10&tipo=receita')))
  })
})
