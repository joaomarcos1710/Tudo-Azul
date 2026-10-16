import { useState } from 'react'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card, CardTitle } from '../components/ui/Card'
import { useFamilia } from '../lib/FamiliaContext'
import { hojeSP } from '../lib/contas'
import { baixarArquivo, gerarCsv, lancamentosParaExportar } from '../lib/csv'
import { mensagemErroBanco } from '../lib/erros'
import { currentMonth, formatMonth } from '../lib/format'
import { limitesDoMes } from '../lib/lancamentos'

export default function Relatorios() {
  const { familia } = useFamilia()
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [exportando, setExportando] = useState<'mes' | 'tudo' | null>(null)
  const mes = currentMonth()

  async function exportar(qual: 'mes' | 'tudo') {
    if (!familia) return
    setErro('')
    setOk('')
    setExportando(qual)
    try {
      const [de, ate] = limitesDoMes(mes)
      const linhas = await lancamentosParaExportar(familia.id, qual === 'mes' ? { de, ate } : undefined)
      const nome = qual === 'mes' ? `tudo-azul-${mes}.csv` : `tudo-azul-backup-${hojeSP()}.csv`
      baixarArquivo(nome, gerarCsv(linhas))
      setOk(`${linhas.length} lançamento(s) exportado(s) em ${nome}.`)
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setExportando(null)
    }
  }

  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">Relatórios</h1>
      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      {ok && <div className="mb-4"><Aviso tipo="sucesso">{ok}</Aviso></div>}
      <Card>
        <CardTitle>Exportar lançamentos (CSV)</CardTitle>
        <p className="mb-4 text-sm text-slate-600">
          Abre no Excel e no Google Planilhas. Despesas saem com valor negativo; transferências, com as duas contas.
          Lançamentos na lixeira ficam de fora. <strong>Faça o backup completo toda semana</strong> durante o uso em paralelo com o Organizze.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => exportar('mes')} carregando={exportando === 'mes'} disabled={exportando !== null}>
            Exportar {formatMonth(mes)}
          </Button>
          <Button variante="secundario" onClick={() => exportar('tudo')} carregando={exportando === 'tudo'} disabled={exportando !== null}>
            Backup completo
          </Button>
        </div>
      </Card>
    </>
  )
}
