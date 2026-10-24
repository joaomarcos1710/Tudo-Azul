import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Aviso } from './ui/Aviso'
import { Button } from './ui/Button'
import { Card, CardTitle } from './ui/Card'
import { ExportacaoCompleta } from './ExportacaoCompleta'
import { useFamilia } from '../lib/FamiliaContext'
import { mensagemErroBanco } from '../lib/erros'
import { FRASE_ZERAR, previaZerar, totalDaPrevia, zerarTudo } from '../lib/zerar'
import type { PreviaZerar } from '../lib/zerar'

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/**
 * "Zerar tudo": só o dono. Apaga todos os dados financeiros da família (irreversível). Três portas:
 * ver o que será apagado, baixar a exportação completa e escrever a frase. O banco confere o dono e a frase.
 */
export function ZerarTudo() {
  const { familia } = useFamilia()
  const familiaId = familia?.id
  const [previa, setPrevia] = useState<PreviaZerar | null>(null)
  const [baixou, setBaixou] = useState(false)
  const [frase, setFrase] = useState('')
  const [zerando, setZerando] = useState(false)
  const [erro, setErro] = useState('')
  const [feito, setFeito] = useState<PreviaZerar | null>(null)

  const carregar = useCallback(async () => {
    if (!familiaId) return
    try {
      setPrevia(await previaZerar(familiaId))
    } catch (err) {
      setErro(mensagemErroBanco(err))
    }
  }, [familiaId])
  useEffect(() => { void carregar() }, [carregar])

  async function zerar() {
    if (!familiaId) return
    setErro('')
    setZerando(true)
    try {
      setFeito(await zerarTudo(familiaId, frase))
      setFrase('')
      setBaixou(false)
      await carregar()
    } catch (err) {
      setErro(mensagemErroBanco(err))
    } finally {
      setZerando(false)
    }
  }

  if (!familiaId) return null
  const vazio = previa !== null && totalDaPrevia(previa) === 0
  const fraseCerta = frase.trim().toLowerCase() === FRASE_ZERAR

  return (
    <Card className="border border-red-200">
      <CardTitle>Zona de perigo · Zerar tudo</CardTitle>
      {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}
      {feito && (
        <div className="mb-3">
          <Aviso tipo="sucesso">
            Pronto, tudo foi zerado ({plural(feito.lancamentos, 'lançamento', 'lançamentos')}, {plural(feito.contas, 'conta', 'contas')},{' '}
            {plural(feito.cartoesEDividas, 'cartão ou dívida', 'cartões e dívidas')} apagados). Agora cadastre suas contas em{' '}
            <Link to="/contas" className="font-semibold underline">Contas</Link> com os saldos reais.
          </Aviso>
        </div>
      )}
      {previa === null && !erro && <p className="text-sm text-slate-600" role="status">Carregando…</p>}
      {vazio && <p className="text-sm text-slate-600">Não há nada para zerar: a família não tem contas, cartões nem lançamentos.</p>}
      {previa !== null && !vazio && (
        <>
          <p className="mb-2 text-sm text-slate-700">
            Isso <strong>apaga para sempre</strong> os dados financeiros desta família, para você recomeçar com os saldos reais:
          </p>
          <ul className="mb-3 list-disc pl-5 text-sm text-slate-700">
            <li>{plural(previa.lancamentos, 'lançamento', 'lançamentos')} (inclusive os da lixeira e os planejados)</li>
            <li>{plural(previa.contas, 'conta', 'contas')} e seus saldos</li>
            <li>{plural(previa.cartoesEDividas, 'cartão ou dívida', 'cartões e dívidas')}, com {plural(previa.parcelas, 'parcela', 'parcelas')} e faturas</li>
            <li>{plural(previa.recorrencias, 'recorrência', 'recorrências')}, {plural(previa.conciliacoes, 'conciliação', 'conciliações')} e {plural(previa.orcamentos, 'orçamento', 'orçamentos')}</li>
          </ul>
          <p className="mb-4 text-sm text-slate-700">
            <strong>Ficam:</strong> a família, os membros e as categorias. <strong>Não tem volta</strong>: a exportação serve para consulta
            e arquivo, o app não consegue restaurar a partir dela.
          </p>

          <h3 className="mb-2 text-sm font-semibold text-slate-600">1. Baixe a exportação completa</h3>
          <ExportacaoCompleta aoTodosBaixados={() => setBaixou(true)} />

          <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-600">2. Confirme</h3>
          <div className="flex flex-col gap-3 sm:max-w-md">
            <label className="text-sm text-slate-700" htmlFor="frase-zerar">
              Para confirmar, escreva <strong>{FRASE_ZERAR}</strong>
            </label>
            <input
              id="frase-zerar" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={!baixou}
              className="min-h-11 rounded-lg border border-slate-300 px-3 disabled:bg-slate-100"
              value={frase} onChange={(e) => setFrase(e.target.value)}
            />
            {!baixou && <p className="text-xs text-slate-500">Libera depois de baixar os arquivos acima.</p>}
            <Button variante="perigo" onClick={zerar} carregando={zerando} disabled={!baixou || !fraseCerta || zerando}>Zerar tudo</Button>
          </div>
        </>
      )}
    </Card>
  )
}
