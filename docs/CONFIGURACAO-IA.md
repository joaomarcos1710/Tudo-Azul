# Configuração do Lançamento Inteligente com IA

A função de análise é executada no backend da Vercel em `/api/ai/parse-transaction`. Para habilitá-la:

1. No projeto Tudo Azul da Vercel, abra **Settings → Environment Variables**.
2. Crie `OPENAI_API_KEY` com a chave da conta OpenAI. Marque os ambientes em que pretende testar/usar a funcionalidade.
3. Mantenha `OPENAI_API_KEY` sem prefixo `VITE_`. Nunca a coloque em variáveis públicas nem em código do navegador.
4. A função usa `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` quando configuradas; como compatibilidade, também lê `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` já usadas pelo frontend. Não configure uma service-role key nesta rota.
5. Faça um novo deploy da Vercel depois de salvar as variáveis.

A rota exige JWT válido e confirma a associação do utilizador à família antes de consultar categorias ativas sob RLS. Não grava lançamentos. O formulário atual valida novamente os campos e só grava após a confirmação da pessoa.
