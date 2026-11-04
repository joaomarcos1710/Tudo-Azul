-- Tudo Azul — migration 049: a service_role só passa em private.is_member durante a LEITURA do aviso diário.
-- Achado da auditoria de segurança (04/11/2026): a 047 fez is_member dizer "sim" para a service_role em TODA função,
-- inclusive nas que gravam e se autorizam só por is_member. Hoje quase todas também exigem auth.uid(), mas uma função
-- nova que esquecesse isso ficaria aberta à chave do servidor. Agora a exceção só vale com a marca
-- app.service_read = 'on', que só public.daily_digest_service liga, dentro da própria chamada (set_config local à
-- transação: some no fim da requisição). A service_role não tem outro jeito de ligar a marca: o PostgREST só expõe
-- funções do schema public, e set_config é do pg_catalog.

create or replace function private.is_member(p_household uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (coalesce((select auth.role()) = 'service_role', false)
          and coalesce(current_setting('app.service_read', true), '') = 'on')
      or coalesce((
           select true from public.household_members m
            where m.household_id = p_household and m.user_id = (select auth.uid())
         ), false)
$$;

-- O resumo do dia para a Edge Function: liga a marca só durante a leitura e confere que quem chama é o servidor.
create function public.daily_digest_service(p_household uuid, p_date date)
returns table (
  overdue_count integer, overdue_expense numeric, today_count integer, today_expense numeric,
  invoices_count integer, invoices_due numeric, next_invoice_date date, month_end date, projected_balance numeric
)
language plpgsql volatile security invoker set search_path = '' as $$
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'só o servidor' using errcode = '42501';
  end if;
  perform set_config('app.service_read', 'on', true);
  return query select * from public.daily_digest(p_household, p_date);
  perform set_config('app.service_read', 'off', true);
end $$;

revoke execute on function public.daily_digest_service(uuid, date) from public, anon, authenticated;
grant execute on function public.daily_digest_service(uuid, date) to service_role;
