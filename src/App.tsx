import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { RotaProtegida } from './components/layout/RotaProtegida'
import { ExigeFamilia } from './components/layout/ExigeFamilia'
import VisaoGeral from './pages/VisaoGeral'
import Lancamentos from './pages/Lancamentos'
import Calendario from './pages/Calendario'
import Recorrentes from './pages/Recorrentes'
import RegrasAutomaticas from './pages/RegrasAutomaticas'
import Contas from './pages/Contas'
import Conferir from './pages/Conferir'
import Cartoes from './pages/Cartoes'
import Categorias from './pages/Categorias'
import Orcamentos from './pages/Orcamentos'
import Relatorios from './pages/Relatorios'
import Familia from './pages/Familia'
import Entrar from './pages/auth/Entrar'
import Cadastro from './pages/auth/Cadastro'
import RecuperarSenha from './pages/auth/RecuperarSenha'
import NovaSenha from './pages/auth/NovaSenha'
import Convite from './pages/Convite'
import { useValoresOcultos } from './lib/privacidade'

export default function App() {
  // Ao ocultar/mostrar valores o App re-renderiza e, com ele, todas as telas (que recebem elementos novos).
  useValoresOcultos()
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
          <Route path="analises" element={<VisaoGeral secao="analises" />} />
          <Route path="lancamentos" element={<Lancamentos />} />
          <Route path="calendario" element={<Calendario />} />
          <Route path="recorrentes" element={<Recorrentes />} />
          <Route path="regras-automaticas" element={<RegrasAutomaticas />} />
          <Route path="contas" element={<Contas />} />
          <Route path="contas/:contaId/conferir" element={<Conferir />} />
          <Route path="cartoes" element={<Cartoes />} />
          <Route path="categorias" element={<Categorias />} />
          <Route path="orcamentos" element={<Orcamentos />} />
          <Route path="relatorios" element={<Relatorios />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
