// Gilt Society. — Stripe → Printful automatic fulfilment.
// Everything except /api/* is served from /public as before.
//
// Secrets (set in Cloudflare → Workers & Pages → broken-mud-4e8f → Settings → Variables and Secrets):
//   STRIPE_WEBHOOK_SECRET  – signing secret of the Stripe webhook endpoint (whsec_…)
//   PRINTFUL_TOKEN         – Printful private API token
// Plain variable (in wrangler.jsonc): PRINTFUL_STORE_ID

// Stripe payment-link metadata.sku  →  Printful store (sync) product ID
const SKU_TO_PRINTFUL = {
  "aop-tee": 488796347,
  "sweatshirt": 488796341,
  "mug": 488796310,
  "emb-tee-black": 488813983,
  "emb-tee-white": 488811791,
  "emb-hoodie-black": 488816262,
  "emb-hoodie-white": 488815175,
  "print-tee-black": 488796343,
  "print-hoodie-black": 488799954,
  "tote": 488799588,
  "emb-vneck-white": 488926835,
  "emb-cap-black": 488927327,
  "emb-cap-white": 488927569,
  "sticker": 489158135,
  "mug-black": 489180254,
  "sweatshirt-white": 489229910,
  "vneck-white": 489233807,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/stripe-webhook") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      return handleStripe(request, env);
    }
    if (url.pathname === "/api/health") {
      const out = { ok: true, stripe: !!env.STRIPE_WEBHOOK_SECRET, printful: !!env.PRINTFUL_TOKEN,
        stripe_format_ok: String(env.STRIPE_WEBHOOK_SECRET || "").startsWith("whsec_") };
      if (url.searchParams.has("deep") && env.PRINTFUL_TOKEN) {
        const r = await pf(env, "/store/products/" + SKU_TO_PRINTFUL["emb-tee-black"]);
        const d = await r.json().catch(() => ({}));
        out.printful_api = r.status;
        out.printful_variants = d.result ? (d.result.sync_variants || []).map((v) => v.size) : (d.error && d.error.message);
      }
      return json(out);
    }
    if (url.pathname === "/api/hit" && request.method === "POST") {
      // Visit counter: one row per page view or Buy click. No IPs, cookies or personal data.
      try { await recordHit(request, env); } catch (e) { console.log("hit error", String(e)); }
      return new Response(null, { status: 204 });
    }
    if (url.pathname.startsWith("/m/")) {
      const key = url.pathname.slice(3);
      const obj = env.MERCH_PHOTOS && (await env.MERCH_PHOTOS.getWithMetadata(key, "arrayBuffer"));
      if (!obj || !obj.value) return new Response("Not found", { status: 404 });
      return new Response(obj.value, { headers: { "Content-Type": (obj.metadata && obj.metadata.type) || "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleStripe(request, env) {
  const body = await request.text();
  const ok = await verifyStripe(body, request.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response("Bad signature", { status: 400 });

  const event = JSON.parse(body);
  if (event.type !== "checkout.session.completed") return json({ ignored: event.type });

  const s = event.data.object;
  if (s.payment_status !== "paid") return json({ ignored: "not paid" });
  const sku = s.metadata && s.metadata.sku;
  const productId = SKU_TO_PRINTFUL[sku];
  if (!productId) {
    console.log("No Printful product for sku", sku, s.id);
    return json({ ignored: "sku " + sku });
  }

  const size = ((s.custom_fields || []).find((f) => f.key === "size") || {}).dropdown?.value || "";
  const ship = (s.collected_information && s.collected_information.shipping_details) || s.shipping_details || {};
  const addr = ship.address || (s.customer_details && s.customer_details.address) || {};
  const cd = s.customer_details || {};

  try {
    const variantId = await findVariant(env, productId, size);
    const order = {
      external_id: s.id.replace(/[^A-Za-z0-9]/g, "").slice(-32),
      shipping: "STANDARD",
      recipient: {
        name: ship.name || cd.name || "Customer",
        address1: addr.line1,
        address2: addr.line2 || "",
        city: addr.city,
        state_code: addr.state,
        country_code: addr.country || "US",
        zip: addr.postal_code,
        phone: cd.phone || "",
        email: cd.email || "",
      },
      items: [{ sync_variant_id: variantId, quantity: 1 }],
    };
    const r = await pf(env, "/orders?confirm=true", { method: "POST", body: JSON.stringify(order) });
    const out = await r.json();
    if (!r.ok) {
      const msg = JSON.stringify(out);
      if (/external_id|already/i.test(msg)) return json({ duplicate: true }); // Stripe retry of an order we already sent
      console.log("Printful order failed", r.status, msg);
      return new Response("Printful error", { status: 502 }); // Stripe retries automatically
    }
    console.log("Printful order created", out.result && out.result.id, sku, size);
    return json({ printful_order: out.result && out.result.id });
  } catch (e) {
    console.log("Fulfilment error", String(e));
    return new Response("Error", { status: 500 });
  }
}

async function findVariant(env, productId, size) {
  const r = await pf(env, "/store/products/" + productId);
  const data = await r.json();
  if (!r.ok) throw new Error("Printful product " + productId + ": " + JSON.stringify(data));
  const vs = data.result.sync_variants || [];
  if (vs.length === 1 || !size) return vs[0].id;
  const want = size.toLowerCase().replace(/\s+/g, "");
  const hit = vs.find((v) => String(v.size || "").toLowerCase().replace(/\s+/g, "") === want) ||
    vs.find((v) => String(v.name || "").toLowerCase().replace(/\s+/g, "").endsWith("/" + want));
  if (!hit) throw new Error("No variant for size " + size + " on product " + productId);
  return hit.id;
}

function pf(env, path, init = {}) {
  return fetch("https://api.printful.com" + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + env.PRINTFUL_TOKEN,
      "X-PF-Store-Id": String(env.PRINTFUL_STORE_ID),
      "Content-Type": "application/json",
    },
  });
}

async function verifyStripe(payload, header, secret) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const t = parts.t, sig = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sig.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 600) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(t + "." + payload));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sig.some((s) => s === hex);
}

