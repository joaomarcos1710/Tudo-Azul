-- Tudo Azul — migration 021: renomear cartão e dizer o que impede a exclusão
--
-- Pedido do dono (30/10/2026), depois de testar a 020:
--   1. não havia como corrigir o nome de um cartão digitado errado (debts não aceita escrita direta);
--   2. "Excluir" recusava um cartão que o dono achava sem movimento, e a mensagem não dizia o que existia.
--
-- O que esta migration acrescenta (nada é alterado nem apagado nas migrations anteriores):
--   debt_rename(p_id, p_name)  muda só o nome (1 a 60 caracteres depois de aparar). Nome repetido na família: 23505,
--                              como no cadastro. Vale para cartão, empréstimo e financiamento.
--   debt_delete / account_delete (create or replace, mesmas regras da 020): a recusa agora conta o que existe, por exemplo
--                              "tem histórico (2 parcelas, 3 movimentos): só é possível arquivar".
--
-- Códigos de erro: 42501 registro de outra família ou inexistente; 22023 nome vazio ou com mais de 60 caracteres;
-- 23505 nome já usado; 23503 tem histórico.

create function public.debt_rename(p_id uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.debts%rowtype;
begin
  v := private.debt_lock(p_id);
  if p_name is null or char_length(btrim(p_name)) not between 1 and 60 then
    raise exception 'nome inválido: use de 1 a 60 caracteres' using errcode = '22023';
  end if;
  update public.debts set name = btrim(p_name) where id = v.id;
end $$;

create or replace function public.debt_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.debts%rowtype; n_inv integer; n_ins integer; n_ev integer; n_rec integer; v_partes text[] := '{}';
begin
  v := private.debt_lock(p_id);
  select count(*) into n_inv from public.debt_invoices where debt_id = v.id;
  select count(*) into n_ins from public.debt_installments where debt_id = v.id;
  select count(*) into n_ev from public.debt_events where debt_id = v.id;
  select count(*) into n_rec from public.recurrences where debt_id = v.id;
  if n_inv + n_ins + n_ev + n_rec > 0 then
    if n_inv > 0 then v_partes := v_partes || (n_inv || case when n_inv = 1 then ' fatura' else ' faturas' end); end if;
    if n_ins > 0 then v_partes := v_partes || (n_ins || case when n_ins = 1 then ' parcela' else ' parcelas' end); end if;
    if n_ev > 0 then v_partes := v_partes || (n_ev || case when n_ev = 1 then ' movimento' else ' movimentos' end); end if;
    if n_rec > 0 then v_partes := v_partes || (n_rec || case when n_rec = 1 then ' recorrente' else ' recorrentes' end); end if;
    raise exception 'tem histórico (%): só é possível arquivar', array_to_string(v_partes, ', ') using errcode = '23503';
  end if;
  delete from public.debts where id = v.id;
end $$;

create or replace function public.account_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.accounts%rowtype; n_tx integer; n_ev integer; n_rec integer; n_conf integer; v_partes text[] := '{}';
begin
  if (select auth.uid()) is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  select * into v from public.accounts where id = p_id and household_id = private.current_household() for update;
  if not found then
    raise exception 'registro não encontrado' using errcode = '42501';
  end if;
  select count(*) into n_tx from public.transactions t where t.account_id = v.id or t.destination_account_id = v.id;
  select count(*) into n_ev from public.debt_events e where e.account_id = v.id;
  select count(*) into n_rec from public.recurrences r where r.account_id = v.id or r.destination_account_id = v.id;
  select count(*) into n_conf from public.account_reconciliations c where c.account_id = v.id;
  if n_tx + n_ev + n_rec + n_conf > 0 then
    if n_tx > 0 then v_partes := v_partes || (n_tx || case when n_tx = 1 then ' lançamento' else ' lançamentos' end); end if;
    if n_ev > 0 then v_partes := v_partes || (n_ev || case when n_ev = 1 then ' pagamento de dívida' else ' pagamentos de dívida' end); end if;
    if n_rec > 0 then v_partes := v_partes || (n_rec || case when n_rec = 1 then ' recorrente' else ' recorrentes' end); end if;
    if n_conf > 0 then v_partes := v_partes || (n_conf || case when n_conf = 1 then ' conferência' else ' conferências' end); end if;
    raise exception 'tem histórico (%): só é possível arquivar', array_to_string(v_partes, ', ') using errcode = '23503';
  end if;
  delete from public.accounts where id = v.id;
end $$;

revoke execute on function public.debt_rename(uuid, text) from public, anon;
grant execute on function public.debt_rename(uuid, text) to authenticated;
