import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import VisaoGeral from './pages/VisaoGeral'
import Lancamentos from './pages/Lancamentos'
import Contas from './pages/Contas'
import Categorias from './pages/Categorias'
import Orcamentos from './pages/Orcamentos'
import Relatorios from './pages/Relatorios'
import Familia from './pages/Familia'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<VisaoGeral />} />
        <Route path="lancamentos" element={<Lancamentos />} />
        <Route path="contas" element={<Contas />} />
        <Route path="categorias" element={<Categorias />} />
        <Route path="orcamentos" element={<Orcamentos />} />
        <Route path="relatorios" element={<Relatorios />} />
        <Route path="familia" element={<Familia />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
