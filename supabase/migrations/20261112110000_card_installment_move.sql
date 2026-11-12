-- Tudo Azul — migration 111: mandar uma parcela de cartão para a fatura anterior ou para a próxima
--
-- Pedido do dono (11/11/2026, etapa 2 do "mudar a fatura", como no Organizze): em cada compra/parcela da fatura de um
-- cartão, "Enviar para a fatura anterior" e "Enviar para a próxima fatura". Decisões do dono (ver 30 - Decisões):
--   • parcela POR PARCELA (uma de cada vez; a compra inteira não anda junto);
--   • só parcela AINDA NÃO COBRADA muda (sem cobrança nem estorno/cancelamento: nada de evento de dívida novo);
--   • fatura PAGA continua travada (nem como origem nem como destino; nada de reabrir);
--   • o destino é a fatura vizinha (o mês anterior ou o seguinte).
-- A despesa conta no mês da fatura, então mudar de fatura muda o mês da despesa nos relatórios: é o efeito esperado.
--
-- Como o banco guarda: a fatura de uma parcela é o mês de debt_installments.due_date, e due_date é o FECHAMENTO do ciclo
-- daquela fatura. Mudar de fatura é mudar due_date para o fechamento do mês vizinho, calculado pelo ciclo do cartão
-- (private.card_cycle_closing: troca de dias da 061 e mês curto, como no resto do código), nunca um valor livre. Junto
-- vão os dias de fechamento e de vencimento gravados na parcela (closing_day, due_day), porque card_months e card_bill_due
-- montam o vencimento da fatura a partir deles: com os do mês de origem, a fatura de destino mostraria o vencimento errado
-- quando a troca de dias da 061 separa os dois meses.
--
-- O que entra:
--   1. private.debt_installments_immutable (recriado a partir do corpo da migration 20261107030000): a parcela continua
--      imutável; a única mudança nova é due_date, closing_day e due_day (todo o resto igual), liberada pela marca de
--      sessão app.card_installment_move, que só a função abaixo liga e desliga (o app não tem UPDATE em
--      debt_installments nem chama set_config).
--   2. public.card_installment_move(p_installment uuid, p_direction text) returns date (o fechamento da fatura de destino).
--      p_direction: 'previous' (fatura anterior) ou 'next' (próxima). Mesmo esqueleto de card_installment_edit (migration
--      064): debt_lock → validações → foto das faturas travadas → mudança → debt_chk → card_paid_lock_check.
--      Recusas (mensagem em português):
--        • 42501 não autenticado, parcela inexistente ou de outra família;
--        • 22023 não é parcela de cartão; direção que não é 'previous' nem 'next';
--        • 55000 cartão sem dias de fechamento; fatura de origem fechada (paga e travada, ou fechada a pagar: a parcela
--          dela já foi ou vai ser cobrada); parcela já cobrada, estornada ou cancelada (qualquer cobrança, crédito ou
--          cancelamento não anulado); fatura de destino já fechada ("anterior" só existe se a anterior ainda não
--          fechou); destino com outro dia de fechamento gravado (troca de dias antiga: um só fechamento por mês);
--        • 23514 destino que fecha até o início do cartão.
--      "Fechada" é a regra de sempre: fechamento <= hoje em São Paulo (private.today_sp).
--      Depois da mudança, o pagamento ligado a uma fatura cujo mês deixou de existir (a última parcela dela saiu) é solto
--      dela (private.card_payment_release, migration 110) e vira adiantamento: o gatilho adiado da 110 só dispara por
--      evento de cancelamento ou crédito, e mover não cria evento. O que muda nos números da fatura de origem e de
--      destino (o pago pode passar do total e a sobra vira crédito/adiantamento da seguinte) é o esperado em fatura aberta.
--
-- O que NÃO muda: nenhum evento (cobrança, crédito, cancelamento) é criado; face, data da compra, categoria, "n de N",
-- classificação por pessoa e o vínculo com a assinatura (recurrence_id, occurrence_date) ficam como estão, então a geração
-- e a sincronização das assinaturas de cartão não duplicam nem perdem a ocorrência. Dívida de cartão, limite e
-- compromissos não mudam (a soma das parcelas a cobrar é a mesma); mudam as faturas, a projeção e os relatórios por mês
-- da fatura (todos leem due_date). Os relatórios por data da compra e por data da parcela (migration 062) não mudam.
--
-- atalho: a mudança não deixa histórico (a parcela guarda só a fatura nova; não há tabela de movimentos como a de
-- edição de valor, debt_installment_edits). Criar uma quando o dono quiser saber quem mandou o quê e quando.
-- Teste: 106_card_installment_move (falha sem esta migration).

