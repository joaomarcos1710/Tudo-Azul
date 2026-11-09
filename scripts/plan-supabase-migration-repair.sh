#!/usr/bin/env bash
set -euo pipefail

# Plano somente de leitura. Não executa migration repair nem db push.
if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI não encontrado." >&2
  exit 1
fi

version="$(supabase --version 2>&1)"
echo "Supabase CLI: $version"

if [[ "$version" == *"3."* ]]; then
  target_flag="--remote"
else
  target_flag="--linked"
fi

echo
echo "Histórico remoto atual (somente leitura):"
supabase migration list "$target_flag"

echo
echo "Nenhuma alteração foi executada."
echo "Após revisão e autorização explícita, o único alinhamento de histórico identificado é:"
echo "supabase migration repair 20261106160100 20261107030000 20261107150000 --status applied $target_flag"
echo
echo "Atenção: esse comando altera somente supabase_migrations.schema_migrations."
echo "Não o execute antes de conferir o conteúdo idêntico descrito em docs/execucao/supabase-migration-drift.md."
echo "As migrations de schema pendentes devem ser validadas primeiro em staging."
