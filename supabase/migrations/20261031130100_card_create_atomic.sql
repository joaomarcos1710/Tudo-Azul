-- Tudo Azul — migration 026: cadastro de cartão atômico
--
-- O cadastro do cartão precisa gravar a dívida, o ciclo, a identidade e a conta pagadora
-- como uma única operação. Antes, o front chamava create_debt e depois até três RPCs
-- independentes; uma falha posterior deixava um cartão incompleto no banco.
--
-- Depende da migration 024 (set_card_pay_account). Todas as validações continuam nas
-- funções já auditadas; esta RPC apenas as coordena na mesma transação PostgreSQL.

create function public.create_card(
  p_name text,
  p_reference_date date,
  p_reference_balance numeric,
  p_closing_day integer,
  p_due_day integer,
  p_issuer text default null,
  p_brand text default null,
  p_pay_account uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null or private.current_household() is null then
    raise exception 'não autenticado ou sem família' using errcode = '42501';
  end if;

  v_id := public.create_debt(p_name, 'card', p_reference_date, p_reference_balance);
  perform public.set_card_cycle(v_id, p_closing_day, p_due_day);
  perform public.set_card_identity(v_id, p_issuer, p_brand);
  perform public.set_card_pay_account(v_id, p_pay_account);
  return v_id;
end $$;

revoke execute on function public.create_card(text, date, numeric, integer, integer, text, text, uuid) from public, anon;
grant execute on function public.create_card(text, date, numeric, integer, integer, text, text, uuid) to authenticated;
