-- Tudo Azul — migration 003: parcelas só em cartão
--
-- Problema (encontrado na revisão de 14/10/2026): create_debt_installments aceitava parcelas em
-- qualquer dívida. Num empréstimo ou financiamento o principal já entra INTEIRO na dívida pelo
-- desembolso (debt_loan_event 'disbursement') ou pelo saldo de referência; parcelas por cima disso
-- contavam o principal duas vezes:
--   * planned_commitments passava a mostrar o principal de novo como compromisso futuro;
--   * debt_bill de uma dessas parcelas lançava 'charge', somando o valor à dívida pela segunda vez
--     e registrando o principal como despesa (patrimônio errado no valor de cada parcela cobrada).
-- Reproduzido localmente: desembolso de 10.000 + 10 parcelas de 1.000 + 1 cobrança
--   => dívida 11.000, compromissos 9.000, patrimônio −1.000 (o correto é dívida 10.000, patrimônio 0).
--
-- Regra: parcela (debt_installments) é o compromisso futuro de uma COMPRA PARCELADA NO CARTÃO.
-- Empréstimo e financiamento não têm parcelas no banco: o saldo devedor já está na dívida e é pago
-- com debt_pay (e juros/tarifas com debt_loan_event).
--
-- Defesa em duas camadas, sem alterar migrations anteriores:
--   1. create_debt_installments recusa dívida que não seja 'card' (erro claro, antes de gravar).
--   2. trigger BEFORE INSERT em debt_installments recusa o mesmo em QUALQUER caminho de escrita
--      (outra função futura, service_role, superusuário). A troca de tipo de uma dívida já é
--      impedida por debts_immutable (migration 002), então uma parcela válida não vira inválida.
--
-- Códigos de erro: 23514 regra de integridade (como na migration 002).

-- ---------------------------------------------------------------------------
-- 0. Dados existentes: aborta se já houver parcelas fora de cartão (exigiria correção manual,
--    com anulação auditada; esta migration não apaga nem altera nenhum registro).
--    O LOCK fecha a janela entre esta verificação e a criação do trigger: sem ele, uma parcela
--    gravada por outra sessão nesse intervalo passaria sem ser vista (reproduzido na revisão).
--    SHARE ROW EXCLUSIVE conflita com o ROW EXCLUSIVE dos INSERTs, então inserções concorrentes
--    esperam o fim da migration e, ao continuar, já encontram o trigger. Fica dentro do DO porque
--    LOCK solto exige bloco de transação; a garantia vale quando a migration roda numa transação
--    única (supabase db push, ou psql --single-transaction), e é liberado no COMMIT.
-- ---------------------------------------------------------------------------
do $$
declare v_n bigint;
begin
  lock table public.debt_installments in share row exclusive mode;
  select count(*) into v_n
    from public.debt_installments i
    join public.debts d on d.household_id = i.household_id and d.id = i.debt_id
   where d.kind <> 'card';
  if v_n > 0 then
    raise exception 'migration 003 abortada: % parcela(s) em dívida que não é cartão; corrija antes de aplicar', v_n
      using errcode = '23514';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Trigger: nenhuma parcela fora de cartão, venha de onde vier
-- ---------------------------------------------------------------------------
create function private.debt_installments_card_only() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v_kind text;
begin
  select d.kind into v_kind from public.debts d
   where d.household_id = new.household_id and d.id = new.debt_id;
  -- dívida inexistente: a FK composta (deferrable) recusa; aqui só a regra de tipo
  if v_kind is not null and v_kind <> 'card' then
    raise exception 'parcelas só existem em cartão; empréstimo e financiamento entram inteiros na dívida (pague com debt_pay)'
      using errcode = '23514';
  end if;
  return new;
end $$;

create trigger debt_installments_card_only before insert on public.debt_installments
  for each row execute function private.debt_installments_card_only();

revoke execute on function private.debt_installments_card_only() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. RPC: a mesma regra com erro imediato e antes de qualquer gravação.
--    Mesma assinatura e corpo da migration 002, mais a verificação de tipo; mantém dono e grants.
-- ---------------------------------------------------------------------------
create or replace function public.create_debt_installments(p_debt uuid, p_plan text, p_first_due date, p_count integer,
                                                           p_amount numeric, p_category uuid, p_first_seq integer default 1)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_d public.debts%rowtype; k integer;
begin
  v_d := private.debt_lock(p_debt);
  if v_d.kind <> 'card' then
    raise exception 'parcelas só existem em cartão; empréstimo e financiamento entram inteiros na dívida (pague com debt_pay)'
      using errcode = '23514';
  end if;
  if p_count is null or p_count not between 1 and 120 or p_first_seq is null or p_first_seq < 1 then
    raise exception 'parâmetros inválidos' using errcode = '22023';
  end if;
  for k in 0 .. p_count - 1 loop
    insert into public.debt_installments (household_id, debt_id, plan, seq, due_date, face, category_id)
    values (v_d.household_id, v_d.id, btrim(p_plan), p_first_seq + k,
            (p_first_due + make_interval(months => k))::date, p_amount, p_category);
  end loop;
  perform private.debt_chk(v_d.id);
  return p_count;
end $$;
