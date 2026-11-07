import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const authorization = req.headers.get('Authorization')
  if (!authorization) return Response.json({ error: 'Não autenticado.' }, { status: 401 })
  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return Response.json({ error: 'Sessão inválida.' }, { status: 401 })
  const admin = createClient(url, serviceKey)
  const { error: transferError } = await admin.rpc('prepare_account_deletion', { p_user_id: user.id })
  if (transferError) return Response.json({ error: transferError.message }, { status: 409 })
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteError) return Response.json({ error: 'Não foi possível concluir a exclusão da conta.' }, { status: 500 })
  return Response.json({ success: true })
})
