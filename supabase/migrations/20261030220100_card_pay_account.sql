-- Tudo Azul — migration 024: conta de pagamento padrão do cartão
--
-- Pedido do dono (30/10/2026), comparando com o Organizze e o Mobills (os dois pedem a conta que paga a fatura no cadastro) e
-- para o saldo projetado: sem saber qual conta paga cada cartão, o saldo POR CONTA não consegue descontar a fatura que vence.
--
-- O que esta migration acrescenta (nada é alterado nem apagado nas migrations anteriores):
--   1. debts.pay_account_id: a conta que paga a fatura do cartão. Opcional (cartões existentes ficam sem), só em cartão,
--      sempre uma conta da mesma família (FK composta com household_id).
--   2. set_card_pay_account(p_debt, p_account): define, muda ou limpa (null) a conta. Recusa conta de outra família ou
--      inexistente (42501, a mesma resposta para os dois casos), conta arquivada (23514) e dívida que não é cartão (23514).
--   3. account_delete (create or replace, mesmas regras da 020/021): passa a contar os cartões que usam a conta como pagadora;
--      conta ligada a cartão não é excluída, só arquivada.
--
-- É só uma sugestão de pagamento e a base do saldo projetado: nenhum valor de dívida, fatura ou saldo muda.

alter table public.debts
  add column pay_account_id uuid,
  add constraint debts_pay_account_fk foreign key (household_id, pay_account_id)
    references public.accounts (household_id, id) deferrable initially immediate,
  add constraint debts_pay_account_card_only check (pay_account_id is null or kind = 'card');

create function public.set_card_pay_account(p_debt uuid, p_account uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype; v_a public.accounts%rowtype;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'conta de pagamento só existe em cartão' using errcode = '23514';
  end if;
  if p_account is not null then
    select * into v_a from public.accounts where id = p_account and household_id = v_d.household_id;
    if not found then
      raise exception 'registro não encontrado' using errcode = '42501';
    end if;
    if not v_a.active then
      raise exception 'conta arquivada não pode pagar o cartão' using errcode = '23514';
    end if;
  end if;
  update public.debts set pay_account_id = p_account where id = v_d.id;
end $$;

create or replace function public.account_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.accounts%rowtype; n_tx integer; n_ev integer; n_rec integer; n_conf integer; n_card integer; v_partes text[] := '{}';
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
  select count(*) into n_card from public.debts d where d.pay_account_id = v.id;
  if n_tx + n_ev + n_rec + n_conf + n_card > 0 then
    if n_tx > 0 then v_partes := v_partes || (n_tx || case when n_tx = 1 then ' lançamento' else ' lançamentos' end); end if;
    if n_ev > 0 then v_partes := v_partes || (n_ev || case when n_ev = 1 then ' pagamento de dívida' else ' pagamentos de dívida' end); end if;
    if n_rec > 0 then v_partes := v_partes || (n_rec || case when n_rec = 1 then ' recorrente' else ' recorrentes' end); end if;
    if n_conf > 0 then v_partes := v_partes || (n_conf || case when n_conf = 1 then ' conferência' else ' conferências' end); end if;
    if n_card > 0 then v_partes := v_partes || (n_card || case when n_card = 1 then ' cartão que usa a conta' else ' cartões que usam a conta' end); end if;
    raise exception 'tem histórico (%): só é possível arquivar', array_to_string(v_partes, ', ') using errcode = '23503';
  end if;
  delete from public.accounts where id = v.id;
end $$;

revoke execute on function public.set_card_pay_account(uuid, uuid) from public, anon;
grant execute on function public.set_card_pay_account(uuid, uuid) to authenticated;
