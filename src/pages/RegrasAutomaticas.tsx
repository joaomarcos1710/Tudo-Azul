import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Field } from '../components/ui/Field'
import { Selecao } from '../components/ui/Selecao'
import { useFamilia } from '../lib/FamiliaContext'
import { listarCategorias } from '../lib/categorias'
import type { Categoria } from '../lib/categorias'
import { mensagemErroBanco } from '../lib/erros'
import {
  atualizarRegraAutomatica, criarRegraAutomatica, excluirRegraAutomatica, listarRegrasAutomaticas,
} from '../lib/regrasAutomaticas'
import type { DadosRegraAutomatica, RegraAutomatica, TipoRegraAutomatica } from '../lib/regrasAutomaticas'

const tipoOpcoes: [string, string][] = [['expense', 'Despesa'], ['income', 'Receita']]

const novoRascunho = (): DadosRegraAutomatica => ({
  nome: '', trechoDescricao: '', tipo: 'expense', categoriaId: '', ativa: true, prioridade: 0,
})

export default function RegrasAutomaticas() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [regras, setRegras] = useState<RegraAutomatica[] | null>(null)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [editando, setEditando] = useState<RegraAutomatica | 'nova' | null>(null)
  const [rascunho, setRascunho] = useState<DadosRegraAutomatica>(novoRascunho())
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = useCallback(async () => {
    if (!familiaId) return
    try {
      const [r, c] = await Promise.all([listarRegrasAutomaticas(familiaId), listarCategorias(familiaId)])
      setRegras(r)
      setCategorias(c)
      setErro('')
    } catch (e) {
      setErro(mensagemErroBanco(e))
    }
  }, [familiaId])

  useEffect(() => { void carregar() }, [carregar])

  function iniciar(regra: RegraAutomatica | 'nova') {
    setEditando(regra)
    setRascunho(regra === 'nova' ? novoRascunho() : {
      nome: regra.nome, trechoDescricao: regra.trechoDescricao, tipo: regra.tipo,
      categoriaId: regra.categoriaId, ativa: regra.ativa, prioridade: regra.prioridade,
    })
    setErro('')
  }

  const categoriasTipo = categorias.filter((c) => c.tipo === rascunho.tipo && (c.ativa || c.id === rascunho.categoriaId))

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (!familiaId || !editando) return
    if (!rascunho.nome.trim() || !rascunho.trechoDescricao.trim() || !rascunho.categoriaId) {
      setErro('Preencha o nome, o trecho da descrição e a categoria.')
      return
    }
    if (!Number.isInteger(rascunho.prioridade) || rascunho.prioridade < -1000 || rascunho.prioridade > 1000) {
      setErro('A prioridade deve ser um número inteiro entre -1000 e 1000.')
      return
    }
    setSalvando(true)
    setErro('')
    try {
      if (editando === 'nova') await criarRegraAutomatica(familiaId, rascunho)
      else await atualizarRegraAutomatica(editando.id, rascunho)
      setEditando(null)
      await carregar()
    } catch (e) {
      setErro(mensagemErroBanco(e))
    } finally {
      setSalvando(false)
    }
  }

  async function alternar(regra: RegraAutomatica) {
    try {
      await atualizarRegraAutomatica(regra.id, { ...regra, ativa: !regra.ativa })
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }

  async function remover(regra: RegraAutomatica) {
    if (!window.confirm(`Excluir a regra "${regra.nome}"? Isso não altera nenhum lançamento já salvo.`)) return
    try {
      await excluirRegraAutomatica(regra.id)
      await carregar()
    } catch (e) { setErro(mensagemErroBanco(e)) }
  }

  if (!familiaId) return null
  const nomeCategoria = new Map(categorias.map((c) => [c.id, c.nome]))

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Regras automáticas</h1>
        {editando === null && <Button onClick={() => iniciar('nova')}>Nova regra</Button>}
      </div>
      <p className="mb-6 text-sm text-slate-600">
        Crie sugestões de categoria com base em palavras da descrição. As regras só sugerem: não alteram valores,
        contas ou lançamentos antigos. Você confirma a categoria no formulário.
      </p>
      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}

      {editando !== null && (
        <Card className="mb-6">
          <h2 className="mb-4 text-lg font-semibold">{editando === 'nova' ? 'Nova regra' : 'Editar regra'}</h2>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={salvar}>
            <Field rotulo="Nome da regra" maxLength={80} value={rascunho.nome}
              onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })} required />
            <Field rotulo="Descrição contém" maxLength={100} placeholder="Ex.: supermercado"
              value={rascunho.trechoDescricao}
              onChange={(e) => setRascunho({ ...rascunho, trechoDescricao: e.target.value })} required />
            <Selecao rotulo="Tipo" valor={rascunho.tipo} aoMudar={(v) => {
              const tipo = v as TipoRegraAutomatica
              setRascunho({ ...rascunho, tipo, categoriaId: '' })
            }} opcoes={tipoOpcoes} />
            <Selecao rotulo="Categoria sugerida" valor={rascunho.categoriaId}
              aoMudar={(categoriaId) => setRascunho({ ...rascunho, categoriaId })}
              opcoes={categoriasTipo.map((c) => [c.id, c.paiId ? `↳ ${c.nome}` : c.nome])} todos="Escolha…" />
            <Field rotulo="Prioridade (-1000 a 1000)" type="number" min={-1000} max={1000} step={1}
              value={String(rascunho.prioridade)}
              onChange={(e) => setRascunho({ ...rascunho, prioridade: Number(e.target.value) })} required />
            <label className="flex min-h-11 items-center gap-2 self-end text-sm">
              <input type="checkbox" checked={rascunho.ativa}
                onChange={(e) => setRascunho({ ...rascunho, ativa: e.target.checked })} />
              Regra ativa
            </label>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button type="submit" carregando={salvando}>Salvar regra</Button>
              <Button variante="secundario" onClick={() => { setEditando(null); setErro('') }}>Cancelar</Button>
            </div>
          </form>
        </Card>
      )}

      {regras === null && !erro && <p role="status" className="text-sm text-slate-600">Carregando regras…</p>}
      {regras?.length === 0 && editando === null && (
        <Card>
          <h2 className="font-semibold">Nenhuma regra cadastrada</h2>
          <p className="mt-1 text-sm text-slate-600">Exemplo: quando a descrição contém “mercado”, sugerir a categoria “Alimentação”.</p>
          <Button className="mt-4" onClick={() => iniciar('nova')}>Criar primeira regra</Button>
        </Card>
      )}
      {regras && regras.length > 0 && (
        <Card className="p-0">
          <ul className="divide-y divide-slate-100">
            {regras.map((r) => (
              <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{r.nome}</p>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${r.ativa ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                      {r.ativa ? 'Ativa' : 'Inativa'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    {r.tipo === 'expense' ? 'Despesa' : 'Receita'} · descrição contém “{r.trechoDescricao}” · categoria: {nomeCategoria.get(r.categoriaId) ?? 'categoria indisponível'} · prioridade {r.prioridade}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variante="secundario" onClick={() => iniciar(r)}>Editar</Button>
                  <Button variante="secundario" onClick={() => void alternar(r)}>{r.ativa ? 'Desativar' : 'Ativar'}</Button>
                  <Button variante="perigo" onClick={() => void remover(r)}>Excluir</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
