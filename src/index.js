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
  "iris-mug": 493865399,
  "iris-sticker": 493868893,
  "loop-mug": 493872128,
  "loop-sticker": 493874379,
  "loop-hoodie": 493876096,
  "loop-tee": 493877391,
  "iris-hoodie": 494177930,
  "helios-rug": 494856736,
  "iris-rug": 494857718,
  "gilded-rug": 494858836,
  "iris-blanket": 494860017,
  "loop-blanket": 494861011,
  "gilded-blanket": 494862325,
  "iris-backpack": 494866489,
  "loop-backpack": 494868103,
  "iris-curtain": 494869816,
  "loop-curtain": 494871306,
  "gilded-curtain": 494873189,
  "orn-iris": 499500081,
  "orn-helios": 499500389,
  "orn-gilded": 499500711,
  "orn-loop": 499500944,
  "case-iris": 499501251,
  "case-loop": 499501602,
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
      if (url.searchParams.get("pf") === "gifts" && env.PRINTFUL_TOKEN) {
        // Check that the new gift products were set up with the art filling the print area.
        out.gifts = {};
        for (const k of ["orn-iris", "case-iris", "case-loop"]) {
          const d = await (await pf(env, "/store/products/" + SKU_TO_PRINTFUL[k])).json();
          const v = (d.result && d.result.sync_variants) || [];
          out.gifts[k] = { variants: v.length, sizes: v.map((x) => x.size).slice(0, 30), files: v.slice(0, 2).map((x) => (x.files || []).map((f) => ({ type: f.type, position: f.position || null, w: f.width, h: f.height }))),
            previews: v.filter((x) => /13 mini|16 Pro$|17 Air|18 Pro Max/.test(x.size || "")).map((x) => ({ size: x.size, url: ((x.files || []).find((f) => f.type === "preview") || {}).preview_url })) };
        }
        const pfs = (await (await pf(env, "/mockup-generator/printfiles/601")).json()).result || {};
        out.case_printfiles = (pfs.printfiles || []).map((p) => [p.printfile_id, p.width, p.height]);
        out.case_variant_files = (pfs.variant_printfiles || []).map((x) => [x.variant_id, x.placements && x.placements.default]);
      }
      return json(out);
    }
    if (url.pathname === "/api/hit" && request.method === "POST") {
      // Visit counter: one row per page view or Buy click. No IPs, cookies or personal data.
      try { await recordHit(request, env); } catch (e) { console.log("hit error", String(e)); }
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/api/subscribe" && request.method === "POST") {
      // Email sign-up from the site pop-up. Stores only what the visitor typed, with the consent wording they agreed to.
      let b = {};
      try { b = await request.json(); } catch (_) {}
      const email = String(b.email || "").trim().toLowerCase().slice(0, 200);
      const name = String(b.name || "").trim().slice(0, 60);
      if (b.website) return Response.json({ ok: true }); // honeypot: bots fill hidden fields
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return Response.json({ ok: false, error: "email" }, { status: 400 });
      const consent = "Yes, email me Gilt Society. drops and offers. Unsubscribe anytime.";
      await env.STATS.prepare("INSERT INTO subscribers (email, first_name, source, page, consent, created) VALUES (?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET first_name=COALESCE(NULLIF(excluded.first_name,''), subscribers.first_name)")
        .bind(email, name, String(b.source || "popup").slice(0, 40), String(b.page || "").slice(0, 120), consent, new Date().toISOString()).run();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/gift-card") return giftPage(env, url.searchParams.get("s"));
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
  if (/^gift-(50|100)$/.test(sku || "")) return assignGiftCode(env, s, Number(sku.split("-")[1]));
  const field = (k) => ((s.custom_fields || []).find((f) => f.key === k) || {}).dropdown?.value || "";
  const lines = skuLines(sku, field);
  if (!lines) {
    console.log("No Printful product for sku", sku, s.id);
    return json({ ignored: "sku " + sku });
  }
  const ship = (s.collected_information && s.collected_information.shipping_details) || s.shipping_details || {};
  const addr = ship.address || (s.customer_details && s.customer_details.address) || {};
  const cd = s.customer_details || {};

  try {
    const items = [];
    for (const [productId, size] of lines) items.push({ sync_variant_id: await findVariant(env, productId, size), quantity: 1 });
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
      items,
    };
    const r = await pf(env, "/orders?confirm=true", { method: "POST", body: JSON.stringify(order) });
    const out = await r.json();
    if (!r.ok) {
      const msg = JSON.stringify(out);
      if (/external_id|already/i.test(msg)) return json({ duplicate: true }); // Stripe retry of an order we already sent
      console.log("Printful order failed", r.status, msg);
      return new Response("Printful error", { status: 502 }); // Stripe retries automatically
    }
    console.log("Printful order created", out.result && out.result.id, sku, JSON.stringify(lines));
    return json({ printful_order: out.result && out.result.id });
  } catch (e) {
    console.log("Fulfilment error", String(e));
    return new Response("Error", { status: 500 });
  }
}


