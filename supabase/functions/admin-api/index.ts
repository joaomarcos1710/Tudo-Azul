import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://app.tooljet.com",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Vary": "Origin",
};

type Route = "overview" | "families" | "users" | "events" | "audit";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function maskEmail(email: string | undefined): string | null {
  if (!email || !email.includes("@")) return null;
  const [local, domain] = email.split("@");
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(2, Math.min(8, local.length - visible.length)))}@${domain}`;
}

function parsePage(url: URL): { page: number; perPage: number } | null {
  const rawPage = url.searchParams.get("page") ?? "1";
  const rawPerPage = url.searchParams.get("per_page") ?? "25";
  if (!/^\d+$/.test(rawPage) || !/^\d+$/.test(rawPerPage)) return null;
  const page = Number(rawPage);
  const perPage = Number(rawPerPage);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000) return null;
  if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) return null;
  return { page, perPage };
}

function getRoute(pathname: string): Route | null {
  const match = pathname.match(/\/functions\/v1\/admin-api\/(overview|families|users|events|audit)\/?$/);
  return (match?.[1] as Route | undefined) ?? null;
}

function safeSearch(value: string): string | null {
  const query = value.trim();
  if (!query || query.length > 80 || /[%_*(),\\\\]/.test(query)) return null;
  return query;
}

function unauthorized(req: Request): boolean {
  const expected = Deno.env.get("TOOLJET_ADMIN_API_KEY");
  const supplied = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || supplied.length !== expected.length) return true;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return mismatch !== 0;
}

async function countRows(client: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await client.from(table).select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin");
    if (origin && origin !== "https://app.tooljet.com") return json({ error: "origin_not_allowed" }, 403);
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (unauthorized(req)) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const route = getRoute(url.pathname);
  if (!route) return json({ error: "not_found" }, 404);
  const pageInfo = parsePage(url);
  if (!pageInfo) return json({ error: "invalid_pagination" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "server_configuration_error" }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "tudo-azul-tooljet-admin/1.0" } },
  });

  try {
    if (route === "overview") {
      const [families, memberships, users] = await Promise.all([
        countRows(admin, "households"),
        countRows(admin, "household_members"),
        admin.auth.admin.listUsers({ page: 1, perPage: 1 }),
      ]);
      if (users.error) throw users.error;
      return json({
        data: {
          families_total: families,
          memberships_total: memberships,
          users_total: users.data.total ?? null,
        },
        meta: { read_only: true, generated_at: new Date().toISOString() },
      });
    }

    if (route === "families") {
      const query = url.searchParams.get("query");
      let request = admin.from("households")
        .select("id,name,created_at,household_members(count)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range((pageInfo.page - 1) * pageInfo.perPage, pageInfo.page * pageInfo.perPage - 1);
      if (query) {
        const safe = safeSearch(query);
        if (!safe) return json({ error: "invalid_query" }, 400);
        request = request.ilike("name", `%${safe}%`);
      }
      const { data, error, count } = await request;
      if (error) throw error;
      return json({
        data: (data ?? []).map((family) => ({
          id: family.id,
          name: family.name,
          created_at: family.created_at,
          members_count: Array.isArray(family.household_members) ? family.household_members[0]?.count ?? 0 : 0,
        })),
        meta: { page: pageInfo.page, per_page: pageInfo.perPage, total: count ?? 0, read_only: true },
      });
    }

    if (route === "users") {
      const query = url.searchParams.get("query")?.trim().toLowerCase() ?? "";
      if (query.length > 80 || /[%_*(),\\\\]/.test(query)) return json({ error: "invalid_query" }, 400);
      const { data, error } = await admin.auth.admin.listUsers({ page: pageInfo.page, perPage: pageInfo.perPage });
      if (error) throw error;
      const users = data.users
        .filter((user) => !query || user.id.toLowerCase().includes(query) || (user.email ?? "").toLowerCase().includes(query))
        .map((user) => ({
          id: user.id,
          email_masked: maskEmail(user.email),
          email_confirmed: Boolean(user.email_confirmed_at),
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at,
          banned: Boolean(user.banned_until && new Date(user.banned_until) > new Date()),
        }));
      return json({
        data: users,
        meta: { page: pageInfo.page, per_page: pageInfo.perPage, read_only: true, note: "A busca percorre apenas a página solicitada do Auth." },
      });
    }

    // These screens remain explicitly unavailable until a server-side event/audit
    // store and retention policy are implemented. Never fabricate operational data.
    return json({ error: "integration_pending", message: "Esta consulta ainda não foi habilitada." }, 501);
  } catch (error) {
    console.error("tooljet_admin_query_failed", {
      route,
      error_code: error instanceof Error ? error.name : "unknown",
    });
    return json({ error: "internal_error" }, 500);
  }
}

Deno.serve(handle);
