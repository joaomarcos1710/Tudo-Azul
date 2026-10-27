# Dependências e vulnerabilidades conhecidas

Última revisão: 25/10/2026 (`npm audit` no `main`).

## Regra
- **Dependências de produção** (o que vai para o app dos usuários): zero vulnerabilidades toleradas. O CI roda
  `npm audit --omit=dev --audit-level=low` em todo PR e barra se aparecer alguma.
- **Ferramentas de desenvolvimento** (build, testes, estilos): corrigidas em PRs próprios, separados das
  funcionalidades, para não misturar atualização de ferramenta com mudança do app.
- Nunca usar `npm audit fix --force`: as correções envolvem versões maiores e podem quebrar o build sem aviso.

## Exceção registrada: Tailwind 3 (3 vulnerabilidades moderadas, só de desenvolvimento)

| Pacote | Problema | Por que não é urgente |
|---|---|---|
| `postcss-selector-parser` (< 7.1.6) | consumo excessivo de CPU ao processar seletores (complexidade quadrática) | roda só durante o build, sobre os seletores do nosso próprio código; não recebe entrada de terceiros |
| `postcss-nested` (via Tailwind 3) | depende do pacote acima | idem |
| `tailwindcss` (3.x) | depende dos dois acima | idem |

**Não há correção sem migrar para o Tailwind 4** (confirmado pelo `npm audit`). `npm audit --omit=dev` continua em zero:
nada disso chega ao app dos usuários.

### Quando fazer a migração
Em um PR dedicado, com revisão visual antes e depois (dashboard, cartões, lançamentos, orçamentos, navegação no celular).
O Tailwind 4 renomeia utilitários (`rounded`, `shadow`, `ring`), muda a cor padrão de borda e passa a configuração para CSS
(`@theme`); o projeto tem 551 usos de `className` e um tema próprio (`tailwind.config.js`: cores `marinho`, `celeste`,
`azul`, `planejado`, `pago`, raio `card`, sombra `card`). A ferramenta oficial `npx @tailwindcss/upgrade` automatiza boa parte,
mas o resultado precisa ser conferido tela a tela.

Reavaliar esta exceção: ao fazer a migração, se aparecer vulnerabilidade **alta ou crítica** no Tailwind/PostCSS, ou
se o `npm audit --omit=dev` deixar de ficar em zero.

## Histórico
- 25/10/2026: Vite 5 → 8, Vitest 2 → 5 e `@vitejs/plugin-react` 4 → 6 (PR #47) corrigiram 6 das 9 vulnerabilidades
  (2 críticas, 1 alta, 3 moderadas). Versões de produção não mudaram.
