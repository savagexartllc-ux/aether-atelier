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
};

export default {
  async scheduled(event, env, ctx) {
    const log = (st, n) => env.STATS.prepare("INSERT INTO jobs (item, status, note, updated) VALUES (?,?,?,?) ON CONFLICT(item) DO UPDATE SET status=excluded.status, note=excluded.note, updated=excluded.updated").bind("_run", st, n, new Date().toISOString()).run();
    ctx.waitUntil(log("start", "").then(() => runArtJob(env)).then(() => runHomeJob(env)).then(() => log("ok", "")).catch((e) => log("error", String((e && e.stack) || e).slice(0, 500))));
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

// TEMPORARY: full-back Loop Theory print on tee + hoodie and refresh photos; removed after use.
const RAW_B = "https://raw.githubusercontent.com/savagexartllc-ux/aether-atelier/main/print-files/b/";
const ART_ITEMS = [
  { key: "loop-tee", id: 493877391, from: 488796343, files: { back: "gs-the-loop-theory-back-v3.png", "*": "gs2-chest-dark-full.png" }, swap: ["back"] },
  { key: "loop-hoodie", id: 493876096, from: 488799954, files: { back: "gs-the-loop-theory-back-v3.png", "*": "gs2-chest-dark-full.png" }, swap: ["back"] },
];
async function runArtJob(env) {
  const dims = await env.STATS.prepare("SELECT status FROM jobs WHERE item = 'dims'").first();
  if (!dims) {
    const out = {};
    for (const id of [924, 279, 395, 1737, 963]) out[id] = (await (await pf(env, "/mockup-generator/printfiles/" + id)).json()).result;
    await env.STATS.prepare("INSERT INTO jobs (item, status, photos, updated) VALUES ('dims','done',?,?)").bind(JSON.stringify(out), new Date().toISOString()).run();
  }
  const done = new Set(((await env.STATS.prepare("SELECT item FROM jobs WHERE status = 'done'").all()).results || []).map((r) => r.item));
  const it = ART_ITEMS.find((x) => !done.has(x.key));
  if (!it) return;
  const note = async (status, extra = {}) =>
    env.STATS.prepare("INSERT INTO jobs (item, status, product_id, photos, note, updated) VALUES (?,?,?,?,?,?) ON CONFLICT(item) DO UPDATE SET status=excluded.status, product_id=COALESCE(excluded.product_id, jobs.product_id), photos=COALESCE(excluded.photos, jobs.photos), note=excluded.note, updated=excluded.updated")
      .bind(it.key, status, extra.id ? String(extra.id) : null, extra.photos || null, extra.note || null, new Date().toISOString()).run();
  const fileFor = (type) => RAW_B + (it.files[type] || it.files["*"]);
  const src = (await (await pf(env, "/store/products/" + it.from)).json()).result;
  const prod = { id: it.id };
  const cur = await (await env.STATS.prepare("SELECT status FROM jobs WHERE item = ?").bind(it.key).first()) || {};
  if (cur.status !== "updated") {
    const mine = (await (await pf(env, "/store/products/" + it.id)).json()).result;
    const swaps = (t) => it.swap.includes(t) || (it.swap.includes("*") && !it.files[t]);
    for (const v of mine.sync_variants) {
      const files = v.files.filter((f) => f.type !== "preview").map((f) => (swaps(f.type) ? { type: f.type, url: fileFor(f.type) } : { type: f.type, id: f.id }));
      const r = await (await pf(env, "/store/variants/" + v.id, { method: "PUT", body: JSON.stringify({ files }) })).json();
      if (!r.result) { await note("error", { id: it.id, note: "variant " + v.id + " " + JSON.stringify(r).slice(0, 300) }); return; }
    }
    await note("updated", { id: it.id });
    return; // mockups on the next run
  }
  const v0 = src.sync_variants[0];
  const pid = v0.product.product_id, vid = v0.product.variant_id;
  const pfs = (await (await pf(env, "/mockup-generator/printfiles/" + pid)).json()).result;
  const vp = pfs.variant_printfiles.find((x) => x.variant_id == vid).placements;
  const files = v0.files.filter((f) => f.type !== "preview").map((f) => {
    const pl = f.type === "default" ? (vp.front ? "front" : Object.keys(vp)[0]) : f.type;
    const pr = pfs.printfiles.find((p) => p.printfile_id == vp[pl]);
    return { placement: pl, image_url: fileFor(f.type), position: { area_width: pr.width, area_height: pr.height, width: pr.width, height: pr.height, top: 0, left: 0 } };
  });
  const t = await (await pf(env, "/mockup-generator/create-task/" + pid, { method: "POST", body: JSON.stringify({ variant_ids: [vid], format: "jpg", files }) })).json();
  if (!t.result) { await note("error", { id: prod.id, note: "mockup " + JSON.stringify(t).slice(0, 300) }); return; }
  let res;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    res = (await (await pf(env, "/mockup-generator/task?task_key=" + t.result.task_key)).json()).result;
    if (res && res.status !== "pending") break;
  }
  const shots = res && res.mockups ? res.mockups.flatMap((m) => [{ u: m.mockup_url, t: m.placement }, ...(m.extra || []).map((e) => ({ u: e.url, t: e.title || e.option }))]) : [];
  if (!shots.length) { await note("error", { id: prod.id, note: "no mockups " + JSON.stringify(res || {}).slice(0, 300) }); return; }
  const saved = [];
  for (let i = 0; i < shots.length && i < 6; i++) {
    const b = await (await fetch(shots[i].u)).arrayBuffer();
    const n = it.key + "-" + (i + 1) + ".jpg";
    await env.MERCH_PHOTOS.put(n, b, { metadata: { type: "image/jpeg" } });
    saved.push(n + "|" + shots[i].t + "|" + shots[i].u);
  }
  await note("done", { id: prod.id, photos: saved.join(",") });
}

// TEMPORARY: create the home + backpack collection in Printful and save photos; removed after use.
const RAW_H = "https://raw.githubusercontent.com/savagexartllc-ux/aether-atelier/main/print-files/home/";
const HOME_ITEMS = [
  { key: "helios-rug", name: "Helios Rising Area Rug 3x5", product: 924, variant: 23703, price: "149.00", files: { default: "helios-rising-rug-36x60.jpg" } },
  { key: "iris-rug", name: "Iris Area Rug 5x3", product: 924, variant: 23706, price: "149.00", files: { default: "iris-rug-60x36-v2.jpg" } },
  { key: "gilded-rug", name: "Gilded Rain Area Rug 3x5", product: 924, variant: 23703, price: "149.00", files: { default: "gilded-rain-rug-36x60.jpg" } },
  { key: "iris-blanket", name: "Iris Throw Blanket 50x60", product: 395, variant: 10986, price: "79.00", files: { default: "iris-blanket-50x60-v2.jpg" } },
  { key: "loop-blanket", name: "The Loop Theory Throw Blanket 50x60", product: 395, variant: 10986, price: "79.00", files: { default: "loop-blanket-50x60.jpg" } },
  { key: "gilded-blanket", name: "Gilded Rain Throw Blanket 50x60", product: 395, variant: 10986, price: "79.00", files: { default: "gilded-rain-blanket-50x60.jpg" } },
  { key: "iris-backpack", name: "Iris Backpack", product: 279, variant: 9063, price: "89.00", files: { default: "iris-backpack-front.jpg", top: "iris-backpack-top.jpg", bottom: "iris-backpack-bottom.jpg", pocket: "iris-backpack-pocket.jpg" } },
  { key: "loop-backpack", name: "The Loop Theory Backpack", product: 279, variant: 9063, price: "89.00", files: { default: "loop-backpack-front.jpg", top: "loop-backpack-top.jpg", bottom: "loop-backpack-bottom.jpg", pocket: "loop-backpack-pocket.jpg" } },
  { key: "iris-curtain", name: "Iris Blackout Curtain Panel", product: 1737, variant: 54570, price: "99.00", files: { default: "iris-curtain-50x84.jpg" } },
  { key: "loop-curtain", name: "The Loop Theory Blackout Curtain Panel", product: 1737, variant: 54570, price: "99.00", files: { default: "loop-curtain-50x84.jpg" } },
  { key: "gilded-curtain", name: "Gilded Rain Blackout Curtain Panel", product: 1737, variant: 54570, price: "99.00", files: { default: "gilded-rain-curtain-50x84.jpg" } },
];
async function runHomeJob(env) {
  const rows = ((await env.STATS.prepare("SELECT item, status, product_id FROM jobs").all()).results || []);
  const st = Object.fromEntries(rows.map((r) => [r.item, r]));
  const it = HOME_ITEMS.find((x) => !st[x.key] || st[x.key].status !== "done");
  if (!it) return;
  const note = async (status, extra = {}) =>
    env.STATS.prepare("INSERT INTO jobs (item, status, product_id, photos, note, updated) VALUES (?,?,?,?,?,?) ON CONFLICT(item) DO UPDATE SET status=excluded.status, product_id=COALESCE(excluded.product_id, jobs.product_id), photos=COALESCE(excluded.photos, jobs.photos), note=excluded.note, updated=excluded.updated")
      .bind(it.key, status, extra.id ? String(extra.id) : null, extra.photos || null, extra.note || null, new Date().toISOString()).run();
  const cur = st[it.key];
  if (!cur || !cur.product_id) {
    const body = { sync_product: { name: it.name }, sync_variants: [{ variant_id: it.variant, retail_price: it.price, files: Object.entries(it.files).map(([type, f]) => ({ type, url: RAW_H + f })) }] };
    const cr = await (await pf(env, "/store/products", { method: "POST", body: JSON.stringify(body) })).json();
    if (!cr.result) { await note("error", { note: JSON.stringify(cr).slice(0, 400) }); return; }
    await note("created", { id: cr.result.id });
    return;
  }
  const mine = (await (await pf(env, "/store/products/" + cur.product_id)).json()).result;
  for (const v of (mine && mine.sync_variants) || []) {
    await pf(env, "/store/variants/" + v.id, { method: "PUT", body: JSON.stringify({ files: Object.entries(it.files).map(([type, f]) => ({ type, url: RAW_H + f })) }) });
  }
  const pfs = (await (await pf(env, "/mockup-generator/printfiles/" + it.product)).json()).result;
  const vp = pfs.variant_printfiles.find((x) => x.variant_id == it.variant).placements;
  const files = Object.entries(it.files).map(([type, f]) => {
    const pl = type === "default" ? (vp.front ? "front" : Object.keys(vp)[0]) : type;
    const pr = pfs.printfiles.find((p) => p.printfile_id == vp[pl]);
    return { placement: pl, image_url: RAW_H + f, position: { area_width: pr.width, area_height: pr.height, width: pr.width, height: pr.height, top: 0, left: 0 } };
  });
  const t = await (await pf(env, "/mockup-generator/create-task/" + it.product, { method: "POST", body: JSON.stringify({ variant_ids: [it.variant], format: "jpg", files }) })).json();
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
  for (let i = 0; i < shots.length && i < 8; i++) {
    const b = await (await fetch(shots[i].u)).arrayBuffer();
    const n = it.key + "-" + (i + 1) + ".jpg";
    await env.MERCH_PHOTOS.put(n, b, { metadata: { type: "image/jpeg" } });
    saved.push(n + "|" + shots[i].t + "|" + shots[i].u);
  }
  await note("done", { photos: saved.join(",") });
}
