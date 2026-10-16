import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { RotaProtegida } from './components/layout/RotaProtegida'
import { ExigeFamilia } from './components/layout/ExigeFamilia'
import VisaoGeral from './pages/VisaoGeral'
import Lancamentos from './pages/Lancamentos'
import Contas from './pages/Contas'
import Categorias from './pages/Categorias'
import Orcamentos from './pages/Orcamentos'
import Relatorios from './pages/Relatorios'
import Familia from './pages/Familia'
import Entrar from './pages/auth/Entrar'
import Cadastro from './pages/auth/Cadastro'
import RecuperarSenha from './pages/auth/RecuperarSenha'
import NovaSenha from './pages/auth/NovaSenha'
import Convite from './pages/Convite'

export default function App() {
  return (
    <Routes>
      <Route path="entrar" element={<Entrar />} />
      <Route path="cadastro" element={<Cadastro />} />
      <Route path="recuperar-senha" element={<RecuperarSenha />} />
      <Route path="nova-senha" element={<NovaSenha />} />
      <Route path="convite" element={<RotaProtegida><Convite /></RotaProtegida>} />
      <Route element={<RotaProtegida><AppShell /></RotaProtegida>}>
        <Route path="familia" element={<Familia />} />
        <Route element={<ExigeFamilia />}>
          <Route index element={<VisaoGeral />} />
          <Route path="lancamentos" element={<Lancamentos />} />
          <Route path="contas" element={<Contas />} />
          <Route path="categorias" element={<Categorias />} />
          <Route path="orcamentos" element={<Orcamentos />} />
          <Route path="relatorios" element={<Relatorios />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
