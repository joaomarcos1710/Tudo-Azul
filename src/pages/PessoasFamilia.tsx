import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card, CardTitle } from '../components/ui/Card'
import { Field } from '../components/ui/Field'
import { mensagemErroBanco } from '../lib/familia'
import {
  atualizarPessoaFamilia, criarPessoaFamilia, definirStatusPessoaFamilia, listarPessoasFamilia, VINCULOS_PESSOA,
} from '../lib/pessoasFamilia'
import type { DadosPessoaFamilia, PessoaFamilia, VinculoPessoa } from '../lib/pessoasFamilia'

interface Props { familiaId: string }
interface FormularioPessoa { nome: string; nascimento: string; vinculo: VinculoPessoa | ''; fotoUrl: string }
const VAZIO: FormularioPessoa = { nome: '', nascimento: '', vinculo: '', fotoUrl: '' }

function iniciais(nome: string): string {
  return nome.trim().split(/\s+/).slice(0, 2)
    .map((parte) => parte[0]?.toLocaleUpperCase('pt-BR') ?? '').join('')
}
function dataCurta(data: string): string {
  const [ano, mes, dia] = data.split('-')
  return [dia, mes, ano].join('/')
}

export function PessoasFamilia({ familiaId }: Props) {
  const [pessoas, setPessoas] = useState<PessoaFamilia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)
  const [formulario, setFormulario] = useState<FormularioPessoa>(VAZIO)
  const [mostrarInativas, setMostrarInativas] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    try {
      setPessoas(await listarPessoasFamilia(familiaId))
      setErro('')
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setCarregando(false)
    }
  }, [familiaId])

  useEffect(() => { void carregar() }, [carregar])

  function abrirNova() {
    setEditando(null); setFormulario(VAZIO); setErro(''); setModal(true)
  }
  function abrirEdicao(pessoa: PessoaFamilia) {
    setEditando(pessoa.id)
    setFormulario({ nome: pessoa.nome, nascimento: pessoa.nascimento ?? '', vinculo: pessoa.vinculo, fotoUrl: pessoa.fotoUrl ?? '' })
    setErro(''); setModal(true)
  }
  function fecharModal() {
    if (salvando) return
    setModal(false); setEditando(null); setFormulario(VAZIO)
  }

  async function salvar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!formulario.nome.trim() || !formulario.vinculo) return
    setErro(''); setSalvando(true)
    const dados: DadosPessoaFamilia = {
      nome: formulario.nome.trim(), nascimento: formulario.nascimento || null,
      vinculo: formulario.vinculo, fotoUrl: formulario.fotoUrl.trim() || null,
    }
    try {
      if (editando) await atualizarPessoaFamilia(familiaId, editando, dados)
      else await criarPessoaFamilia(familiaId, dados)
      setModal(false); setEditando(null); setFormulario(VAZIO)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setSalvando(false)
    }
  }

  async function alternarStatus(pessoa: PessoaFamilia) {
    setErro('')
    try {
      await definirStatusPessoaFamilia(familiaId, pessoa.id, !pessoa.ativo)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }

  const ativas = pessoas.filter((p) => p.ativo)
  const inativas = pessoas.filter((p) => !p.ativo)

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Pessoas da família</CardTitle>
            <p className="mt-1 text-sm text-slate-600">
              Cadastre pessoas e pets para organizar as despesas de cada integrante, mesmo que não tenham acesso ao aplicativo.
            </p>
          </div>
          <Button onClick={abrirNova}>+ Adicionar pessoa</Button>
        </div>
        {erro && <div className="mt-4"><Aviso tipo="erro">{erro}</Aviso></div>}
        {carregando ? (
          <p className="py-8 text-center text-sm text-slate-500" role="status">Carregando pessoas…</p>
        ) : ativas.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-azul-claro text-azul" aria-hidden="true"><span className="text-3xl">👥</span></div>
            <h3 className="text-base font-semibold text-marinho">Nenhuma pessoa cadastrada</h3>
            <p className="mt-2 max-w-md text-sm text-slate-600">
              Adicione pessoas da família e atribua despesas a elas para entender melhor os gastos de cada integrante.
            </p>
            <Button className="mt-5" onClick={abrirNova}>+ Criar pessoa</Button>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ativas.map((pessoa) => (
              <article key={pessoa.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
                {pessoa.fotoUrl ? <img src={pessoa.fotoUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" /> : (
                  <div aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-azul-claro text-sm font-bold text-azul">{iniciais(pessoa.nome)}</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-marinho">{pessoa.nome}</p>
                  <p className="text-sm text-slate-500">{pessoa.userId ? 'Usuário com acesso ao aplicativo' : pessoa.vinculo}</p>
                  {pessoa.nascimento && <p className="text-xs text-slate-500">{dataCurta(pessoa.nascimento)}</p>}
                  {pessoa.userId ? (
                    <p className="mt-2 text-xs font-medium text-azul">Vinculado automaticamente ao login</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button variante="secundario" compacto onClick={() => abrirEdicao(pessoa)}>Editar</Button>
                      <Button variante="discreto" compacto onClick={() => void alternarStatus(pessoa)}>Inativar</Button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {inativas.length > 0 && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <button type="button" onClick={() => setMostrarInativas((v) => !v)} className="text-sm font-semibold text-azul hover:underline">
              {mostrarInativas ? 'Ocultar' : 'Ver'} pessoas inativas ({inativas.length})
            </button>
            {mostrarInativas && <ul className="mt-3 divide-y divide-slate-100">
              {inativas.map((pessoa) => (
                <li key={pessoa.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <div aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-500">{iniciais(pessoa.nome)}</div>
                    <div><p className="font-medium text-slate-700">{pessoa.nome}</p><p className="text-sm text-slate-500">{pessoa.vinculo} · Inativa</p></div>
                  </div>
                  <div className="flex gap-2">
                    <Button variante="secundario" compacto onClick={() => abrirEdicao(pessoa)}>Editar</Button>
                    <Button variante="fantasma" compacto onClick={() => void alternarStatus(pessoa)}>Reativar</Button>
                  </div>
                </li>
              ))}
            </ul>}
          </div>
        )}
      </Card>

      {modal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" role="presentation"
        onMouseDown={(evento) => { if (evento.target === evento.currentTarget) fecharModal() }}>
        <section role="dialog" aria-modal="true" aria-labelledby="pessoa-modal-titulo" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
          <header className="mb-3 flex items-center gap-3">
            <button type="button" aria-label="Voltar" onClick={fecharModal} disabled={salvando} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl text-slate-600 hover:bg-slate-100 disabled:opacity-50">←</button>
            <h2 id="pessoa-modal-titulo" className="flex-1 text-center text-lg font-bold text-marinho">{editando ? 'Editar pessoa' : 'Criar membro'}</h2>
            <span className="h-10 w-10 shrink-0" aria-hidden="true" />
          </header>
          <p className="mb-5 text-center text-sm text-slate-500">
            Os membros poderão ser vinculados às despesas para facilitar a visão dos gastos de cada pessoa.
          </p>
          <form onSubmit={salvar} className="flex flex-col gap-4" noValidate>
            <div className="flex items-center gap-4 rounded-xl bg-slate-50 p-4">
              <div aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-azul-claro text-lg font-bold text-azul">{iniciais(formulario.nome) || '👤'}</div>
              <div className="min-w-0 flex-1">
                <Field rotulo="Nome e sobrenome" placeholder="Digite o nome" maxLength={80} autoComplete="off"
                  value={formulario.nome} onChange={(e) => setFormulario((f) => ({ ...f, nome: e.target.value }))} />
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Dados</h3>
              <Field rotulo="Data de nascimento" type="date" value={formulario.nascimento}
                onChange={(e) => setFormulario((f) => ({ ...f, nascimento: e.target.value }))} />
              <Field rotulo="Foto (URL HTTPS, opcional)" type="url" placeholder="https://..." value={formulario.fotoUrl}
                onChange={(e) => setFormulario((f) => ({ ...f, fotoUrl: e.target.value }))} />
              <div className="flex flex-col gap-1">
                <label htmlFor="pessoa-vinculo" className="text-sm font-medium text-marinho">Vínculo com a família</label>
                <select id="pessoa-vinculo" required value={formulario.vinculo}
                  onChange={(e) => setFormulario((f) => ({ ...f, vinculo: e.target.value as VinculoPessoa | '' }))}
                  className="min-h-11 rounded-lg border border-slate-500 bg-white px-3 text-base">
                  <option value="">Selecione o vínculo</option>
                  {VINCULOS_PESSOA.map((vinculo) => <option key={vinculo} value={vinculo}>{vinculo}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <Button variante="secundario" onClick={fecharModal} disabled={salvando}>Cancelar</Button>
              <Button type="submit" carregando={salvando} disabled={!formulario.nome.trim() || !formulario.vinculo}>
                {editando ? 'Salvar alterações' : 'Criar membro'}
              </Button>
            </div>
          </form>
        </section>
      </div>}
    </>
  )
}
