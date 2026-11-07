# Preferências e exclusão segura de conta

**Versão:** 2026.213  
**PR:** #213

## Preferências individuais

A tabela `public.user_preferences` guarda as escolhas por usuário, com RLS:
- `ordem_lancamentos`: ascendente ou descendente; aplicada em Lançamentos.
- `periodo_padrao`: diário, semanal ou mensal; aplicada na abertura de Relatórios.
- `saldo_diario`: controla a exibição dos saldos de fechamento em Lançamentos.

A consulta `public.account_balances_daily` usa `public.account_balances` como fonte oficial, agrupa por data e moeda e não converte nem soma moedas diferentes.

## Começar do zero

A RPC `public.clear_household_transactions` exige sessão autenticada, papel de titular e a confirmação textual `excluir transações`. Ela apaga as linhas de `public.transactions` da família, inclusive planejadas e na lixeira.

A operação preserva contas, categorias, cartões, contratos e pagamentos de dívidas, recorrências, operações de investimento e bens. Proventos vinculados a lançamentos são removidos pela FK existente com `ON DELETE CASCADE`. A ação não apaga cadastros nem histórico de pagamentos de dívidas.

## Excluir conta sem apagar a família

A Edge Function `delete-account` valida o JWT com Supabase Auth e usa a chave administrativa somente no servidor.

Antes da exclusão:
1. A rotina bloqueia a operação se o usuário ainda possuir objetos no Storage.
2. Se o usuário for membro, remove somente o próprio perfil e vínculo.
3. Se for titular, exige exatamente um outro membro e transfere a titularidade para ele dentro de uma transação.
4. Revoga sessões globais e solicita a exclusão do usuário no Auth.

As referências históricas de autoria em bens e investimentos usam `ON DELETE SET NULL`, preservando registros e valores. Preferências e configurações pessoais são removidas com a conta.

Se a revogação de sessões falhar, a transferência é revertida. Se a resposta da API Auth durante a exclusão for ambígua, a titularidade permanece com o sucessor para evitar deixar a família sem titular; o usuário pode verificar o acesso e repetir a solicitação, se ainda existir.

## Aplicação em produção

Esta PR não aplica migrations no projeto hospedado nem publica a Edge Function. Depois da revisão e do merge, a sequência autorizada deve ser:
1. Aplicar a migration `20261107190000_user_preferences_account_exit.sql` no Supabase.
2. Publicar a Edge Function `delete-account` com `verify_jwt = true`.
3. Confirmar os secrets automáticos do Supabase e, se definido, configurar `APP_ORIGIN`.
4. Testar com uma família descartável antes de liberar a funcionalidade aos usuários.

Nenhuma exclusão real deve ser usada como teste.
