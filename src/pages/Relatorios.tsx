import { useState } from 'react'
import { ExportacaoCompleta } from '../components/ExportacaoCompleta'
import { Aviso } from '../components/ui/Aviso'
import { Button } from '../components/ui/Button'
import { Card, CardTitle } from '../components/ui/Card'
import { useFamilia } from '../lib/FamiliaContext'
import { baixarArquivo, gerarCsv, lancamentosParaExportar } from '../lib/csv'
import { mensagemErroBanco } from '../lib/erros'
import { currentMonth, formatMonth } from '../lib/format'
import { limitesDoMes } from '../lib/lancamentos'

export default function Relatorios() {
  const { familia } = useFamilia()
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [exportando, setExportando] = useState(false)
  const mes = currentMonth()

  async function exportarMes() {
    if (!familia) return
    setErro('')
    setOk('')
    setExportando(true)
    try {
      const [de, ate] = limitesDoMes(mes)
      const linhas = await lancamentosParaExportar(familia.id, { de, ate })
      const nome = `tudo-azul-${mes}.csv`
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
      <h1 className="mb-6 text-2xl font-bold">Relatórios</h1>
      {erro && <div className="mb-4"><Aviso tipo="erro">{erro}</Aviso></div>}
      {ok && <div className="mb-4"><Aviso tipo="sucesso">{ok}</Aviso></div>}
      <Card className="mb-4">
        <CardTitle>Lançamentos do mês (CSV)</CardTitle>
        <p className="mb-4 text-sm text-slate-600">
          Abre no Excel e no Google Planilhas. Despesas saem com valor negativo; transferências, com as duas contas.
          Lançamentos na lixeira ficam de fora. Compras no cartão não estão aqui: ficam na exportação completa.
        </p>
        <Button onClick={exportarMes} carregando={exportando} disabled={exportando}>
          Exportar {formatMonth(mes)}
        </Button>
      </Card>
      <Card>
        <CardTitle>Exportação completa (5 arquivos CSV)</CardTitle>
        <ul className="mb-3 list-disc pl-5 text-sm text-slate-600">
          <li><strong>Lançamentos:</strong> todos, pagos e planejados.</li>
          <li><strong>Movimentos por conta:</strong> tudo o que mexe no saldo (saldo inicial, lançamentos pagos, pagamentos de fatura, juros e tarifas pagos, empréstimos recebidos), com sinal. A soma de cada conta dá o saldo dela hoje.</li>
          <li><strong>Cadastros:</strong> contas, cartões e dívidas com o saldo de hoje calculado pelo app. Em cartão e dívida, positivo é o que você deve; negativo, crédito a receber.</li>
          <li><strong>Parcelas de cartão:</strong> cada parcela com a data da compra, o fechamento da fatura e a situação (cobrada, a cobrar, com cancelamento).</li>
          <li><strong>Eventos de cartão e dívidas:</strong> cobranças, estornos, pagamentos, juros e tarifas, com o efeito de cada um na dívida. Valor inicial + soma dos efeitos até hoje = dívida do cadastro.</li>
        </ul>
        <p className="mb-4 text-sm text-slate-600">
          Serve para conferência e arquivo, <strong>não é restaurável automaticamente</strong>: o app ainda não importa estes arquivos.
          Faça toda semana durante o uso em paralelo com o Organizze, sem lançar nada enquanto prepara.
        </p>
        <ExportacaoCompleta />
      </Card>
    </>
  )
}
