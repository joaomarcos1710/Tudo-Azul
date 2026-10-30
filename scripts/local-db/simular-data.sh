#!/usr/bin/env bash
# Roda os testes pgTAP como se hoje fosse outro dia, para achar teste que só passa por causa da data de hoje.
# Troca now() por um relógio falso numa CÓPIA das migrations e dos testes (o repositório não é alterado).
# Uso (como superusuário do Postgres):  scripts/local-db/simular-data.sh AAAA-MM-DD [arquivo.test.sql ...]
# Exemplo:  su postgres -c "scripts/local-db/simular-data.sh 2027-01-02"
# AVISO: aproximação, como o run-tests.sh; o resultado oficial é o do CI.
set -euo pipefail
[ $# -ge 1 ] || { echo "uso: $0 AAAA-MM-DD [arquivo.test.sql ...]"; exit 64; }
dia="$1"; shift
raiz="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp -r "$raiz/supabase" "$raiz/scripts" "$tmp/"
find "$tmp/supabase" -name '*.sql' -exec sed -i 's/\bnow()/fk.fake_now()/g' {} +
{
  echo "create schema fk; grant usage on schema fk to public;"
  echo "create function fk.fake_now() returns timestamptz language sql stable as \$\$ select coalesce(nullif(current_setting('app.fake_now', true), ''), clock_timestamp()::text)::timestamptz \$\$;"
  echo "grant execute on function fk.fake_now() to public;"
  cat "$tmp/scripts/local-db/shim.sql"
} > "$tmp/shim.novo" && mv "$tmp/shim.novo" "$tmp/scripts/local-db/shim.sql"
DB="${TUDO_AZUL_TEST_DB:-tudo_azul_data_simulada}"
# o relógio falso vale para o banco inteiro; o run-tests.sh recria o banco, então grava depois do create database
sed -i "s|^\"\${PSQL\[@\]}\" -c \"alter database \${DB} set search_path|\"\${PSQL[@]}\" -c \"alter database \${DB} set app.fake_now = '${dia} 12:00:00-03'\" >/dev/null\n&|" "$tmp/scripts/local-db/run-tests.sh"
cd "$tmp"
if [ $# -gt 0 ]; then args=(); for f in "$@"; do args+=("supabase/tests/database/$(basename "$f")"); done; else args=(); fi
TUDO_AZUL_TEST_DB="$DB" bash scripts/local-db/run-tests.sh "${args[@]}"
