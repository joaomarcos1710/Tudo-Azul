import { useState } from 'react'
import { useFinanceStore } from '../../lib/store'
import { Button } from '../ui/Button'
import { X, Download, Code, FileJson, Check, Copy } from 'lucide-react'

interface Props {
  aberto: boolean
  aoFechar: () => void
}

export function ModalExportarCodigo({ aberto, aoFechar }: Props) {
  const store = useFinanceStore()
  const [copiado, setCopiado] = useState(false)
  const [aba, setAba] = useState<'dados' | 'git' | 'arquivos'>('dados')

  if (!aberto) return null

  const handleDownloadJSON = () => {
    const dadosExportacao = {
      versao: '2.0',
      dataExportacao: new Date().toISOString(),
      aplicativo: 'Tudo Azul - Gestão Financeira Familiar',
      dados: {
        contas: store.contas,
        cartoes: store.cartoes,
        categorias: store.categorias,
        lancamentos: store.lancamentos,
        orcamentos: store.orcamentos,
        metas: store.metas,
        membros: store.membros,
        bens: store.bens,
        investimentos: store.investimentos,
        emprestimos: store.emprestimos,
      },
    }

    const blob = new Blob([JSON.stringify(dadosExportacao, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tudo-azul-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const comandoGit = `# Para clonar ou rodar o projeto localmente:
git clone <seu-repositorio> tudo-azul
cd tudo-azul
npm install
npm run dev`

  const copiarComando = () => {
    navigator.clipboard.writeText(comandoGit)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-100 overflow-hidden flex flex-col">
        {/* Topo */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <Code className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Código & Exportação de Dados
              </h2>
              <p className="text-[11px] text-slate-500">
                Baixe seus dados financeiros ou execute o código localmente
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={aoFechar}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Abas */}
        <div className="flex border-b border-slate-200 px-6 pt-3 gap-4 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setAba('dados')}
            className={`pb-2.5 border-b-2 transition ${
              aba === 'dados'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Backup dos Dados (JSON)
          </button>
          <button
            type="button"
            onClick={() => setAba('git')}
            className={`pb-2.5 border-b-2 transition ${
              aba === 'git'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Instruções do Código
          </button>
          <button
            type="button"
            onClick={() => setAba('arquivos')}
            className={`pb-2.5 border-b-2 transition ${
              aba === 'arquivos'
                ? 'border-blue-600 text-blue-600 font-bold'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Estrutura do Projeto
          </button>
        </div>

        {/* Conteúdo */}
        <div className="p-6 space-y-4">
          {aba === 'dados' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-100 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-blue-900">
                  <FileJson className="h-4 w-4 text-blue-600" />
                  <span>Download Completo das Finanças</span>
                </div>
                <p className="text-xs text-blue-700/80 leading-relaxed">
                  Exporta todos os seus lançamentos, contas com moedas BRL/USD/EUR, parcelas de cartões e carnês, bens patrimoniais, metas e regras 50-30-20 em formato JSON estruturado.
                </p>
              </div>

              <div className="text-xs text-slate-600 space-y-1">
                <div>• Total de lançamentos cadastrados: <strong>{store.lancamentos.length}</strong></div>
                <div>• Contas bancárias e carteiras: <strong>{store.contas.length}</strong></div>
                <div>• Cartões de crédito cadastrados: <strong>{store.cartoes.length}</strong></div>
                <div>• Bens e patrimônio: <strong>{store.bens.length}</strong></div>
              </div>

              <Button
                variante="primario"
                onClick={handleDownloadJSON}
                className="w-full flex items-center justify-center gap-2 text-xs py-2.5 shadow-sm font-bold"
              >
                <Download className="h-4 w-4" /> Baixar Arquivo JSON de Backup
              </Button>
            </div>
          )}

          {aba === 'git' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Todo o código-fonte está estruturado em <strong>React 18 + Vite + Tailwind CSS + TypeScript</strong> sem dependências complexas. Para rodar em sua máquina:
              </p>

              <div className="relative rounded-xl bg-slate-900 p-3.5 text-[11px] font-mono text-emerald-400 overflow-x-auto">
                <button
                  type="button"
                  onClick={copiarComando}
                  className="absolute right-2 top-2 p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white transition"
                  title="Copiar comandos"
                >
                  {copiado ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
                <pre>{comandoGit}</pre>
              </div>

              <p className="text-[11px] text-slate-500">
                Você pode solicitar qualquer arquivo individual no chat ou exportar o projeto diretamente.
              </p>
            </div>
          )}

          {aba === 'arquivos' && (
            <div className="space-y-2 text-xs text-slate-600 max-h-60 overflow-y-auto">
              <div className="font-bold text-slate-800 mb-1">Módulos principais do código:</div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/60 font-mono text-[11px] space-y-1">
                <div>📁 <span className="font-bold">src/pages/</span></div>
                <div className="pl-4">📄 Calendario.tsx (Grade de fluxo de entradas e saídas)</div>
                <div className="pl-4">📄 FluxoMensal.tsx (Fixos, variáveis, parcelas & carnês)</div>
                <div className="pl-4">📄 VisaoGeral.tsx (Dashboard principal com contas)</div>
                <div className="pl-4">📄 Bens.tsx (Imóveis, veículos, terrenos)</div>
                <div className="pl-4">📄 Investimentos.tsx & Emprestimos.tsx</div>
                <div className="pl-4">📄 Categorias.tsx (Metodologia 50-30-20)</div>
                <div>📁 <span className="font-bold">src/components/ui/</span></div>
                <div className="pl-4">📄 BancoLogo.tsx (SVGs oficiais de bancos brasileiros)</div>
                <div>📁 <span className="font-bold">public/bancos/</span></div>
                <div className="pl-4">🎨 SVGs vetoriais em alta precisão (Nubank, Itaú, etc.)</div>
              </div>
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-end px-6 py-3 border-t border-slate-100 bg-slate-50">
          <Button variante="secundario" onClick={aoFechar} className="text-xs">
            Fechar
          </Button>
        </div>
      </div>
    </div>
  )
}
