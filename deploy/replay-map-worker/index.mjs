const SITE_ORIGIN = "https://nonamepickup.servehalflife.com";

export default {
  async fetch(request, env) {
    const headers = {
      "Access-Control-Allow-Origin": SITE_ORIGIN,
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Headers": "Range",
    };

    let key;
    try {
      key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    } catch {
      return new Response(null, { status: 400, headers });
    }
    if (!/^assets\/maps\/[^/]+\/[^/]+\.glb$/i.test(key)) {
      return new Response(null, { status: 404, headers });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, {
        status: 405,
        headers: { ...headers, Allow: "GET, HEAD, OPTIONS" },
      });
    }

    const object = request.method === "HEAD"
      ? await env.REPLAY_MAPS.head(key)
      : await env.REPLAY_MAPS.get(key);
    if (!object) return new Response(null, { status: 404, headers });

    return new Response(request.method === "GET" ? object.body : null, {
      headers: {
        ...headers,
        "Content-Type": "model/gltf-binary",
        "Content-Length": String(object.size),
        "Cache-Control": "public, max-age=3600",
        ETag: object.httpEtag,
      },
    });
  },
};
