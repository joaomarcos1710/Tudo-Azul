-- Tudo Azul — migration 028: manter moeda de consolidação bloqueada até integração dos relatórios
--
-- A fase 1 criou households.report_currency como preparação, mas o app ainda
-- apresenta os saldos e relatórios no formato BRL e não converte os valores.
-- Permitir que um owner altere essa coluna agora faria a interface rotular
-- incorretamente os totais. A escrita será liberada somente junto da RPC de
-- consolidação multimoeda e da interface correspondente.

revoke update (report_currency) on public.households from authenticated;
