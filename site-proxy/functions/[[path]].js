/* Giftoria Atelier: serves the shop at https://giftoria-atelier.pages.dev.

   Every request is forwarded to the website on GitHub Pages, so anything published from the super admin appears here
   straight away and there is nothing to redeploy. The super admin is served here too, at /admin/. */

const ORIGIN = "https://yousaftahirkhan.github.io/giftoria-atelier";
const DROP = ["x-github-request-id", "x-fastly-request-id", "x-served-by", "x-cache", "x-cache-hits", "x-timer", "via", "content-length", "access-control-allow-origin"];

export async function onRequest({request}) {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", {status: 405, headers: {Allow: "GET, HEAD"}});

  const upstream = await fetch(ORIGIN + url.pathname + url.search, {
    method: request.method,
    headers: {Accept: request.headers.get("Accept") || "*/*", "Accept-Encoding": "gzip, br"},
    redirect: "manual"
  });

  // GitHub Pages redirects folders without a trailing slash; keep the visitor on this address.
  if (upstream.status >= 300 && upstream.status < 400) {
    const loc = (upstream.headers.get("Location") || "/").replace(/^https?:\/\/yousaftahirkhan\.github\.io\/giftoria-atelier/, "") || "/";
    return Response.redirect(new URL(loc, url).toString(), upstream.status === 301 ? 301 : 302);
  }

  const headers = new Headers(upstream.headers);
  DROP.forEach(h => headers.delete(h));
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return new Response(request.method === "HEAD" ? null : upstream.body, {status: upstream.status, headers});
}
