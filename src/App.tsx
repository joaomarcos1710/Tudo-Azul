import { Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { RotaProtegida } from './components/layout/RotaProtegida'
import { ExigeFamilia } from './components/layout/ExigeFamilia'
import VisaoGeral from './pages/VisaoGeral'
import Entrar from './pages/auth/Entrar'
import { useValoresOcultos } from './lib/privacidade'
import { carregarTela } from './lib/carregarTela'

// Início e Entrar vêm no arquivo principal (primeira tela); as demais, sob demanda.
const Lancamentos = carregarTela(() => import('./pages/Lancamentos'))
const Calendario = carregarTela(() => import('./pages/Calendario'))
const Recorrentes = carregarTela(() => import('./pages/Recorrentes'))
const Contas = carregarTela(() => import('./pages/Contas'))
const Cartoes = carregarTela(() => import('./pages/Cartoes'))
const Dividas = carregarTela(() => import('./pages/Dividas'))
const Investimentos = carregarTela(() => import('./pages/Investimentos'))
const Bens = carregarTela(() => import('./pages/Bens'))
const Categorias = carregarTela(() => import('./pages/Categorias'))
const Orcamentos = carregarTela(() => import('./pages/Orcamentos'))
const Relatorios = carregarTela(() => import('./pages/Relatorios'))
const Familia = carregarTela(() => import('./pages/Familia'))
const Exportar = carregarTela(() => import('./pages/Exportar'))
const Cadastro = carregarTela(() => import('./pages/auth/Cadastro'))
const RecuperarSenha = carregarTela(() => import('./pages/auth/RecuperarSenha'))
const NovaSenha = carregarTela(() => import('./pages/auth/NovaSenha'))
const Convite = carregarTela(() => import('./pages/Convite'))

export default function App() {
  // Ao ocultar/mostrar valores o App re-renderiza e, com ele, todas as telas (que recebem elementos novos).
  useValoresOcultos()
  return (
    <Suspense fallback={<p role="status" className="p-4 text-sm text-slate-500">Carregando…</p>}>
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
          <Route path="contas" element={<Contas />} />
          {/* #203: lista, página do cartão e página da fatura (o mesmo componente escolhe pelo endereço) */}
          <Route path="cartoes" element={<Cartoes />} />
          <Route path="cartoes/:id" element={<Cartoes />} />
          <Route path="cartoes/:id/fatura/:mes" element={<Cartoes />} />
          <Route path="dividas" element={<Dividas />} />
          <Route path="investimentos" element={<Investimentos />} />
          <Route path="bens" element={<Bens />} />
          <Route path="categorias" element={<Categorias />} />
          <Route path="orcamentos" element={<Orcamentos />} />
          <Route path="relatorios" element={<Relatorios />} />
          <Route path="exportar" element={<Exportar />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  )
}
