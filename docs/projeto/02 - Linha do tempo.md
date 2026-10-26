---
tags: [tudo-azul, historico]
---
# Linha do tempo — passo a passo

> Fonte: histórico do `main` no GitHub (cada item é um PR mergeado). Datas em que entrou no `main`.

## Fase 0 · 13/10 — a base
- Estrutura da aplicação e **design system** (layout responsivo, componentes, formatadores pt-BR).
- **CI** no GitHub (Node 22, typecheck, testes e build).
- Referências visuais (telas de exemplo com dados fictícios).
- **Supabase**: o app só aceita a *publishable key*; chave secreta (`sb_secret_`) é recusada no navegador, com teste.

## Fase 1 · 16/10 — telas básicas e o modelo de dados
- Proposta de **modelo de dados e segurança** (PR #6) · dinheiro em **centavos inteiros** (PR #15).
- Telas: **acesso** (entrar, criar conta, recuperar senha — #16) · **Família** (criar, convidar por link, aceitar — #18) · **Contas** (#19) · **Categorias** (#20) · **Lançamentos** (#21) · **Visão geral** (#22) · **exportação CSV** do mês e backup (#23).
- CI roda em todo PR (#13) · botão manual para aplicar migrations no Supabase (#17).
- **Cartão**: ciclo, compra parcelada e cobrança automática (#26, migration 004) · tela de Cartões e relatórios da fatura (#27, migration 005).

## Fase 2 · 23–24/10 — cartão completo, recorrentes, conferência
- Excluir compra, reabrir fatura, editar parcela (#29 banco, #30 front).
- **Recorrentes**: contas mensais e assinaturas no cartão (#28, migration 006).
- **Conciliação** com o extrato (#33, migration 007) — trava o período conferido.
- **Logo** (#32) · **PWA**, app instalável no celular (#34).
- **Exportação completa** em 5 arquivos para conferir saldos fora do app (#36).
- **Visão geral v2**: gráficos por categoria e acumulado, KPIs com comparação (#35, migration 008).
- Extrato mostra pagamento de fatura (#37) · agentes do projeto e pesquisa de ideias (#31).

## Fase 3 · 25/10 — testes de uso e refinamentos
- **Zerar tudo** para começar do zero, só o dono, frase conferida no banco (#38, migration 009).
- **Pagamento adiantado** de fatura vira crédito no cartão (#39, migration 010).
- **Marcar pago** pede a data e o valor reais, para o saldo bater com o extrato (#41).
- **Tela única de lançamento**: escolhe conta ou cartão; compras no cartão entram na lista do mês (#42).
- **Anular** pagamento ou devolução na tela do cartão (#43).
- **Limite disponível do cartão** e **renda regular × eventual** (#44, migrations 011 e 012).
- Parcelas do cartão **uma por mês** na lista + comparação com o ano passado (#45).
- **Orçamentos** (tela de verdade) e **projeção do mês** (#46, migration 013).

## Fase 4 · 26/10 — auditoria, dependências, painel, menu
- **Dois agentes** auditaram o banco e os valores ([[Auditorias/2026-10-26 Auditoria]]).
- **Migration 014** corrige o bug de valor e furos de integridade (#51) — aplicada em produção.
- **Recorrências preservam correções manuais**: PR #59, migration 015; merge na `main` no commit `5ad36f1`.
- **Migration 015 aplicada em produção** em 26/10/2026, comprovada pela [execução 20 do workflow](https://github.com/joaomarcos1710/Tudo-Azul/actions/runs/40397169580), a partir do commit de merge `5ad36f1`.
- **Abrir no Início**, não na Família + **versão 2026.1** (#52) · **filtros de Lançamentos** (#53).
- Dependências: **Vite 8, Vitest 5, plugin React 6** (#47) · política de dependências e exceção do Tailwind 3 (#49).
- **Painel**: ações rápidas, vencidos, resumo dos cartões e conferência de saldo (#48).
- **Robustez do front**: respostas velhas, envio duplicado, pagar fatura e PWA (#50).
- **Menu em grupos**, "Mais" no celular e **ocultar valores** (#54).
- **Diário do projeto** (`docs/projeto/`) e regra de mantê-lo atualizado (`CLAUDE.md`).

## Ainda abertos (rascunhos, não mergeados)
#40 pesquisa de ideias (rodada 2) · #10 proposta de multimoeda · #9 preparação da importação do Organizze.
