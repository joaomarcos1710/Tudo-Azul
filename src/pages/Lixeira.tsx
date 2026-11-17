import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Aviso } from '../components/ui/Aviso'
import { Card } from '../components/ui/Card'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'
import { EmptyState } from '../components/ui/EmptyState'
import { useFamilia } from '../lib/FamiliaContext'
import { listarCategorias, nomesCompletos } from '../lib/categorias'
import { hojeSP, listarContas } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { formatDate, formatMoeda } from '../lib/format'
import { LIMITE_LIXEIRA, listarLixeira, restaurarDaLixeira } from '../lib/lancamentos'
import type { LancamentoNaLixeira } from '../lib/lancamentos'

/**
 * Lixeira de Lançamentos (surgiu do item e do handoff: excluir não pergunta mais e o "Desfazer" some quando é fechado).
 * Mostra o que foi excluído e deixa restaurar, um por um. Nunca apaga de vez: o cliente não apaga lançamento.
 * Cada valor é o do próprio lançamento, na moeda da conta; nada é somado aqui.
 */
export default function Lixeira() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [itens, setItens] = useState<LancamentoNaLixeira[] | null>(null)
  const [nomeConta, setNomeConta] = useState<Map<string, string>>(new Map())
  const [moedaConta, setMoedaConta] = useState<Map<string, string>>(new Map())
  const [nomeCategoria, setNomeCategoria] = useState<Map<string, string>>(new Map())
  const [erro, setErro] = useState('')
  const [restaurando, setRestaurando] = useState<string | null>(null)
  const [restaurados, setRestaurados] = useState(0)

  useEffect(() => {
    if (!familiaId) return
    let vivo = true
    setErro('')
    Promise.all([
      listarLixeira(familiaId),
      // nomes são só rótulos: se falharem, a lista segue com "Conta" e sem categoria
      listarContas(familiaId, hojeSP()).catch(() => null),
      listarCategorias(familiaId).catch(() => null),
    ]).then(([lista, contas, cats]) => {
      if (!vivo) return
      const todas = [...(contas?.contas ?? []), ...(contas?.internas ?? [])]
      setNomeConta(new Map(todas.map((c) => [c.id, c.nome])))
      setMoedaConta(new Map((contas?.contas ?? []).map((c) => [c.id, c.moeda ?? 'BRL'])))
      setNomeCategoria(nomesCompletos(cats ?? []))
      setItens(lista)
    }).catch((e) => { if (vivo) setErro(mensagemErroBanco(e)) })
    return () => { vivo = false }
  }, [familiaId])

  async function restaurar(l: LancamentoNaLixeira) {
    setRestaurando(l.id)
    setErro('')
    try {
      await restaurarDaLixeira(l.id)
      setItens((atual) => (atual ?? []).filter((x) => x.id !== l.id))
      setRestaurados((n) => n + 1)
    } catch (e) {
      setErro(mensagemErroBanco(e))
    } finally {
      setRestaurando(null)
    }
  }

  if (!familiaId) return null

  return (
    <>
      <CabecalhoPagina titulo="Lixeira" descricao="Lançamentos excluídos. Restaure o que saiu por engano; ele volta para Lançamentos como estava."
        acoes={<Link to="/lancamentos" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-azul hover:bg-azul-claro">Voltar para Lançamentos</Link>} />

      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      {restaurados > 0 && (
        <div className="mb-4" role="status">
          <Aviso tipo="info">{restaurados === 1 ? '1 lançamento restaurado.' : `${restaurados} lançamentos restaurados.`} Já aparece em Lançamentos.</Aviso>
        </div>
      )}

      {itens === null && !erro ? (
        <p className="text-sm text-slate-600" role="status">Carregando…</p>
      ) : itens && itens.length === 0 ? (
        <EmptyState titulo="A lixeira está vazia" descricao="O que você excluir em Lançamentos aparece aqui e pode ser restaurado." />
      ) : itens && (
        <Card>
          <ul className="divide-y divide-slate-100" aria-label="Lançamentos na lixeira">
            {itens.map((l) => {
              const detalhe = l.tipo === 'transfer'
                ? `${nomeConta.get(l.contaId) ?? 'Conta'} → ${l.destinoId ? nomeConta.get(l.destinoId) ?? 'Conta' : 'Conta'}`
                : [l.categoriaId ? nomeCategoria.get(l.categoriaId) : null, nomeConta.get(l.contaId)].filter(Boolean).join(' · ')
              const sinal = l.tipo === 'income' ? '+' : l.tipo === 'expense' ? '−' : '⇄ '
              const cor = l.tipo === 'income' ? 'text-lucro' : l.tipo === 'expense' ? 'text-prejuizo' : 'text-transferencia'
              return (
                <li key={l.id} className="flex items-center gap-3 py-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{l.descricao || (l.tipo === 'income' ? 'Receita' : l.tipo === 'expense' ? 'Despesa' : 'Transferência')}</span>
                    <span className="block truncate text-xs text-slate-500">{formatDate(l.data)}{detalhe ? ` · ${detalhe}` : ''}</span>
                    <span className="block text-xs text-slate-400">Excluído em {formatDate(hojeSP(new Date(l.excluidoEm)))}</span>
                  </span>
                  <span className={`shrink-0 tabular-nums font-semibold ${cor}`}>{sinal}{formatMoeda(l.valor, moedaConta.get(l.contaId) ?? 'BRL')}</span>
                  <button type="button" onClick={() => void restaurar(l)} disabled={restaurando !== null}
                    aria-label={`Restaurar ${l.descricao || 'lançamento'} de ${formatDate(l.data)}`}
                    className="min-h-11 shrink-0 rounded-lg px-3 font-semibold text-azul hover:bg-azul-claro disabled:opacity-50">
                    {restaurando === l.id ? 'Restaurando…' : 'Restaurar'}
                  </button>
                </li>
              )
            })}
          </ul>
          {itens.length >= LIMITE_LIXEIRA && (
            <p className="mt-2 text-xs text-slate-500">Mostrando os {LIMITE_LIXEIRA} excluídos mais recentes.</p>
          )}
        </Card>
      )}
    </>
  )
}
