// Ozon color-swatch updater (runs as a Railway Function, Bun).
// MODE: "scan" = list article codes (WL_<code> or part before first "_") matching SCAN regex (default P17) + counts and color numbers;
//       "dry"  = read & log backup/plan; "one" = update ONLY_OFFER; "all" = update every matched card.
// JOBS: "PREFIX=series;..." e.g. "SilCaseiP17CP_=sc17cp" — article must start with PREFIX (ending with "_" keeps models apart).
// Per card: ozon/<series>/swatch/<n>.jpg -> color image; ozon/<series>/main/<n>.jpg (if exists) -> replaces the old main photo (old one removed).
const MODE: string = Bun.env.MODE ?? "dry";
const JOBS: [string, string][] = (Bun.env.JOBS ?? "SilCaseiP17CP_=sc17cp").split(";").filter(Boolean).map(j => j.split("=") as [string, string]);
const ONLY_OFFER = Bun.env.ONLY_OFFER ?? "";
const RAW = "https://raw.githubusercontent.com/erekkali/maksot-images/main/ozon/";

const H = { "Client-Id": Bun.env.OZON_CLIENT_ID ?? "", "Api-Key": Bun.env.OZON_API_KEY ?? "", "Content-Type": "application/json" };
if (!H["Client-Id"] || !H["Api-Key"]) { console.log("NO_KEYS"); process.exit(0); }

async function api(path: string, body: unknown) {
  const r = await fetch("https://api-seller.ozon.ru" + path, { method: "POST", headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} ${r.status} ${t.slice(0, 500)}`);
  return JSON.parse(t);
}

const all: { product_id: number; offer_id: string }[] = [];
for (const vis of ["ALL", "ARCHIVED"]) {
  let last_id = "";
  for (;;) {
    const j = await api("/v3/product/list", { filter: { visibility: vis }, last_id, limit: 1000 });
    const items = j.result?.items ?? [];
    for (const it of items) all.push({ product_id: it.product_id, offer_id: String(it.offer_id) });
    last_id = j.result?.last_id ?? "";
    if (!items.length || !last_id) break;
  }
}
const products = [...new Map(all.map(x => [x.product_id, x])).values()];
const code = (o: string) => { const a = o.split("_"); return a[0] === "WL" ? a[0] + "_" + a[1] : a[0]; };
const SCAN = new RegExp(Bun.env.SCAN ?? "P17", "i");

if (MODE === "scan") {
  const m = new Map<string, string[]>();
  for (const p of products) if (SCAN.test(p.offer_id)) { const c = code(p.offer_id); m.set(c, [...(m.get(c) ?? []), p.offer_id]); }
  for (const [c, offs] of [...m.entries()].sort()) console.log(`CODE ${c} count=${offs.length} nums=${[...new Set(offs.map(o => o.split("_").pop()))].sort((a, b) => +a - +b).join(",")}`);
  console.log("DONE scan");
  process.exit(0);
}

const exists = new Map<string, boolean>();
async function has(url: string) {
  if (!exists.has(url)) exists.set(url, (await fetch(url, { method: "HEAD" })).ok);
  return exists.get(url)!;
}

let updated = 0;
const failed: string[] = [], stuck: string[] = [];
for (const [CODE, SERIES] of JOBS) {
  const sel = products.filter(p => p.offer_id.startsWith(CODE));
  console.log(`JOB ${CODE} -> ${SERIES}: FOUND ${sel.length} mode=${MODE} only=${ONLY_OFFER}`);
  const info: any[] = [];
  for (let i = 0; i < sel.length; i += 100) {
    const j = await api("/v3/product/info/list", { product_id: sel.slice(i, i + 100).map(x => x.product_id) });
    info.push(...(j.items ?? j.result?.items ?? []));
  }
  for (const p of info) {
    const offer = String(p.offer_id);
    const num = offer.split("_").pop() ?? "";
    const primary: string[] = Array.isArray(p.primary_image) ? p.primary_image : (p.primary_image ? [p.primary_image] : []);
    const images: string[] = p.images ?? [];
    const color: string[] = Array.isArray(p.color_image) ? p.color_image : (p.color_image ? [p.color_image] : []);
    const i360: string[] = p.images360 ?? [];
    console.log("BACKUP " + JSON.stringify({ id: p.id, offer, num, archived: p.is_archived, autoarchived: p.is_autoarchived, status: p.statuses?.status_name ?? p.statuses?.status, primary, images, color, i360 }));
    if ([...primary, ...color].some(u => u.includes("githubusercontent"))) { stuck.push(offer); console.log(`STUCK ${offer}: Ozon has not re-hosted our image yet`); }
    const sw = `${RAW}${SERIES}/swatch/${num}.jpg`, mainUrl = `${RAW}${SERIES}/main/${num}.jpg`;
    const okNum = /^\d+$/.test(num);
    const hasSw = okNum && await has(sw), hasMain = okNum && await has(mainUrl);
    if (!hasSw && !hasMain) { console.log(`SKIP ${offer}: no files for number ${num}`); continue; }
    const rest = images.filter(u => !primary.includes(u));
    const pics = hasMain ? [mainUrl, ...rest] : [...primary, ...rest];
    const colorImg = hasSw ? sw : (color[0] ?? "");
    const doIt = MODE === "all" || (MODE === "one" && offer === ONLY_OFFER);
    console.log(`${doIt ? "APPLY" : "PLAN"} ${offer}: main=${hasMain ? "NEW (old removed: " + (primary[0] ?? "-") + ")" : "keep"} swatch=${hasSw ? "NEW" : "keep"} photos=${pics.length}`);
    if (!doIt) continue;
    try {
      const res = await api("/v1/product/pictures/import", { product_id: p.id, images: pics, color_image: colorImg, images360: i360 });
      const bad = (res.result?.pictures ?? []).filter((x: any) => x.state && x.state !== "imported" && x.state !== "pending");
      console.log(`RESULT ${offer} pictures=${res.result?.pictures?.length ?? 0} bad=${JSON.stringify(bad).slice(0, 300)}`);
      updated++;
    } catch (e) { failed.push(offer); console.log(`FAIL ${offer}: ${String(e).slice(0, 300)}`); }
    await Bun.sleep(400);
  }
}
console.log(`DONE mode=${MODE} updated=${updated} failed=${failed.length} ${failed.join(",")} stuck=${stuck.length} ${stuck.join(",")}`);
