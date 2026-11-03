import { lazy } from 'react'
import type { ComponentType } from 'react'

const CHAVE = 'tudo-azul:recarregou-por-tela-antiga'

/**
 * Importa o arquivo de uma tela. Depois de um deploy, os arquivos antigos deixam de existir: quem estava
 * com o app aberto pediria um arquivo que sumiu. Nesse caso a página recarrega UMA vez (pega o index.html
 * novo, com os nomes novos). Se falhar de novo logo depois, o erro aparece em vez de recarregar sem fim.
 */
export function importarComRecarga<M>(importar: () => Promise<M>, recarregar: () => void = () => window.location.reload()): Promise<M> {
  return importar().then(
    (m) => { try { sessionStorage.removeItem(CHAVE) } catch { /* sem sessionStorage: segue */ } return m },
    (erro: unknown) => {
      let jaRecarregou = false
      try { jaRecarregou = sessionStorage.getItem(CHAVE) === '1'; sessionStorage.setItem(CHAVE, '1') } catch { /* segue */ }
      if (!jaRecarregou) { recarregar(); return new Promise<M>(() => undefined) }
      throw erro
    },
  )
}

/** Tela carregada sob demanda: cada página vira um arquivo JS próprio e o celular baixa só o que abre. */
// any: é a mesma restrição de tipo do React.lazy
export function carregarTela<T extends ComponentType<any>>(importar: () => Promise<{ default: T }>) {
  return lazy(() => importarComRecarga(importar))
}
