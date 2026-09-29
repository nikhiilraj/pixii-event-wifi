export async function onRequest({ request, env }) {
  if (!env.PORTAL || typeof env.PORTAL.fetch !== "function") {
    return Response.json(
      { ok: false, error: "Portal service unavailable" },
      { status: 503 },
    );
  }

  return env.PORTAL.fetch(request);
}
