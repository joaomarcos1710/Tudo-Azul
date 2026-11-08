# Ideia 09 — Tela de Preferências

**Status:** ideia, não implementada. **Origem:** pedido do dono, com uma imagem de referência (estilo de configurações com menu lateral, seções e zona de perigo).

## O que já existe
- **"Zerar tudo"** (`src/components/ZerarTudo.tsx`): só para o dono, com prévia, exportação e frase digitada. Já é a ação de "começar do zero". A ideia pede o mesmo.
- **Exclusão de conta bancária** dentro de Contas (`src/pages/Contas.tsx`, bloco "Excluir conta"). É outra coisa: apaga uma conta do banco, não o usuário.
- **Aviso diário** (`AvisoDiario.tsx`): existe, mas é outra função. Não é a configuração de "saldo diário" da referência.
- **Não encontrei** uma tela de Preferências, nem preferência salva de ordenação dos lançamentos, período padrão ou saldo diário. Vale confirmar antes de desenhar.
- **Não encontrei** no app: Plano, Alertas (como página), Atividades, Chaves de API e Apps conectados. Se a intenção é listar esses itens, cada um é uma funcionalidade inteira, não um ajuste de tela.

## O que a ideia pede
- Menu lateral de configurações: Categorias, Contas, Cartões de crédito, Preferências, Plano, Alertas, Atividades, Chaves de API, Apps conectados.
- Card com blocos separados por divisórias, cada um com título, descrição e controle à direita:
  - **Ordem dos lançamentos** (crescente ou decrescente, pela data).
  - **Período de navegação padrão** (diário, semanal ou mensal).
  - **Saldo diário** na lista de Lançamentos (sim ou não).
  - **Zona de perigo**: "Excluir minhas transações" (zerar) e "Excluir conta por completo".
- Botão "Salvar alterações".
- Ações destrutivas em cor de perigo, para evitar clique acidental.

## Pontos a decidir
1. **Preferências são por pessoa ou por família?** Ordem e período de navegação são gosto pessoal; salvar por família faria um membro mudar a tela do outro. Sugestão: por pessoa, com vínculo ao login (`household_members`).
2. **Onde guardar.** Hoje não há tabela de preferências. Preferências por pessoa exigem migration nova, com RLS, e teste de que um usuário só lê e grava a própria.
3. **Os seis itens extras** (Plano, Atividades, Chaves de API, Apps conectados) não existem. Chaves de API e Apps conectados exigem backend e segurança próprios. Sugiro não listar item que não funciona: cada um entra só quando existir.
4. **"Excluir conta" aparece com dois significados.** Na tela de Contas, apaga conta bancária. Aqui, apaga o usuário. Renomear um dos dois para não confundir (por exemplo, "Excluir conta bancária" e "Excluir minha conta").
5. **Dupla confirmação e frase digitada.** O "Zerar tudo" já usa frase digitada. Decidir um padrão único para ações destrutivas.
6. **Tamanho.** Separar em PRs: (a) tela com as três preferências e migration; (b) zona de perigo reaproveitando o "Zerar tudo"; (c) itens extras, um de cada vez, só quando existirem.

## Fora do escopo desta ideia
Mudar o cálculo de saldo, a ordem real de consulta ou o aviso diário.

## Critério de pronto (quando virar PR)
- Teste de isolamento: preferência de uma pessoa não aparece para outra.
- Ações destrutivas em cor de perigo, com confirmação.
- Doc 10 (telas) e doc 21 (banco) atualizados.
