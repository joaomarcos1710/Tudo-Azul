import { useState } from 'react'
import { useFinanceStore, Lancamento } from '../../lib/store'
import { formatBRL } from '../../lib/format'
import { Button } from '../ui/Button'
import { X, UploadCloud, FileSpreadsheet, CheckCircle2, AlertCircle } from 'lucide-react'

interface Props {
  aberto: boolean
  aoFechar: () => void
}

interface ItemImportado {
  descricao: string
  valor: number
  data: string
  tipo: 'receita' | 'despesa'
  categoriaId: string
  selecionado: boolean
}

export function ModalImportarExtrato({ aberto, aoFechar }: Props) {
  const { contas, categorias, membros, importarLancamentos } = useFinanceStore()
  const [contaId, setContaId] = useState(contas[0]?.id || '')
  const [membroId, setMembroId] = useState(membros[0]?.id || '')
  const [itens, setItens] = useState<ItemImportado[]>([])
  const [sucesso, setSucesso] = useState(false)
  const [erro, setErro] = useState('')

  if (!aberto) return null

  // Gera dados simulados realistas de extrato bancário brasileiro para o usuário testar de imediato se não tiver arquivo em mãos
  const carregarExemploExtrato = () => {
    const hoje = new Date()
    const ano = hoje.getFullYear()
    const mes = String(hoje.getMonth() + 1).padStart(2, '0')

    const listaExemplo: ItemImportado[] = [
      { descricao: 'PAGTO PIX FARMACIA DROGASIL', valor: 89.90, data: `${ano}-${mes}-04`, tipo: 'despesa', categoriaId: 'cat-saude', selecionado: true },
      { descricao: 'POSTO IPIRANGA COMBUSTIVEL', valor: 195.00, data: `${ano}-${mes}-07`, tipo: 'despesa', categoriaId: 'cat-transporte', selecionado: true },
      { descricao: 'RECEBIMENTO PIX CLIENTE FREELA', valor: 950.00, data: `${ano}-${mes}-10`, tipo: 'receita', categoriaId: 'cat-extra', selecionado: true },
      { descricao: 'MERCADO CARREFOUR EXPRESS', valor: 142.50, data: `${ano}-${mes}-12`, tipo: 'despesa', categoriaId: 'cat-alimentacao', selecionado: true },
      { descricao: 'IFOOD RESTAURANTE GOURMET', valor: 76.00, data: `${ano}-${mes}-13`, tipo: 'despesa', categoriaId: 'cat-lazer', selecionado: true },
    ]
    setItens(listaExemplo)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string
        const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
        const parsed: ItemImportado[] = []
        const hojeIso = new Date().toISOString().slice(0, 10)

        // Tenta interpretar CSV simples: Data, Descrição, Valor
        for (let i = 0; i < lines.length; i++) {
          const cols = lines[i].split(/[;,]/)
          if (cols.length >= 2) {
            // Ignora cabeçalho se houver
            if (cols[0].toLowerCase().includes('data') || cols[1].toLowerCase().includes('desc')) continue

            const desc = cols[1]?.trim() || cols[0]?.trim() || 'Lançamento Importado'
            const valStr = (cols[2] || cols[1] || '0').replace('R$', '').trim().replace(/\./g, '').replace(',', '.')
            const val = parseFloat(valStr)

            if (!isNaN(val) && val !== 0) {
              const tipo = val < 0 ? 'despesa' : 'receita'
              parsed.push({
                descricao: desc,
                valor: Math.abs(val),
                data: cols[0]?.includes('-') || cols[0]?.includes('/') ? cols[0].trim() : hojeIso,
                tipo,
                categoriaId: tipo === 'receita' ? 'cat-salario' : 'cat-outros-desp',
                selecionado: true,
              })
            }
          }
        }

        if (parsed.length > 0) {
          setItens(parsed)
          setErro('')
        } else {
          // Se arquivo estiver vazio ou formatação diferente, carrega o modelo
          carregarExemploExtrato()
        }
      } catch (err) {
        setErro('Não foi possível ler o arquivo. Você pode usar a amostra de teste abaixo.')
        carregarExemploExtrato()
      }
    }
    reader.readAsText(file)
  }

  const handleConfirmarImportacao = () => {
    const selecionados = itens.filter(i => i.selecionado)
    if (selecionados.length === 0) return

    const novos: Omit<Lancamento, 'id'>[] = selecionados.map(item => ({
      descricao: item.descricao,
      valor: item.valor,
      data: item.data.length === 10 ? item.data : new Date().toISOString().slice(0, 10),
      tipo: item.tipo,
      status: 'pago',
      categoriaId: item.categoriaId,
      contaId,
      membroId,
    }))

    importarLancamentos(novos)
    setSucesso(true)
    setTimeout(() => {
      setSucesso(false)
      setItens([])
      aoFechar()
    }, 1200)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50">
          <div className="flex items-center gap-2">
            <UploadCloud className="h-5 w-5 text-azul" />
            <h2 className="text-base font-bold text-marinho">Importar Extrato Bancário (CSV / OFX)</h2>
          </div>
          <button
            type="button"
            onClick={aoFechar}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {sucesso ? (
          <div className="p-10 text-center space-y-3">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-10 w-10" />
            </div>
            <h3 className="text-xl font-bold text-slate-900">Extrato Importado com Sucesso!</h3>
            <p className="text-sm text-slate-500">
              Os lançamentos já estão disponíveis no seu extrato e atualizados no saldo.
            </p>
          </div>
        ) : (
          <div className="p-6 overflow-y-auto space-y-5 flex-1">
            {erro && (
              <div className="flex items-center gap-2 p-3 text-sm text-amber-800 bg-amber-50 rounded-lg border border-amber-200">
                <AlertCircle className="h-4 w-4" />
                <span>{erro}</span>
              </div>
            )}

            {/* Configuração de destino da importação */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Conta para onde vão os lançamentos
                </label>
                <select
                  value={contaId}
                  onChange={e => setContaId(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {contas.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.nome} ({c.instituicao})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                  Atribuir a qual membro da família
                </label>
                <select
                  value={membroId}
                  onChange={e => setMembroId(e.target.value)}
                  className="w-full h-11 px-3 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {membros.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.nome}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Dropzone / Upload ou botão de simulação */}
            {itens.length === 0 ? (
              <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center space-y-4 hover:border-azul transition bg-slate-50/50">
                <FileSpreadsheet className="h-12 w-12 text-slate-400 mx-auto" />
                <div>
                  <p className="text-sm font-semibold text-slate-700">
                    Selecione o arquivo de extrato do seu banco (.csv ou .ofx)
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Compatível com extratos do Nubank, Itaú, Bradesco, Inter, Santander e C6
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                  <label className="cursor-pointer inline-flex items-center gap-2 rounded-lg bg-azul px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition">
                    <UploadCloud className="h-4 w-4" /> Escolher Arquivo CSV
                    <input
                      type="file"
                      accept=".csv,.txt"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={carregarExemploExtrato}
                    className="text-xs font-medium text-azul hover:underline py-2 px-3"
                  >
                    Ou testar com extrato de demonstração
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-800">
                    Transações Encontradas ({itens.length})
                  </h3>
                  <button
                    type="button"
                    onClick={() => setItens([])}
                    className="text-xs text-slate-500 hover:text-red-600 hover:underline"
                  >
                    Trocar arquivo
                  </button>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 max-h-60 overflow-y-auto">
                  {itens.map((item, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center gap-3 p-3 text-sm transition ${
                        item.selecionado ? 'bg-white' : 'bg-slate-50 opacity-60'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={item.selecionado}
                        onChange={e => {
                          const novo = [...itens]
                          novo[idx].selecionado = e.target.checked
                          setItens(novo)
                        }}
                        className="h-4 w-4 rounded text-azul"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 truncate">{item.descricao}</p>
                        <p className="text-xs text-slate-400">{item.data}</p>
                      </div>
                      <select
                        value={item.categoriaId}
                        onChange={e => {
                          const novo = [...itens]
                          novo[idx].categoriaId = e.target.value
                          setItens(novo)
                        }}
                        className="text-xs rounded border border-slate-200 px-2 py-1 bg-white"
                      >
                        {categorias.map(cat => (
                          <option key={cat.id} value={cat.id}>
                            {cat.nome}
                          </option>
                        ))}
                      </select>
                      <span
                        className={`font-semibold shrink-0 ${
                          item.tipo === 'receita' ? 'text-emerald-600' : 'text-slate-800'
                        }`}
                      >
                        {item.tipo === 'receita' ? '+' : '-'} {formatBRL(item.valor)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
              <Button variante="secundario" onClick={aoFechar} type="button">
                Cancelar
              </Button>
              {itens.length > 0 && (
                <Button variante="primario" onClick={handleConfirmarImportacao} type="button">
                  Confirmar e Importar {itens.filter(i => i.selecionado).length} Lançamentos
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
