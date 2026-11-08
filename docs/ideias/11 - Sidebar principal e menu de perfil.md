# Ideia 11 — Sidebar principal enxuta e menu de perfil no rodapé

**Status:** em grande parte já implementado (PR #215, no `main`). **Origem:** pedido do dono, com referência ao rodapé de perfil do Gemini. Chamado "10" na mensagem; em `docs/ideias` o número 10 já é o modal de exclusão, então esta nota é a 11.

## Já implementado (no `main`)
- **Acesso rápido na sidebar** (`src/components/layout/navegacao.ts`, `itensAcessoRapido`): Início, Lançamentos, Cartões, Orçamentos, Investimentos, Análises, Relatórios e Calendário. Sem cabeçalhos de seção.
- **Bloco de perfil no rodapé** (`PerfilSidebar`, em `AppShell.tsx`): avatar (foto do login, ou iniciais se não houver), nome, linha de plano e botão com aria-label.
- **Popover** ao clicar no bloco, com as três seções pedidas: **Gestão** (Contas, Categorias, Recorrentes), **Patrimônio & Conta** (Bens, Dívidas, Família) e **Sistema** (Exportar dados e Sair).
- **Versão** no rodapé do popover, lida do `package.json`, no formato do projeto.

## Diferenças entre o pedido e o app
1. **"Plano: Pro" não existe.** O app não tem cobrança. Hoje a linha mostra "Conta familiar" quando não há plano no login. Não mostrar "Pro": seria informação falsa para quem usa.
2. **A versão do pedido ("2026.24.1") está desatualizada.** O formato atual é `AAAA.N.0` (ver `docs/VERSOES.md`), e o número muda a cada PR. A nota e a tela leem a versão do projeto, não um texto fixo.
3. **"Sair" aparece duas vezes?** Confirmar: o pedido pede remover o "Sair" do rodapé da sidebar e deixá-lo no popover. Pelo código, ele está só no popover, no desktop. Conferir no navegador antes de mexer.
4. **Análises e Relatórios.** O pedido admite juntar os dois. Eu manteria separados: são telas com funções diferentes (análise do mês e relatório por período). Juntar esconde uma das duas.
5. **Espaçamento.** Com oito itens, o padding entre links já foi recalculado na #215. Conferir em tela real antes de mudar.
6. **Avatar.** Só aparece se o login tiver foto. Sem foto, as iniciais. Se o dono quiser foto própria, é um campo novo no perfil (com envio e Storage), não só CSS.

## Pontos a decidir
- Juntar Análises e Relatórios em uma tela com abas, ou manter separados?
- Mostrar o plano só quando existir cobrança, ou esconder a linha de plano?

## Fora do escopo desta ideia
Criar cobrança, planos ou o item "Plano" da tela de Preferências (ideia 09).

## Critério de pronto (quando virar PR)
- Teste de que o popover tem as três seções e de que "Sair" está só no popover.
- Conferência em tela real no desktop e no celular.
- Doc 10 (telas) atualizado se a navegação mudar.
