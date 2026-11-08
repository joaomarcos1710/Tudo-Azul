# Ideia 08 — Versionamento SemVer (v MAJOR.MINOR.PATCH)

**Status:** ideia, **decisão do dono**: contradiz a regra atual documentada. **Origem:** pedido do dono, com um prompt que propõe trocar o formato `ano.número-da-PR` por SemVer.

## O que já existe (e está documentado)
- **Formato atual** `AAAA.N.0`, onde `N` é o número da PR (`docs/VERSOES.md`, `CLAUDE.md`, `src/lib/versao.ts`). Cada PR tem uma linha em `VERSOES.md`.
- **Rodapé de versão** (`src/components/layout/Versao.tsx`): "Versão 2026.N" em todas as telas. Na tela Família mostra também o commit, lido de `VERCEL_GIT_COMMIT_SHA` no `vite.config.ts`.
- **Hash do commit**: já existe, mas **visível direto**, não em tooltip no hover. Um tooltip em texto pequeno não aparece no celular.

## O que a ideia propõe
- Trocar o formato para `v MAJOR.MINOR.PATCH`: MAJOR para mudanças disruptivas, MINOR para funcionalidade nova, PATCH para correção.
- Começar em `1.0.0`.
- Tooltip com hash e data do deploy ao passar o mouse.
- Ler a versão de `package.json` numa constante única.

## Minha crítica, antes de decidir
1. **O formato atual já responde a "o que mudou?"**: o número leva direto à PR, e a PR tem a descrição. SemVer exige decidir MAJOR, MINOR ou PATCH em cada PR, o que é julgamento e pode ser feito errado. Com um app de uso familiar, a utilidade para o usuário final é baixa.
2. **Ganho real é a rastreabilidade**, e ela já existe pela PR. Se o objetivo é comunicar mudança ao usuário, o caminho é o registro de mudanças (changelog) em linguagem de usuário, não o número.
3. **`process.env.npm_package_version` não funciona no navegador.** Esse valor só existe quando o npm roda um script. No Vite, a forma certa é `define` no `vite.config.ts`, que é o que o projeto já faz.
4. **Hover não funciona no celular.** Como o tooltip não aparece no toque, a informação não chega ao usuário mobile.
5. **Mudança de regra é decisão do dono.** A regra está escrita em `CLAUDE.md` e `docs/VERSOES.md`. Trocar exige atualizar esses dois, o doc 03 e os testes que leem a versão. Não é uma mudança de código isolada.
6. **Reiniciar em 1.0.0 apaga a sequência.** Quem olha `2026.221` hoje perde a referência à PR. Se for adotado, guardar a tabela antiga como histórico.

## Alternativa que eu recomendaria
Manter `AAAA.N.0` para rastreio e acrescentar, se o dono quiser comunicar mudanças, uma linha curta por versão em linguagem de usuário, visível em uma tela de "Novidades". Isso atende o objetivo do pedido sem trocar o formato.

## Pontos a decidir
- Trocar o formato, ou manter e acrescentar "Novidades"?
- Se trocar: qual versão base, e o que acontece com o histórico `AAAA.N`?

## Fora do escopo desta ideia
Mudar o processo de PR, merge ou deploy.

## Critério de pronto (quando virar PR)
- Decisão do dono registrada no doc 30.
- `CLAUDE.md`, `docs/VERSOES.md` e doc 03 atualizados juntos.
- Teste que lê a versão a partir de uma fonte única.
