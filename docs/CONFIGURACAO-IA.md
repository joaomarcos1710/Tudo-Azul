# Configuração do Lançamento Inteligente com IA

A função de análise é executada no backend da Vercel em `/api/ai/parse-transaction`. Para habilitá-la:

1. No projeto Tudo Azul da Vercel, abra **Settings → Environment Variables**.
2. Crie `OPENROUTER_API_KEY` com uma chave gerada no painel do OpenRouter. Marque os ambientes em que pretende testar/usar a funcionalidade.
3. Mantenha a chave sem prefixo `VITE_`. Nunca a coloque em variáveis públicas nem em código do navegador.
4. A função usa `OPENROUTER_MODEL` para selecionar o modelo. O padrão é `openai/gpt-4o-mini`; use o identificador no formato `provedor/modelo` aceito pelo OpenRouter.
5. Opcionalmente, configure `OPENROUTER_SITE_URL` para enviar o cabeçalho `HTTP-Referer` e `OPENROUTER_SITE_NAME` para personalizar `X-Title`. O nome padrão é `Tudo Azul`.
6. A função usa `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` quando configuradas; como compatibilidade, também lê `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` já usadas pelo frontend. Não configure uma service-role key nesta rota.
7. Faça um novo deploy da Vercel depois de salvar as variáveis.

A rota usa o SDK compatível com OpenAI apontado para `https://openrouter.ai/api/v1`. A resposta estruturada é solicitada em modo JSON e validada novamente com Zod. O endpoint exige JWT válido e confirma a associação do utilizador à família antes de consultar categorias ativas sob RLS. Não grava lançamentos. O formulário atual valida novamente os campos e só grava após a confirmação da pessoa.
