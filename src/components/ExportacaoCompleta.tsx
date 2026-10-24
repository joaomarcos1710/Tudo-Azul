import { useState } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { useFamilia } from '../lib/FamiliaContext'
import { hojeSP } from '../lib/contas'
import { baixarArquivo, exportacaoCompleta } from '../lib/csv'
import type { ArquivoExportado } from '../lib/csv'
import { mensagemErroBanco } from '../lib/erros'

/**
 * Exportação completa (5 CSVs) em dois passos: "Preparar" lê o banco, e cada arquivo tem o seu botão de baixar
 * (o navegador bloqueia vários downloads de uma vez). `aoMudarBaixados(true)` quando todos foram baixados e
 * `aoMudarBaixados(false)` sempre que uma nova exportação é preparada (a anterior deixa de valer).
 */
export function ExportacaoCompleta({ aoMudarBaixados }: { aoMudarBaixados?: (todosBaixados: boolean) => void }) {
  const { familia } = useFamilia()
  const [arquivos, setArquivos] = useState<ArquivoExportado[] | null>(null)
  const [baixados, setBaixados] = useState<Set<string>>(new Set())
  const [preparando, setPreparando] = useState(false)
  const [erro, setErro] = useState('')

  async function preparar() {
    if (!familia) return
    setErro('')
    setPreparando(true)
    setArquivos(null)
    setBaixados(new Set())
    aoMudarBaixados?.(false)
    try {
      setArquivos(await exportacaoCompleta(familia.id, hojeSP()))
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setPreparando(false)
    }
  }

  function baixar(a: ArquivoExportado) {
    baixarArquivo(a.nome, a.conteudo)
    const novo = new Set(baixados).add(a.nome)
    setBaixados(novo)
    if (arquivos && novo.size === arquivos.length) aoMudarBaixados?.(true)
  }

  return (
    <div>
      {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}
      <Button variante="secundario" onClick={preparar} carregando={preparando} disabled={preparando}>
        Preparar exportação completa
      </Button>
      {arquivos && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium text-slate-700" role="status">
            Pronta. Baixe os {arquivos.length} arquivos ({baixados.size} de {arquivos.length} baixados):
          </p>
          <ul className="flex flex-col gap-2">
            {arquivos.map((a) => (
              <li key={a.nome} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <span className="min-w-0 break-all">{a.nome} <span className="text-slate-500">· {a.linhas} linha{a.linhas === 1 ? '' : 's'}</span></span>
                <Button variante={baixados.has(a.nome) ? 'fantasma' : 'secundario'} onClick={() => baixar(a)} aria-label={`Baixar ${a.nome}`}>
                  {baixados.has(a.nome) ? 'Baixado ✓ (baixar de novo)' : 'Baixar'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
