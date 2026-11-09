#!/usr/bin/env bash
# Concorrência real entre duas sessões: o "zerar tudo" segura o lock da família (FOR UPDATE);
# um aporte concorrente precisa esperar o commit e, depois, não encontra mais a reserva.
# Requer o banco de teste já migrado por scripts/local-db/run-tests.sh (copiado como template).
# Uso (superusuário do Postgres):  scripts/local-db/concorrencia-reservas.sh
set -uo pipefail
TPL="${TUDO_AZUL_TEST_DB:-tudo_azul_local_test}"
DB="tudo_azul_conc"
PSQL=(psql -X -q -v ON_ERROR_STOP=0 -d postgres)
"${PSQL[@]}" -c "drop database if exists ${DB}" -c "create database ${DB} template ${TPL}" >/dev/null || exit 2
DBP=(psql -X -q -d "${DB}")
UID_OWNER="00000000-0000-0000-0000-0000000c0001"

"${DBP[@]}" -c "insert into auth.users (id,email) values ('${UID_OWNER}','conc@teste.com') on conflict do nothing" >/dev/null
# Preparação numa única sessão autenticada (created_by e RLS dependem de auth.uid()).
IDS=$("${DBP[@]}" -t -A <<SQL
select set_config('request.jwt.claims', json_build_object('sub','${UID_OWNER}','role','authenticated')::text, false) \\g /dev/null
set role authenticated;
select public.create_household('Família concorrência') as hid \gset
insert into public.reserves (household_id,name,currency_code) values (:'hid','Concorrente','BRL') returning id \gset
select public.record_reserve_allocation(:'id', 100, current_date, 'antes', gen_random_uuid()) \gset
select :'hid' || ' ' || :'id';
SQL
)
IDS=$(tail -n1 <<<"$IDS")
HID=$(awk '{print $1}' <<<"$IDS"); RID=$(awk '{print $2}' <<<"$IDS")
[ -n "$HID" ] && [ -n "$RID" ] || { echo "setup falhou: $IDS"; exit 2; }

# Sessão 1: zerar tudo segura o lock da família por 3 s antes do commit.
S1=$(cat <<SQL
begin;
select set_config('request.jwt.claims', json_build_object('sub','${UID_OWNER}','role','authenticated')::text, true) \\g /dev/null
set local role authenticated;
select public.reset_household('${HID}', 'zerar tudo') ->> 'reserves' as reservas_zeradas;
select pg_sleep(3);
commit;
SQL
)
# Sessão 2: aporte iniciado 1 s depois; deve esperar o commit da sessão 1.
S2=$(cat <<SQL
select pg_sleep(1);
select clock_timestamp() as inicio;
select set_config('request.jwt.claims', json_build_object('sub','${UID_OWNER}','role','authenticated')::text, false) \\g /dev/null
set role authenticated;
select public.record_reserve_allocation('${RID}', 50, current_date, 'concorrente', gen_random_uuid());
select clock_timestamp() as fim;
SQL
)
OUT1=$(mktemp); OUT2=$(mktemp)
( printf '%s\n' "$S1" | "${DBP[@]}" -A -t >"$OUT1" 2>&1 ) &
( printf '%s\n' "$S2" | "${DBP[@]}" -A -t >"$OUT2" 2>&1 ) &
wait

echo "--- sessão 1 (zerar tudo):"; cat "$OUT1"
echo "--- sessão 2 (aporte concorrente):"; cat "$OUT2"
RES=0
# O aporte precisa ter ficado esperando o zerar tudo (pelo menos ~1,5 s do lock de 3 s).
ESPERA=$(python3 - "$OUT2" <<'PY'
import re,sys,datetime
ts=[l.strip() for l in open(sys.argv[1]) if re.match(r"^\d{4}-\d{2}-\d{2} ", l.strip())]
if len(ts)<2: print(0); raise SystemExit
f=lambda t: datetime.datetime.fromisoformat(t.split("+")[0].strip())
print(round((f(ts[-1])-f(ts[0])).total_seconds(),2))
PY
)
echo "tempo do aporte concorrente: ${ESPERA}s"
python3 -c "import sys; sys.exit(0 if float(sys.argv[1])>=1.5 else 1)" "$ESPERA" && echo "OK: aporte esperou o lock" || { echo "FALHA: aporte não esperou o lock"; RES=1; }
grep -q "reserva não encontrada ou acesso negado" "$OUT2" && echo "OK: aporte concorrente recusado depois do zerar tudo" || { echo "FALHA: aporte concorrente não foi recusado como esperado"; RES=1; }
REST=$("${DBP[@]}" -t -A -c "select count(*) from public.reserves where id='${RID}'")
[ "$REST" = "0" ] && echo "OK: reserva removida pelo zerar tudo" || { echo "FALHA: reserva ainda existe ($REST)"; RES=1; }
ALOC=$("${DBP[@]}" -t -A -c "select count(*) from public.reserve_allocations where household_id='${HID}'")
[ "$ALOC" = "0" ] && echo "OK: nenhum aporte órfão (ledger zerado, sem o concorrente)" || { echo "FALHA: aportes restantes ($ALOC)"; RES=1; }
rm -f "$OUT1" "$OUT2"
exit $RES
