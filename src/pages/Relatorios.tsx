import { EntradasSaidas } from '../components/EntradasSaidas'
import { CabecalhoPagina } from '../components/ui/CabecalhoPagina'

/** Relatórios: só os relatórios (a exportação foi para Conta › Exportar dados, pedido do dono em 05/11/2026). */
export default function Relatorios() {
  return (
    <>
      <CabecalhoPagina titulo="Relatórios" descricao="Quanto entrou e saiu em cada período." />
      <EntradasSaidas />
    </>
  )
}
