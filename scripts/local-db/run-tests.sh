#!/usr/bin/env bash
# Roda migrations + testes pgTAP num PostgreSQL comum (sem Docker).
# AVISO: é uma aproximação do Supabase (ver shim.sql). O resultado oficial é o do CI.
# Uso (como superusuário do Postgres):  scripts/local-db/run-tests.sh [arquivo.test.sql ...]
# Requer: postgresql 15+ com a extensão pgcrypto, e pgTAP instalado.
set -uo pipefail
cd "$(dirname "$0")/../.."
DB="${TUDO_AZUL_TEST_DB:-tudo_azul_local_test}"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -d postgres)

"${PSQL[@]}" -c "drop database if exists ${DB}" -c "create database ${DB}" >/dev/null
"${PSQL[@]}" -c "alter database ${DB} set search_path = \"\$user\", public, extensions" >/dev/null
DBP=(psql -X -q -v ON_ERROR_STOP=1 -d "${DB}")

echo "== shim ==";            "${DBP[@]}" -f scripts/local-db/shim.sql || exit 2
"${DBP[@]}" -c "create extension pgtap with schema extensions" || exit 2
echo "== migrations =="
for f in supabase/migrations/*.sql; do
  echo "-- $f"
  "${DBP[@]}" -f "$f" || { echo "FALHA na migration $f"; exit 3; }
done

echo "== testes =="
shopt -s nullglob
files=("$@"); [ ${#files[@]} -eq 0 ] && files=(supabase/tests/database/*.test.sql)
total_fail=0
for f in "${files[@]}"; do
  out=$(psql -X -q -t -A -d "${DB}" -f "$f" 2>&1)
  ok=$(grep -c '^ok ' <<<"$out"); nok=$(grep -c '^not ok ' <<<"$out")
  err=$(grep -c -E 'ERROR|FATAL' <<<"$out")
  printf '%-48s ok=%-3s not_ok=%-3s erros_sql=%s\n' "$(basename "$f")" "$ok" "$nok" "$err"
  if [ "$nok" -gt 0 ] || [ "$err" -gt 0 ]; then
    total_fail=$((total_fail+1)); grep -E '^not ok |ERROR|^# ' <<<"$out" | head -40
  fi
done
echo "== resumo: arquivos com falha = ${total_fail} =="
exit $((total_fail>0))