// Which Printful products (and size/model) one Stripe purchase turns into. Sets and bundles ship as one order.
function skuLines(sku, field) {
  const one = (k, size = "") => (SKU_TO_PRINTFUL[k] ? [SKU_TO_PRINTFUL[k], size] : null);
  let lines;
  if (sku === "orn-set") lines = ["orn-iris", "orn-helios", "orn-gilded", "orn-loop"].map((k) => one(k));
  else if (sku === "starter-bundle") {
    const p = field("painting") === "loop" ? "loop" : "iris";
    lines = [one(p + "-mug"), one("orn-" + p), one("sticker"), one("iris-sticker"), one("loop-sticker")];
  } else lines = [one(sku, field("size"))];
  return lines.every(Boolean) ? lines : null;
}

// Digital gift card: give the buyer the next unused code from the pool (created in Stripe in advance).
async function assignGiftCode(env, s, amount) {
  const have = await env.STATS.prepare("SELECT code FROM gift_codes WHERE session_id = ?").bind(s.id).first();
  if (have) return json({ gift: "already assigned" });
  const email = (s.customer_details && s.customer_details.email) || "";
  const r = await env.STATS.prepare("UPDATE gift_codes SET session_id = ?, email = ?, assigned = ? WHERE code = (SELECT code FROM gift_codes WHERE amount = ? AND session_id IS NULL LIMIT 1)")
    .bind(s.id, email, new Date().toISOString(), amount).run();
  if (!r.meta || !r.meta.changes) { console.log("GIFT POOL EMPTY", amount, s.id); return new Response("No gift codes left", { status: 500 }); }
  return json({ gift: "assigned" });
}

async function giftPage(env, sid) {
  const row = sid && /^cs_(live|test)_[A-Za-z0-9]+$/.test(sid)
    ? await env.STATS.prepare("SELECT code, amount FROM gift_codes WHERE session_id = ?").bind(sid).first() : null;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const body = row
    ? `<p class="k">GIFT CARD</p><h1>$${row.amount}</h1><p class="code">${esc(row.code)}</p>
       <p>Enter this code at checkout on <a href="/merch">aetheratelierco.com/merch</a> (tap “Add promotion code”).</p>
       <p class="s">Good for one order of any merch. Screenshot or print this page to give as a gift. Any unused balance isn't kept.</p>
       <button onclick="window.print()">Print this gift card</button>`
    : `<p class="k">GIFT CARD</p><h1>Almost ready…</h1><p>Your code is being created. This page refreshes on its own.</p><script>setTimeout(()=>location.reload(),3000)</script>`;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Your Gilt Society Gift Card</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#f0e8d6;font-family:Georgia,serif;padding:16px}
.c{max-width:520px;width:100%;border:2px solid #c4a05a;outline:1px solid #c4a05a;outline-offset:6px;padding:40px 28px;text-align:center}
.k{letter-spacing:.3em;color:#c4a05a;font-size:13px;margin:0}h1{font-size:64px;margin:8px 0 4px;color:#c4a05a}
.code{font:700 26px/1.2 ui-monospace,Menlo,monospace;letter-spacing:.08em;background:#1a1712;border:1px dashed #c4a05a;padding:14px;margin:20px 0}
a{color:#c4a05a}.s{font-size:14px;opacity:.8}button{margin-top:16px;background:#c4a05a;color:#0a0a0a;border:0;padding:12px 22px;font:600 15px Georgia,serif;cursor:pointer}
.b{font-size:22px;letter-spacing:.12em;margin-top:28px}@media print{button{display:none}}</style></head>
<body><div class="c">${body}<p class="b">GILT+ SOCIETY.</p></div></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
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

