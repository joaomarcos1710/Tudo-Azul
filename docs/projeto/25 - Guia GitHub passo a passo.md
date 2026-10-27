---
tags: [tudo-azul, github, guia]
---
# Guia de GitHub — o que cada coisa é (com o que fizemos)

| Termo | Em palavras simples | Exemplo no projeto |
|---|---|---|
| **Repositório** | A pasta do projeto no GitHub, com todo o histórico | `joaomarcos1710/Tudo-Azul` (privado) |
| **Branch** | Uma cópia paralela para mexer sem estragar o principal | `claude/menu-em-grupos` |
| **Commit** | Um "salvamento" com mensagem do que mudou | "feat(menu): grupos no menu…" |
| **Push** | Enviar os commits para o GitHub | feito a cada PR |
| **Pull request (PR)** | Pedido para juntar a branch no `main`, com revisão e testes | #54 |
| **Rascunho (draft)** | PR ainda não pronto para juntar | todos nascem assim |
| **CI** | Robô que roda os testes em todo PR | "Typecheck, tests e build" |
| **Merge** | Juntar a branch no `main` | só com o seu "pode" |
| **Deploy** | Publicar no ar | Vercel, automático após o merge |
| **Migration** | Mudança no banco, em arquivo, numerada | 001 a 014 |
| **Workflow** | Roteiro automático que você aciona por botão | aplicar migrations |

## O caminho de uma mudança
1. Ideia ou pedido → 2. branch nova → 3. código + testes → 4. commit e push → 5. PR em rascunho → 6. CI verde + preview da Vercel → 7. você testa → 8. "pode mergear" → 9. merge → 10. deploy → 11. (se houver migration) simular → ler → aplicar.
