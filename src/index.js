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
};

export default {
  async scheduled(event, env, ctx) {
    const log = (st, n) => env.STATS.prepare("INSERT INTO jobs (item, status, note, updated) VALUES (?,?,?,?) ON CONFLICT(item) DO UPDATE SET status=excluded.status, note=excluded.note, updated=excluded.updated").bind("_run", st, n, new Date().toISOString()).run();
    ctx.waitUntil(log("start", "gifts").then(() => runGiftJob(env)).then(() => log("ok", "gifts")).catch((e) => log("error", String((e && e.stack) || e).slice(0, 500))));
  },
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

// TEMPORARY: create the Gilded Gifts products (ornaments + phone cases) in Printful and save photos; removed after use.
const RAW_G = "https://raw.githubusercontent.com/savagexartllc-ux/aether-atelier/main/print-files/gifts/";
const CASE_VARIANTS = [15388, 15390, 15391, 15389, 16124, 16128, 16126, 16130, 17714, 17716, 17718, 17720, 20302, 20303, 20304, 20305, 33985, 33986, 33987, 33988, 52384, 52386];
const GIFT_ITEMS = [
  { key: "orn-iris", name: "Gilt Society Ornament · Iris", product: 881, variants: [22782], photo: 22782, file: "orn-iris.jpg", w: 1800, h: 1800, price: "24.00" },
  { key: "orn-helios", name: "Gilt Society Ornament · Helios Rising", product: 881, variants: [22782], photo: 22782, file: "orn-helios.jpg", w: 1800, h: 1800, price: "24.00" },
  { key: "orn-gilded", name: "Gilt Society Ornament · Gilded Rain", product: 881, variants: [22782], photo: 22782, file: "orn-gilded.jpg", w: 1800, h: 1800, price: "24.00" },
  { key: "orn-loop", name: "Gilt Society Ornament · The Loop Theory", product: 881, variants: [22782], photo: 22782, file: "orn-loop.jpg", w: 1800, h: 1800, price: "24.00" },
  { key: "case-iris", name: "Gilt Society iPhone Case · Iris", product: 601, variants: CASE_VARIANTS, photo: 20304, file: "case-iris.jpg", w: 1000, h: 2000, price: "38.00" },
  { key: "case-loop", name: "Gilt Society iPhone Case · The Loop Theory", product: 601, variants: CASE_VARIANTS, photo: 20304, file: "case-loop.jpg", w: 1000, h: 2000, price: "38.00" },
];
function coverPos(pr, w, h) {
  const sc = Math.max(pr.width / w, pr.height / h);
  const W = Math.round(w * sc), H = Math.round(h * sc);
  return { area_width: pr.width, area_height: pr.height, width: W, height: H, top: Math.round((pr.height - H) / 2), left: Math.round((pr.width - W) / 2) };
}
async function runGiftJob(env) {
  const rows = ((await env.STATS.prepare("SELECT item, status, product_id FROM jobs").all()).results || []);
  const st = Object.fromEntries(rows.map((r) => [r.item, r]));
  const it = GIFT_ITEMS.find((x) => !st[x.key] || st[x.key].status !== "done");
  if (!it) return;
  const note = async (status, extra = {}) =>
    env.STATS.prepare("INSERT INTO jobs (item, status, product_id, photos, note, updated) VALUES (?,?,?,?,?,?) ON CONFLICT(item) DO UPDATE SET status=excluded.status, product_id=COALESCE(excluded.product_id, jobs.product_id), photos=COALESCE(excluded.photos, jobs.photos), note=excluded.note, updated=excluded.updated")
      .bind(it.key, status, extra.id ? String(extra.id) : null, extra.photos || null, extra.note || null, new Date().toISOString()).run();
  const pfs = (await (await pf(env, "/mockup-generator/printfiles/" + it.product)).json()).result;
  const placeFor = (vid) => {
    const vp = (pfs.variant_printfiles.find((x) => x.variant_id == vid) || {}).placements || {};
    const pl = vp.front ? "front" : vp.default ? "default" : Object.keys(vp)[0];
    return { pl, pr: pfs.printfiles.find((p) => p.printfile_id == vp[pl]) };
  };
  let cur = st[it.key];
  if (!cur || !cur.product_id) {
    const mk = (withPos) => ({ sync_product: { name: it.name }, sync_variants: it.variants.map((vid) => {
      const { pl, pr } = placeFor(vid);
      const f = { type: pl === "front" ? "front" : "default", url: RAW_G + it.file };
      if (withPos && pr) f.position = coverPos(pr, it.w, it.h);
      return { variant_id: vid, retail_price: it.price, files: [f] };
    }) });
    let cr = await (await pf(env, "/store/products", { method: "POST", body: JSON.stringify(mk(true)) })).json();
    let how = "position";
    if (!cr.result) { const first = JSON.stringify(cr).slice(0, 200); cr = await (await pf(env, "/store/products", { method: "POST", body: JSON.stringify(mk(false)) })).json(); how = "plain (" + first + ")"; }
    if (!cr.result) { await note("error", { note: JSON.stringify(cr).slice(0, 400) }); return; }
    await note("created", { id: cr.result.id, note: how });
    cur = { product_id: cr.result.id };
  }
  const { pl, pr } = placeFor(it.photo);
  const files = [{ placement: pl, image_url: RAW_G + it.file, position: coverPos(pr, it.w, it.h) }];
  const t = await (await pf(env, "/mockup-generator/create-task/" + it.product, { method: "POST", body: JSON.stringify({ variant_ids: [it.photo], format: "jpg", files }) })).json();
  if (!t.result) { await note("error", { note: "mockup " + JSON.stringify(t).slice(0, 300) }); return; }
  let res;
  for (let i = 0; i < 14; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    res = (await (await pf(env, "/mockup-generator/task?task_key=" + t.result.task_key)).json()).result;
    if (res && res.status !== "pending") break;
  }
  const shots = res && res.mockups ? res.mockups.flatMap((m) => [{ u: m.mockup_url, t: m.placement }, ...(m.extra || []).map((e) => ({ u: e.url, t: e.title || e.option }))]) : [];
  if (!shots.length) { await note("error", { note: "no mockups " + JSON.stringify(res || {}).slice(0, 300) }); return; }
  const saved = [];
  for (let i = 0; i < shots.length && i < 6; i++) {
    const b = await (await fetch(shots[i].u)).arrayBuffer();
    const n = it.key + "-" + (i + 1) + ".jpg";
    await env.MERCH_PHOTOS.put(n, b, { metadata: { type: "image/jpeg" } });
    saved.push(n + "|" + shots[i].t);
  }
  await note("done", { photos: saved.join(","), note: JSON.stringify({ pl, w: pr.width, h: pr.height }) });
}