function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}

const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|monitor/i;
const SOURCES = [
  ["instagram", /instagram\./], ["facebook", /(^|\.)(facebook|fb)\.(com|me)|messenger\./], ["tiktok", /tiktok\./],
  ["pinterest", /pinterest\.|pin\.it/], ["google", /google\./], ["bing", /bing\./], ["youtube", /youtube\.|youtu\.be/],
  ["threads", /threads\.net/], ["etsy", /etsy\./], ["stripe", /stripe\.com/],
];
async function recordHit(request, env) {
  if (!env.STATS) return;
  const ua = request.headers.get("user-agent") || "";
  if (!ua || BOT.test(ua)) return;
  const b = await request.json().catch(() => ({}));
  const kind = b.k === "buy" ? "buy" : "view";
  let path = String(b.p || "/").slice(0, 120);
  if (!path.startsWith("/")) path = "/";
  path = path.replace(/\.html$/, "").replace(/\/index$/, "/") || "/";
  let source = String(b.u || "").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30);
  if (!source) {
    let host = "";
    try { host = new URL(String(b.r || "")).hostname.toLowerCase(); } catch (e) {}
    if (!host) source = "direct";
    else if (/aetheratelierco\.com$/.test(host)) source = "internal";
    else source = (SOURCES.find(([, re]) => re.test(host)) || [host.replace(/^www\./, "").slice(0, 40)])[0];
  }
  const device = /Mobi|Android|iPhone|iPad/i.test(ua) ? "mobile" : "desktop";
  const country = (request.cf && request.cf.country) || "";
  const now = new Date();
  const day = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const item = kind === "buy" ? String(b.i || "").slice(0, 80) : null;
  await env.STATS.prepare("INSERT INTO hits (ts, day, kind, path, source, device, country, new_session, item) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(now.toISOString(), day, kind, path, source, device, country, b.s ? 1 : 0, item).run();
}
