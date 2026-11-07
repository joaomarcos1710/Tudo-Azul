import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.3'

const allowedOrigin = Deno.env.get('APP_ORIGIN')
const corsHeaders = {
  'Access-Control-Allow-Origin': allowedOrigin ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}

function resposta(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return resposta({ error: 'Método não permitido.' }, 405)

  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return resposta({ error: 'Não autenticado.' }, 401)

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return resposta({ error: 'Serviço de autenticação não configurado.' }, 500)

  const token = authorization.slice('Bearer '.length)
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: { user }, error: authError } = await admin.auth.getUser(token)
  if (authError || !user) return resposta({ error: 'Sessão inválida.' }, 401)
  const { data: state, error: prepareError } = await admin.rpc('prepare_account_deletion', { p_user_id: user.id })
  if (prepareError) return resposta({ error: prepareError.message }, 409)

  const rollback = async () => {
    const { error } = await admin.rpc('rollback_account_deletion', {
      p_state: { ...state, user_id: user.id },
    })
    return error
  }

  // Revoga os refresh tokens globais antes da exclusão. JWTs já emitidos continuam válidos até expirar.
  const { error: revokeError } = await admin.auth.admin.signOut(token)
  if (revokeError) {
    const rollbackError = await rollback()
    return resposta({
      error: rollbackError
        ? 'Não foi possível encerrar as sessões nem restaurar automaticamente a titularidade. Procure o suporte antes de tentar novamente.'
        : 'Não foi possível encerrar as sessões da conta. Nenhum dado foi removido.',
    }, 500)
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) {
    const rollbackError = await rollback()
    return resposta({
      error: rollbackError
        ? 'A exclusão falhou e a titularidade não pôde ser restaurada automaticamente. Procure o suporte.'
        : 'Não foi possível concluir a exclusão da conta. A titularidade foi restaurada.',
    }, 500)
  }

  return resposta({ success: true })
})
