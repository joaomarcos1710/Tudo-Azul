import { useCallback, useState } from 'react'
import { EntradasSaidas } from '../components/EntradasSaidas'
import { ExportacaoCompleta } from '../components/ExportacaoCompleta'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card, CardTitle } from '../components/ui/Card'
import { useFamilia } from '../lib/FamiliaContext'
import { baixarArquivo, gerarCsv, lancamentosParaExportar, primeiraDataDeLancamento } from '../lib/csv'
import { mensagemErroBanco } from '../lib/erros'
import { formatDate } from '../lib/format'
import { hojeSP } from '../lib/contas'
import { periodoDoMes } from '../lib/periodoRelatorio'
import type { Periodo } from '../lib/periodoRelatorio'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'

export default function Relatorios() {
  const { familia } = useFamilia()
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [exportando, setExportando] = useState(false)
  // período do CSV: acompanha o período do relatório Entradas x Saídas (#179) e pode ser mudado à mão;
  // "Desde o primeiro lançamento" vai até o primeiro dia de uso
  const [de, setDe] = useState(() => periodoDoMes(hojeSP().slice(0, 7)).de)
  const [ate, setAte] = useState(() => periodoDoMes(hojeSP().slice(0, 7)).ate)
  const seguirRelatorio = useCallback((p: Periodo) => { setDe(p.de); setAte(p.ate) }, [])
  const periodoOk = !!de && !!ate && de <= ate

  async function desdeOInicio() {
    if (!familia) return
    setErro('')
    try {
      const primeira = await primeiraDataDeLancamento(familia.id)
      if (primeira) setDe(primeira)
      else setOk('Ainda não há lançamentos para exportar.')
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }

  async function exportarMes() {
    if (!familia) return
    setErro('')
    setOk('')
    setExportando(true)
    try {
      if (!periodoOk) { setErro('Escolha um período válido: o início não pode ser depois do fim.'); return }
      const linhas = await lancamentosParaExportar(familia.id, { de, ate })
      const nome = `tudo-azul-${de}-a-${ate}.csv`
      baixarArquivo(nome, gerarCsv(linhas))
      setOk(`${linhas.length} lançamento(s) exportado(s) em ${nome}.`)
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setExportando(false)
    }
  }

  return (
    <>
      <CabecalhoPagina titulo="Relatórios e exportação" descricao="Quanto entrou e saiu em cada período, e seus dados em planilha." />
      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      {ok && <div className="mb-4"><Aviso tipo="sucesso">{ok}</Aviso></div>}
      <EntradasSaidas aoMudarPeriodo={seguirRelatorio} />
      <h2 className="mb-3 mt-8 text-lg font-bold tracking-tight">Exportar</h2>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardTitle>Exportar lançamentos (CSV)</CardTitle>
          <p className="mb-4 text-sm text-slate-600">
            Começa no período do relatório acima. Para Excel ou Google Planilhas; despesas saem negativas e a lixeira fica de fora. Compras no cartão: veja a{' '}
            <a href="#exportacao-completa" className="font-semibold text-azul underline">exportação completa</a>.
          </p>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm"><span className="font-medium">De</span>
              <input type="date" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} className="min-h-11 min-w-0 rounded-lg border border-slate-500 px-3" />
            </label>
            <label className="flex flex-col gap-1 text-sm"><span className="font-medium">Até</span>
              <input type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} className="min-h-11 min-w-0 rounded-lg border border-slate-500 px-3" />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={exportarMes} carregando={exportando} disabled={exportando || !periodoOk}>
              {periodoOk ? `Exportar de ${formatDate(de)} a ${formatDate(ate)}` : 'Escolha o período'}
            </Button>
            <Button variante="fantasma" onClick={() => void desdeOInicio()}>Desde o primeiro lançamento</Button>
          </div>
        </Card>
        <Card id="exportacao-completa" className="scroll-mt-4">
          <CardTitle>Exportação completa (8 arquivos CSV)</CardTitle>
          <ul className="mb-3 list-disc pl-5 text-sm text-slate-600">
            <li><strong>Lançamentos:</strong> todos, pagos e planejados.</li>
            <li><strong>Movimentos por conta:</strong> tudo o que mexe no saldo (saldo inicial, lançamentos pagos, pagamentos de fatura, juros e tarifas pagos, empréstimos recebidos), com sinal. A soma de cada conta dá o saldo dela hoje.</li>
            <li><strong>Cadastros:</strong> contas, cartões e dívidas com o saldo de hoje calculado pelo app. Em cartão e dívida, positivo é o que você deve; negativo, crédito a receber.</li>
            <li><strong>Parcelas de cartão:</strong> cada parcela com a data da compra, o fechamento da fatura e a situação (cobrada, a cobrar, com cancelamento).</li>
            <li><strong>Eventos de cartão e dívidas:</strong> cobranças, estornos, pagamentos, juros e tarifas, com o efeito de cada um na dívida. Valor inicial + soma dos efeitos até hoje = dívida do cadastro.</li>
            <li><strong>Agenda de parcelas de dívidas:</strong> as parcelas do contrato de empréstimo e financiamento, pagas e planejadas.</li>
            <li><strong>Investimentos:</strong> cada ativo com as operações (inclusive as anuladas), as avaliações e os proventos.</li>
            <li><strong>Bens:</strong> cada bem da família com a titularidade, a situação e todas as avaliações.</li>
          </ul>
          <p className="mb-4 text-sm text-slate-600">
            Serve para conferência e arquivo, <strong>não é restaurável automaticamente</strong>: o app ainda não importa estes arquivos.
            Faça toda semana durante o uso em paralelo com o Organizze, sem lançar nada enquanto prepara.
          </p>
          <ExportacaoCompleta />
        </Card>
      </div>
    </>
  )
}
