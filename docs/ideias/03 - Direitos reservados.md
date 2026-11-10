# Ideia 03 — Direitos reservados (aviso de copyright)

**Status:** implementada (09/11/2026; PR #243). Ano automático pela data de São Paulo; cor igual à da linha de versão, porque as duas telas têm fundo marinho. **Origem:** pedido do dono.

## O que pediu
Uma assinatura discreta e profissional de autoria, em dois lugares:

1. **Menu de configurações (popover)**: no rodapé, logo abaixo do botão "Sair", em texto pequeno, na cor de texto secundária (`text-muted`, na prática `neutro`/`slate-500`):
   - © 2026 Tudo Azul.
   - Todos os direitos reservados a João Marcos.
2. **Tela de login**: o mesmo aviso, centralizado no rodapé da página de autenticação.

## Pontos a conferir antes de implementar
1. **Texto único.** Guardar as duas linhas em uma constante só (ex.: `src/lib/aviso.ts`), para que as duas telas não divirjam.
2. **Ano fixo ou automático.** "2026" fixo fica errado em 2027. Sugestão: calcular o ano a partir da data, ou manter fixo e atualizar a cada virada de ano (decidir com o dono).
3. **Contraste.** Texto pequeno em cinza precisa passar 4,5:1 no fundo branco e no `bg-fundo`, como o `cores.test.ts` já exige para os tokens.
4. **Não é proteção de verdade.** Um aviso visual não impede cópia. Ele só declara a autoria. Se a intenção for proteção legal, o registro é outra decisão.

## Critério de pronto (quando virar PR)
- Aviso nas duas telas, com a mesma constante.
- Teste de contraste do texto usado.
- Doc 10 (telas) atualizado, porque login e popover mudam.
