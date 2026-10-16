import { Navigate, Outlet } from 'react-router-dom'
import { useFamilia } from '../../lib/FamiliaContext'
import { Aviso } from '../ui/Aviso'

/** Páginas com dados financeiros só abrem para quem já tem família; os demais vão criar ou aceitar uma. */
export function ExigeFamilia() {
  const { familia, carregando, erro } = useFamilia()
  if (carregando) return <p className="text-sm text-slate-600" role="status">Carregando…</p>
  if (erro) return <Aviso tipo="erro">Não foi possível carregar sua família. Verifique a conexão e recarregue a página.</Aviso>
  if (!familia) return <Navigate to="/familia" replace />
  return <Outlet />
}
