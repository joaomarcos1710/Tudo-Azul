import { createClient } from "npm:@supabase/supabase-js@2.80.0";

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const allowedOrigin = Deno.env.get("TOOLJET_ALLOWED_ORIGIN");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && allowedOrigin && origin === allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(data: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...(req ? corsHeaders(req) : {}),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function maskEmail(email?: string): string | null {
  if (!email || !email.includes("@")) return null;
  const parts = email.split("@");
  const local = parts[0];
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  const hidden = "*".repeat(Math.max(2, Math.min(8, local.length - visible.length)));
  return visible + hidden + "@" + parts.slice(1).join("@");
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

function getRoute(pathname: string): string | null {
  const match = pathname.match(/\/functions\/v1\/admin-api\/(overview|families|users|events|audit)\/?$/);
  return match?.[1] ?? null;
}

function isUnauthorized(req: Request): boolean {
  const expected = Deno.env.get("TOOLJET_ADMIN_API_KEY");
  const authorization = req.headers.get("authorization") ?? "";
  const supplied = authorization.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied || supplied.length !== expected.length) return true;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  }
  return mismatch !== 0;
}

async function countRows(client: ReturnType<typeof createClient>, table: string): Promise<number> {
  const { count, error } = await client.from(table).select("id", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin");
    const allowedOrigin = Deno.env.get("TOOLJET_ALLOWED_ORIGIN");
    if (origin && (!allowedOrigin || origin !== allowedOrigin)) {
      return json({ error: "origin_not_allowed" }, 403, req);
    }
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405, req);
  if (isUnauthorized(req)) return json({ error: "unauthorized" }, 401, req);

  const url = new URL(req.url);
  const route = getRoute(url.pathname);
  if (!route) return json({ error: "not_found" }, 404, req);

  const pagination = parsePage(url);
  if (!pagination) return json({ error: "invalid_pagination" }, 400, req);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "server_configuration_error" }, 503, req);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "tudo-azul-tooljet-admin/1.0" } },
  });

  try {
    if (route === "overview") {
      const results = await Promise.all([
        countRows(admin, "households"),
        countRows(admin, "household_members"),
        countRows(admin, "profiles"),
      ]);
      return json({
        data: {
          families_total: results[0],
          memberships_total: results[1],
          profiles_total: results[2],
        },
        meta: { read_only: true, generated_at: new Date().toISOString() },
      }, 200, req);
    }

    if (route === "families") {
      const query = url.searchParams.get("query");
      let request = admin.from("households")
        .select("id,name,created_at,household_members(count)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range((pagination.page - 1) * pagination.perPage, pagination.page * pagination.perPage - 1);

      if (query) {
        const safe = query.trim();
        if (!safe || safe.length > 80 || /[%_*(),\\]/.test(safe)) {
          return json({ error: "invalid_query" }, 400, req);
        }
        request = request.ilike("name", "%" + safe + "%");
      }

      const { data, error, count } = await request;
      if (error) throw error;
      return json({
        data: (data ?? []).map((family: any) => ({
          id: family.id,
          name: family.name,
          created_at: family.created_at,
          members_count: Array.isArray(family.household_members)
            ? family.household_members[0]?.count ?? 0
            : 0,
        })),
        meta: { page: pagination.page, per_page: pagination.perPage, total: count ?? 0, read_only: true },
      }, 200, req);
    }

    if (route === "users") {
      if (url.searchParams.has("query")) {
        return json({ error: "search_not_supported" }, 400, req);
      }
      const { data, error } = await admin.auth.admin.listUsers({
        page: pagination.page,
        perPage: pagination.perPage,
      });
      if (error) throw error;
      const users = data.users.map((user) => ({
        id: user.id,
        email_masked: maskEmail(user.email),
        email_confirmed: Boolean(user.email_confirmed_at),
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        banned: Boolean(user.banned_until && new Date(user.banned_until) > new Date()),
      }));
      return json({
        data: users,
        meta: { page: pagination.page, per_page: pagination.perPage, read_only: true },
      }, 200, req);
    }

    // Event and audit endpoints stay disabled until durable event storage,
    // retention and actor attribution are implemented and reviewed.
    return json({
      error: "integration_pending",
      message: "Esta consulta ainda não foi habilitada.",
    }, 501, req);
  } catch (error) {
    console.error("tooljet_admin_query_failed", {
      route,
      error_code: error instanceof Error ? error.name : "unknown",
    });
    return json({ error: "internal_error" }, 500, req);
  }
});
