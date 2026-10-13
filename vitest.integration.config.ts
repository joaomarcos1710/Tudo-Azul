import { defineConfig } from 'vitest/config'

// Testes de integração contra o stack LOCAL do Supabase (PostgREST + Auth).
// Só rodam com SUPABASE_URL e SUPABASE_ANON_KEY (ou SUPABASE_PUBLISHABLE_KEY) definidos;
// sem eles, são pulados. Nunca use chaves do projeto hospedado aqui.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.itest.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
})
