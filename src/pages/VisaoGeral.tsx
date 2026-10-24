import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Aviso } from '../components/ui/Aviso'
import { Card, CardTitle } from '../components/ui/Card'
import { useFamilia } from '../lib/FamiliaContext'
import { cobrarFaturasFechadas } from '../lib/cartoes'
import { hojeSP, listarContas } from '../lib/contas'
import type { Conta } from '../lib/contas'
import { mensagemErroBanco } from '../lib/erros'
import { currentMonth, formatBRL, formatDate, formatMonth } from '../lib/format'
import type { Cents } from '../lib/format'
import { resumoDoMes } from '../lib/lancamentos'
import type { ResumoMes } from '../lib/lancamentos'
import { carregarPatrimonio, proximosPlanejados } from '../lib/painel'
import type { Patrimonio, ProximoPlanejado } from '../lib/painel'

interface Dados {
  patrimonio: Patrimonio
  mes: ResumoMes
  contas: Conta[]
  proximos: ProximoPlanejado[]
}

/** Painel: tudo vem calculado do banco (net_worth, period_summary, account_balances). */
export default function VisaoGeral() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [dados, setDados] = useState<Dados | null>(null)
  const [erro, setErro] = useState('')
  const [cobrancaFalhou, setCobrancaFalhou] = useState(false)
  const hoje = hojeSP()
  const mes = currentMonth()

  useEffect(() => {
    if (!familiaId) return
    // cobra as parcelas de cartão cujo fechamento chegou; se falhar, o painel mostra o que já está cobrado, com aviso
    cobrarFaturasFechadas()
      .then(() => setCobrancaFalhou(false))
      .catch(() => setCobrancaFalhou(true))
      .then(() => Promise.all([carregarPatrimonio(familiaId, hoje), resumoDoMes(familiaId, mes), listarContas(familiaId, hoje), proximosPlanejados(familiaId, hoje)]))
      .then(([patrimonio, resumo, c, proximos]) => setDados({ patrimonio, mes: resumo, contas: c.contas.filter((x) => x.ativa), proximos }))
      .catch((err) => setErro(mensagemErroBanco(err)))
  }, [familiaId, hoje, mes])

  if (!familiaId) return null
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>
  if (!dados) return <p className="text-sm text-slate-600" role="status">Carregando…</p>

  const { patrimonio: p, mes: m } = dados
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold">Visão geral</h1>
      {cobrancaFalhou && (
        <div className="mb-4">
          <Aviso tipo="erro">Não foi possível fechar as faturas dos cartões agora. Os valores de cartão podem estar defasados.</Aviso>
        </div>
      )}

      <section aria-label="Patrimônio" className="mb-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Disponível" valor={p.disponivel} />
        <Indicador rotulo="+ Crédito a receber" valor={p.creditoAReceber} cor="text-[#0F766E]" />
        <Indicador rotulo="− Dívida" valor={p.divida} cor="text-[#C2410C]" />
        <Indicador rotulo="= Patrimônio líquido" valor={p.patrimonio} destaque />
      </section>
      <p className="mb-3 text-xs text-slate-500">Contas e dívidas. Não inclui bens nem investimentos.</p>
      {p.compromissos > 0 && (
        <div className="mb-6 rounded-card border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
          Compromissos futuros (parcelas de cartão ainda não cobradas): <strong className="tabular-nums">{formatBRL(p.compromissos)}</strong>.
          Não entram no patrimônio de hoje.
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>{`Este mês · ${formatMonth(mes)}`}</CardTitle>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div><dt className="text-slate-500">Receitas</dt><dd className="tabular-nums font-semibold text-positivo">+{formatBRL(m.receitas)}</dd></div>
            <div><dt className="text-slate-500">Despesas</dt><dd className="tabular-nums font-semibold text-negativo">−{formatBRL(m.despesas)}</dd></div>
            <div><dt className="text-slate-500">Resultado</dt><dd className={`tabular-nums font-semibold ${m.resultado < 0 ? 'text-negativo' : ''}`}>{formatBRL(m.resultado)}</dd></div>
          </dl>
          {(m.receitasPrevistas > 0 || m.despesasPrevistas > 0) && (
            <p className="mt-3 text-xs text-planejado">Ainda planejado no mês: +{formatBRL(m.receitasPrevistas)} / −{formatBRL(m.despesasPrevistas)}</p>
          )}
          <Link to="/lancamentos" className="mt-4 inline-block text-sm font-semibold text-azul hover:underline">Ver lançamentos</Link>
        </Card>

        <Card>
          <CardTitle>Próximos planejados</CardTitle>
          {dados.proximos.length === 0 ? (
            <p className="text-sm text-slate-500">Nada planejado a partir de hoje.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {dados.proximos.map((x) => (
                <li key={x.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{formatDate(x.data)} · {x.descricao || (x.tipo === 'income' ? 'Receita' : x.tipo === 'expense' ? 'Despesa' : 'Transferência')}</span>
                  <span className={`tabular-nums font-semibold ${x.tipo === 'income' ? 'text-positivo' : x.tipo === 'expense' ? 'text-negativo' : 'text-slate-600'}`}>
                    {x.tipo === 'income' ? '+' : x.tipo === 'expense' ? '−' : '⇄ '}{formatBRL(x.valor)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle>Contas</CardTitle>
          {dados.contas.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma conta ativa. <Link to="/contas" className="font-semibold text-azul hover:underline">Cadastrar conta</Link></p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {dados.contas.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{c.nome}</span>
                  <span className={`tabular-nums font-semibold ${c.saldo !== null && c.saldo < 0 ? 'text-negativo' : ''}`}>
                    {c.saldo === null ? `abre em ${formatDate(c.abertura)}` : formatBRL(c.saldo)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}

function Indicador({ rotulo, valor, cor = '', destaque = false }: { rotulo: string; valor: Cents; cor?: string; destaque?: boolean }) {
  const negativo = destaque && valor < 0
  return (
    <Card className={destaque ? 'bg-marinho text-white' : ''}>
      <p className={`text-sm ${destaque ? 'text-blue-100' : 'text-slate-500'}`}>{rotulo}</p>
      <p className={`tabular-nums text-xl font-bold ${negativo ? 'text-red-300' : cor}`}>{formatBRL(valor)}</p>
    </Card>
  )
}
