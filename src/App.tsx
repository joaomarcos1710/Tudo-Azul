import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import VisaoGeral from './pages/VisaoGeral'
import Calendario from './pages/Calendario'
import Lancamentos from './pages/Lancamentos'
import Contas from './pages/Contas'
import FluxoMensal from './pages/FluxoMensal'
import Bens from './pages/Bens'
import Investimentos from './pages/Investimentos'
import Emprestimos from './pages/Emprestimos'
import Categorias from './pages/Categorias'
import Orcamentos from './pages/Orcamentos'
import Metas from './pages/Metas'
import Relatorios from './pages/Relatorios'
import Familia from './pages/Familia'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<VisaoGeral />} />
        <Route path="calendario" element={<Calendario />} />
        <Route path="lancamentos" element={<Lancamentos />} />
        <Route path="contas" element={<Contas />} />
        <Route path="fluxo" element={<FluxoMensal />} />
        <Route path="bens" element={<Bens />} />
        <Route path="investimentos" element={<Investimentos />} />
        <Route path="emprestimos" element={<Emprestimos />} />
        <Route path="orcamentos" element={<Orcamentos />} />
        <Route path="metas" element={<Metas />} />
        <Route path="relatorios" element={<Relatorios />} />
        <Route path="categorias" element={<Categorias />} />
        <Route path="familia" element={<Familia />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