-- ---------------------------------------------------------------------------
-- 1. Guard: a fatura de uma parcela muda só pela RPC card_installment_move (marca de sessão)
-- ---------------------------------------------------------------------------
create or replace function private.debt_installments_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- RPC de classificação: somente person_id/is_shared_expense podem mudar.
  if current_setting('app.person_classification', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.due_date, new.face,
          new.category_id, new.category_type, new.created_at, new.description, new.purchase_date,
          new.closing_day, new.due_day, new.recurrence_id, new.occurrence_date)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.due_date, old.face,
          old.category_id, old.category_type, old.created_at, old.description, old.purchase_date,
          old.closing_day, old.due_day, old.recurrence_id, old.occurrence_date) then
    return new;
  end if;
  -- Edição financeira autorizada de parcela e ON DELETE SET NULL do vínculo recorrente.
  if current_setting('app.card_edit', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.due_date, new.category_id,
          new.category_type, new.created_at, new.description, new.purchase_date, new.closing_day,
          new.due_day, new.person_id, new.is_shared_expense)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.due_date, old.category_id,
          old.category_type, old.created_at, old.description, old.purchase_date, old.closing_day,
          old.due_day, old.person_id, old.is_shared_expense) then
    return new;
  end if;
  -- Sincronização de categoria das parcelas de recorrência (migration 036): somente category_id muda.
  if current_setting('app.recurrence_category', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.due_date, new.face,
          new.category_type, new.created_at, new.description, new.purchase_date, new.closing_day,
          new.due_day, new.recurrence_id, new.occurrence_date, new.person_id, new.is_shared_expense)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.due_date, old.face,
          old.category_type, old.created_at, old.description, old.purchase_date, old.closing_day,
          old.due_day, old.recurrence_id, old.occurrence_date, old.person_id, old.is_shared_expense) then
    return new;
  end if;
  -- Migration 111: mudar a parcela de fatura (card_installment_move): só a data de fechamento (due_date) e os dias do
  -- ciclo gravados nela (closing_day, due_day). Todo o resto tem de ficar igual.
  if current_setting('app.card_installment_move', true) = 'on'
     and (new.id, new.household_id, new.debt_id, new.plan, new.seq, new.face, new.category_id, new.category_type,
          new.created_at, new.description, new.purchase_date, new.recurrence_id, new.occurrence_date,
          new.person_id, new.is_shared_expense)
         is not distinct from
         (old.id, old.household_id, old.debt_id, old.plan, old.seq, old.face, old.category_id, old.category_type,
          old.created_at, old.description, old.purchase_date, old.recurrence_id, old.occurrence_date,
          old.person_id, old.is_shared_expense) then
    return new;
  end if;
  raise exception 'parcela é imutável: use o cancelamento' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------
-- 2. RPC
-- ---------------------------------------------------------------------------
create function public.card_installment_move(p_installment uuid, p_direction text) returns date
language plpgsql security definer set search_path = '' as $$
declare
  v_i public.debt_installments%rowtype;
  v_d public.debts%rowtype;
  v_today date := private.today_sp();
  v_lock jsonb;
  v_label text;
  v_target date;
  v_target_label text;
