// CORS for the /proxy/* relays defined in netlify.toml.
//
// Answers browser preflight (OPTIONS) requests directly at the edge, so they
// never reach the upstream provider (which usually rejects them), and adds
// CORS headers to every proxied response so pages on other origins
// (localhost dev servers, other sites, etc.) can call /proxy/* too.
//
// The actual request is still relayed by the [[redirects]] rewrite rules in
// netlify.toml via context.next().

type Context = { next: () => Promise<Response> }

function corsHeaders(req: Request): Headers {
  const h = new Headers()
  const origin = req.headers.get("Origin")
  h.set("Access-Control-Allow-Origin", origin || "*")
  h.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
  h.set(
    "Access-Control-Allow-Headers",
    req.headers.get("Access-Control-Request-Headers") ||
      "Authorization, Content-Type, Accept, X-Requested-With",
  )
  h.set("Access-Control-Expose-Headers", "*")
  h.set("Access-Control-Max-Age", "86400")
  if (origin) {
    h.set("Access-Control-Allow-Credentials", "true")
    h.append("Vary", "Origin")
  }
  return h
}

export default async (req: Request, context: Context) => {
  const cors = corsHeaders(req)

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors })
  }

  const upstream = await context.next()
  const res = new Response(upstream.body, upstream)
  // Drop any CORS headers the upstream sent so ours are the only ones.
  for (const key of [...res.headers.keys()]) {
    if (key.toLowerCase().startsWith("access-control-")) res.headers.delete(key)
  }
  cors.forEach((value, key) => {
    if (key.toLowerCase() === "vary") res.headers.append("Vary", value)
    else res.headers.set(key, value)
  })
  return res
}

export const config = {
  path: "/proxy/*",
}
