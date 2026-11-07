import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function resposta(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return resposta({ error: 'Método não permitido.' }, 405)
  const authorization = req.headers.get('Authorization')
  if (!authorization) return resposta({ error: 'Não autenticado.' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return resposta({ error: 'Sessão inválida.' }, 401)
  const admin = createClient(url, serviceKey)
  const { error: transferError } = await admin.rpc('prepare_account_deletion', { p_user_id: user.id })
  if (transferError) return resposta({ error: transferError.message }, 409)
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) return resposta({ error: 'Não foi possível concluir a exclusão da conta.' }, 500)
  return resposta({ success: true })
})
