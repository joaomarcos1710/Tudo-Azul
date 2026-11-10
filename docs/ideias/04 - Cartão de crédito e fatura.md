# Ideia 04 — Cartão de crédito e fatura (inspirado no Organizze)

**Status:** ideia, em parte já em andamento. **Origem:** pedido do dono, com referência ao Organizze.

## Já existe ou está em andamento (não reinventar)
- **Fatura numa página só**: cada cartão e cada fatura têm a sua página (#203, no `main`).
- **Modo de foco, ações rápidas e impressão** na página da fatura: **PR #204, aberta**. Ela cobre a sidebar recolhível (com transição), o botão de imprimir, o botão de pagar e o "nova despesa / nova receita" vinculados ao cartão aberto.
- **Pagar fatura** e **Estornar** já existem.
- **Despesa fixa mensal** existe como recorrência; a tag na linha precisa ser conferida.

## O que a ideia pede e ainda não existe
1. **Extrato agrupado por dia**, com cada dia separado visualmente.
2. **Categorias da fatura**: um botão "Categorias" no cabeçalho, com gráfico de rosca e lista por categoria, só dessa fatura. **Atenção:** o total e os valores precisam vir do banco (regra do projeto: não somar no navegador).
3. **Painel de detalhes ao clicar no lançamento** (lateral ou modal), com:
   - tag "Despesa fixa mensal" quando for o caso;
   - edição completa de **categoria, valor, data e observações**;
   - botões **Excluir** e **Estornar/Reembolsar** no rodapé.
4. **Parcelas visíveis na descrição** ("2/3", "2/10"), para identificar compras divididas.
5. **Mover a compra entre faturas** pelo menu "⋯": "Enviar para a fatura anterior" e "Enviar para a próxima fatura".

## Pontos a decidir antes de implementar
1. **Edição completa exige regra no banco.** O doc 40 e a PR #204 dizem que só o valor da parcela pode ser editado com segurança. Categoria, data e descrição são imutáveis hoje. Editar esses campos é uma RPC nova com auditoria, com migration e teste que falha sem a correção.
2. **Mover entre faturas exige regra transacional.** Respeitar faturas pagas ou travadas, e parcelas já cobradas. Não fazer só na tela: o banco precisa recusar o que não pode.
3. **Mover é mudar o mês da compra.** Isso mexe em relatórios e no planejado. Confirmar com o dono o que acontece com o histórico de um mês já fechado.
4. **Categorias da fatura: definição de "gasto".** Estorno, reembolso e IOF entram no total? Escolher a regra antes de desenhar o gráfico.
5. **Mobile.** Painel lateral vira tela cheia no celular; decidir antes de desenhar.
6. **Tamanho.** São várias funções. Sugestão de ordem: (a) parcelas visíveis e agrupamento por dia, que são só apresentação; (b) categorias da fatura; (c) edição de campos, com migration; (d) mover entre faturas, com migration.

## Fora do escopo desta ideia
Mudar o cálculo da fatura, o fechamento e o vencimento.

## Critério de pronto (quando virar PR)
- Cada item como PR própria, com migration e teste quando mexer em dinheiro.
- Totais vindos do banco; nada somado no navegador.
- Doc 10 e doc 21 (banco) atualizados quando a tela e o banco mudarem.
