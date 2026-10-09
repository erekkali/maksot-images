// Ozon color-swatch updater (runs as a Railway Function, Bun).
// MODE: "dry" = only read & log backup/plan; "one" = update ONLY_OFFER; "all" = update every matched card.
const MODE: string = Bun.env.MODE ?? "dry";
const PREFIX = Bun.env.PREFIX ?? "SilCaseiP17CP_";
const SERIES = Bun.env.SERIES ?? "sc17cp";
const ONLY_OFFER = Bun.env.ONLY_OFFER ?? "";
const BASE = `https://raw.githubusercontent.com/erekkali/maksot-images/main/ozon/${SERIES}/swatch/`;
const AVAILABLE = ["4","5","7","8","9","11","14","15","17","18","19","20","21","41","44","45","47","48","49","52","66","68"];

const H = { "Client-Id": Bun.env.OZON_CLIENT_ID ?? "", "Api-Key": Bun.env.OZON_API_KEY ?? "", "Content-Type": "application/json" };
if (!H["Client-Id"] || !H["Api-Key"]) { console.log("NO_KEYS"); process.exit(0); }

async function api(path: string, body: unknown) {
  const r = await fetch("https://api-seller.ozon.ru" + path, { method: "POST", headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 500)}`);
  return JSON.parse(t);
}

// 1. all products with the prefix
const ids: { product_id: number; offer_id: string }[] = [];
for (const vis of ["ALL", "ARCHIVED"]) {
  let last_id = "";
  for (;;) {
    const j = await api("/v3/product/list", { filter: { visibility: vis }, last_id, limit: 1000 });
    const items = j.result?.items ?? [];
    for (const it of items) if (String(it.offer_id).startsWith(PREFIX)) ids.push({ product_id: it.product_id, offer_id: it.offer_id });
    last_id = j.result?.last_id ?? "";
    if (!items.length || !last_id) break;
  }
}
const uniq = [...new Map(ids.map(x => [x.product_id, x])).values()];
console.log(`FOUND ${uniq.length} products with prefix ${PREFIX}`);

// 2. details
const info: any[] = [];
for (let i = 0; i < uniq.length; i += 100) {
  const j = await api("/v3/product/info/list", { product_id: uniq.slice(i, i + 100).map(x => x.product_id) });
  info.push(...(j.items ?? j.result?.items ?? []));
}
if (info[0]) console.log("SAMPLE_KEYS " + Object.keys(info[0]).join(","));

let updated = 0;
for (const p of info) {
  const offer = String(p.offer_id);
  const num = offer.split("_").pop() ?? "";
  const primary: string[] = Array.isArray(p.primary_image) ? p.primary_image : (p.primary_image ? [p.primary_image] : []);
  const images: string[] = p.images ?? [];
  const color: string[] = Array.isArray(p.color_image) ? p.color_image : (p.color_image ? [p.color_image] : []);
  const i360: string[] = p.images360 ?? [];
  const target = AVAILABLE.includes(num) ? BASE + num + ".jpg" : "";
  console.log("BACKUP " + JSON.stringify({ id: p.id, offer, num, primary, images, color, i360 }));
  if (!target) { console.log(`SKIP ${offer}: no swatch for number ${num}`); continue; }
  if (color.includes(target)) { console.log(`OK_ALREADY ${offer}`); continue; }
  const all = [...primary, ...images.filter(u => !primary.includes(u))];
  const doIt = MODE === "all" || (MODE === "one" && offer === ONLY_OFFER);
  console.log(`PLAN ${offer} -> ${target} (keeps ${all.length} photos, first=${all[0] ?? "-"}) ${doIt ? "APPLY" : "dry"}`);
  if (!doIt) continue;
  const res = await api("/v1/product/pictures/import", { product_id: p.id, images: all, color_image: target, images360: i360 });
  console.log("RESULT " + offer + " " + JSON.stringify(res).slice(0, 600));
  updated++;
  await Bun.sleep(400);
}
console.log(`DONE mode=${MODE} updated=${updated}`);