begin
  if (select auth.uid()) is null then
    raise exception 'não autenticado' using errcode = '42501';
  end if;
  select * into v_i from public.debt_installments where id = p_installment;
  if not found or not private.is_member(v_i.household_id) then
    raise exception 'parcela não encontrada' using errcode = '42501';
  end if;
  -- trava o cartão (membro da família + FOR UPDATE) e relê a parcela já com a trava
  v_d := private.debt_lock(v_i.debt_id);
  select * into v_i from public.debt_installments where id = p_installment;
  if v_d.kind <> 'card' then
    raise exception 'só parcela de cartão muda de fatura' using errcode = '22023';
  end if;
  if p_direction is null or p_direction not in ('previous', 'next') then
    raise exception 'direção inválida: use previous (fatura anterior) ou next (próxima fatura)' using errcode = '22023';
  end if;
  if v_d.closing_day is null then
    raise exception 'defina o dia de fechamento e de vencimento do cartão antes de mudar a fatura de uma parcela'
      using errcode = '55000';
  end if;

  v_lock := private.card_paid_snapshot(v_d.id);
  v_label := to_char(v_i.due_date, 'YYYY-MM');
  -- fatura de origem paga e travada: a mensagem certa vem antes das outras recusas (como em card_installment_edit)
  if v_lock ? v_label then
    perform private.card_paid_lock_raise(v_label);
  end if;
  if v_i.due_date <= v_today then
    raise exception 'a fatura de % já fechou: só parcela de fatura aberta muda de fatura', to_char(v_i.due_date, 'MM/YYYY')
      using errcode = '55000';
  end if;
  -- só parcela ainda não cobrada: nenhuma cobrança, crédito ou cancelamento (nem parcial) em aberto
  if exists (select 1 from public.debt_events e
              where e.installment_id = v_i.id and e.kind in ('charge', 'credit') and e.voided_at is null) then
    raise exception 'parcela já cobrada: só parcela ainda não cobrada muda de fatura' using errcode = '55000';
  end if;
  if exists (select 1 from public.debt_events e
              where e.installment_id = v_i.id and e.kind = 'cancel' and e.voided_at is null) then
    raise exception 'parcela com cancelamento ou estorno não muda de fatura' using errcode = '55000';
  end if;

  -- o destino é o fechamento do mês vizinho, pelo ciclo do cartão (troca de dias e mês curto como no resto do código)
  v_target := private.card_cycle_closing(v_d,
    (date_trunc('month', v_i.due_date) + case p_direction when 'next' then interval '1 month' else interval '-1 month' end)::date);
  v_target_label := to_char(v_target, 'YYYY-MM');
  if v_target <= v_today then
    raise exception 'a fatura anterior (%) já fechou: a parcela só pode ir para uma fatura aberta', to_char(v_target, 'MM/YYYY')
      using errcode = '55000';
  end if;
  -- o que fecha até a data de referência já está no saldo de referência e card_bill_due não cobra (mesma trava da compra)
  if v_target <= v_d.reference_date then
    raise exception 'esta fatura fecha em %, até o início do cartão (%): recue o início do cartão', v_target, v_d.reference_date
      using errcode = '23514';
  end if;
  -- cada mês tem um só fechamento (migration 061): se o destino já tem parcela ou crédito com outra data de fechamento
  -- (troca de dias antiga), a fatura ficaria com dois fechamentos
  if exists (select 1 from public.debt_installments x
              where x.household_id = v_d.household_id and x.debt_id = v_d.id and x.id <> v_i.id
                and to_char(x.due_date, 'YYYY-MM') = v_target_label and x.due_date <> v_target
                and coalesce((select sum(e.amount) from public.debt_events e
                               where e.installment_id = x.id and e.kind = 'cancel' and e.voided_at is null), 0) < x.face)
     or exists (select 1 from public.debt_events e
                 where e.household_id = v_d.household_id and e.debt_id = v_d.id and e.kind = 'income_credit'
                   and e.voided_at is null and to_char(e.date, 'YYYY-MM') = v_target_label and e.date <> v_target) then
    raise exception 'a fatura de % tem outro dia de fechamento (troca de dias antiga): a parcela não pode ir para ela',
      to_char(v_target, 'MM/YYYY') using errcode = '55000';
  end if;

  perform set_config('app.card_installment_move', 'on', true);
  update public.debt_installments
     set due_date = v_target,
         closing_day = private.card_cycle_closing_day(v_d, v_target),
         due_day = private.card_cycle_due_day(v_d, v_target)
   where id = v_i.id;
  perform set_config('app.card_installment_move', 'off', true);

  -- se a fatura de origem ficou sem parcela nem crédito, o pagamento ligado a ela é solto (vira adiantamento): mover não
  -- cria evento de cancelamento nem de crédito, então o gatilho adiado da migration 110 não dispararia
  perform private.card_payment_release(v_d.id);
  perform private.debt_chk(v_d.id);
  perform private.card_paid_lock_check(v_d.id, v_lock);
  return v_target;
end $$;

revoke execute on function public.card_installment_move(uuid, text) from public, anon;
grant execute on function public.card_installment_move(uuid, text) to authenticated;
