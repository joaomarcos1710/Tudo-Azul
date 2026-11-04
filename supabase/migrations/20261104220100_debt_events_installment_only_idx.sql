-- 053: índice de debt_events só por parcela.
-- private.debt_chk (chamada em toda compra, cobrança e pagamento de cartão) soma os eventos de cada parcela
-- com "where e.installment_id = i.id", sem household_id. O índice da 008 começa por household_id e não serve
-- a essa busca: o custo era parcelas × eventos (com o histórico do Organizze, o fechamento de uma fatura
-- passava de 40 s, acima do limite de 8 s das chamadas do app). Só índice: nenhum resultado muda.
create index if not exists debt_events_installment_only_idx
  on public.debt_events (installment_id)
  where installment_id is not null and voided_at is null;
