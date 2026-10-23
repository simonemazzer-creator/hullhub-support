// HullHub 1.2 — IA. Supabase Edge Function "ai-entry".
// Modi: auto (scrivi o chiedi), doc (foto o PDF allegato: polizza, fattura, certificato…), receipt (foto scontrino/fattura), plate (foto targhetta), summary, advice, diagnose, message, translate.
// Segreto richiesto: ANTHROPIC_API_KEY (lo inserisce Simone). Verify JWT: OFF.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = "claude-haiku-5-5";
const LIMITS: Record<string, number> = { "": 10, base: 10, pro: 30, fleet: 60 };
const GLOBAL_DAY = 20000;
const MODES = ["auto", "receipt", "plate", "summary", "advice", "diagnose", "message", "translate", "manuals", "doc", "svcmap"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const TYPES = ["job", "expense", "deadline", "fuel", "issue", "service_done", "part", "gear", "engine_info"];
const ITEM = {
  type: "object",
  properties: {
    type: { type: "string", enum: TYPES },
    title: { type: "string", description: "Short title/description in the user's language" },
    area: { type: "string", description: "One of ctx.areas, exactly as written" },
    status: { type: "string", enum: ["todo", "doing", "supplier", "done"] },
    progress: { type: "number", description: "0-100, jobs only" },
    who: { type: "string", enum: ["equipaggio", "armatore", "cantiere", "fornitore"] },
    supplierId: { type: "string", description: "id from ctx.suppliers, only if clearly named" },
    supplierName: { type: "string", description: "supplier/shop name as read, if not in ctx.suppliers" },
    assigneeId: { type: "string", description: "id from ctx.crew, only if clearly named" },
    engineId: { type: "string", description: "id from ctx.engines" },
    serviceId: { type: "string", description: "id from ctx.services, for service_done" },
    date: { type: "string", description: "YYYY-MM-DD (expense/fuel/deadline/issue date or job due date)" },
    amount: { type: "number", description: "total amount in the boat currency" },
    category: { type: "string", description: "one of ctx.expenseCats, exactly" },
    liters: { type: "number" }, price: { type: "number", description: "price per liter" }, hours: { type: "number" },
    qty: { type: "number" },
    brand: { type: "string" }, model: { type: "string" }, serial: { type: "string" }, code: { type: "string", description: "part number" }, power: { type: "string" },
    issueType: { type: "string", enum: ["avaria", "controllo", "nc", "manca"] },
    severity: { type: "string", enum: ["bassa", "media", "alta", "ferma"] },
    notes: { type: "string" },
    periodFrom: { type: "string", description: "YYYY-MM-DD start of the period covered (fixed expenses like insurance, berth, storage)" },
    periodTo: { type: "string", description: "YYYY-MM-DD end of the period covered" },
  },
  required: ["type", "title"],
};
const T_ITEMS = {
  name: "proponi_righe",
  description: "Propose records to create or update in the boat app. Nothing is saved until the user confirms.",
  input_schema: { type: "object", properties: { items: { type: "array", maxItems: 6, items: ITEM }, question: { type: "string", description: "Short question back if nothing can be created, or a short warning/note shown together with the items (e.g. document already expired)" }, docTitle: { type: "string", description: "Only for an attached document: short name to file it under, e.g. \"Polizza Unipol 2026\"" }, docKind: { type: "string", enum: ["fattura", "preventivo", "certificato", "manuale", "foto", "altro"], description: "Only for an attached document: invoice/receipt=fattura, quote=preventivo, insurance policy, certificate, licence or registration=certificato" } }, required: ["items"] },
};
const T_ANSWER = {
  name: "rispondi",
  description: "Answer the user's question or request in plain text. For anything about THIS boat use only the data in the context. For general nautical, technical, maintenance or regulatory questions use your own knowledge (practical, and tell to check the manual/official source when it matters). Set needsWeb=true when a correct answer needs current or specific information: anything about a specific engine/boat/product make and model (oils, quantities, procedures, intervals, part numbers, technology), prices, recent rules, opening hours, contacts. Generic how-to questions with no specific model can be answered without web. When needsWeb, text may be a short draft.",
  input_schema: { type: "object", properties: { text: { type: "string" }, needsWeb: { type: "boolean" }, webQuery: { type: "string", description: "best web search query, if needsWeb" } }, required: ["text"] },
};

function base(ctx: Record<string, unknown>) {
  return `You are the assistant inside HullHub, a boat-management app. Today is ${ctx.today}. Always write in the language with code "${ctx.lang || "it"}" unless asked otherwise. Be concise, practical, friendly; plain text, short paragraphs or "- " bullet lists, no markdown headings, no tables.
Never invent ids: use only ids from the context. Money is in ${ctx.currency || "EUR"}.
Context (JSON, the user's boat data): ${JSON.stringify(ctx)}`;
}
const RULES_ITEMS = `Record types: job (work to do/in progress), expense (money spent), deadline (something that expires), fuel (refuelling), issue (breakdown, check, non-conformity, missing item), service_done (a periodic service from ctx.services was just done), part (spare part), gear (safety equipment), engine_info (data read for an engine in ctx.engines: brand/model/serial/power).
- area copied exactly from ctx.areas. "fatto a metà"/"half done" = progress 50 status doing; finished = status done.
- If a supplier does the work: who=fornitore (or cantiere) and status supplier unless finished.
- Resolve relative dates from today. Do not add things the user did not say.
- "Segnami da comprare X" / "buy X" / "we need X": an issue with issueType manca, title "X", qty if said (this is the shopping list). Do this even if X already exists in ctx.parts.
- If what the user asks to set up already exists in the context (e.g. services for that engine), do not duplicate it: create only the missing parts of the request and mention the rest in "question".
- If an expiry or coverage end date is before today (ctx.today), still create the items but put a clear warning in "question", e.g. "Attenzione: la polizza è scaduta il 30/04/2026." (in the user language). Same if it expires within 30 days.
- In ctx.services, a lastDate equal for all services usually means the date the plan was set up, not a real service: say so if relevant.`;

function system(mode: string, ctx: Record<string, unknown>, extra: Record<string, string>) {
  const b = base(ctx);
  switch (mode) {
    case "auto": return `${b}
The user writes or dictates a sentence. If it describes something done, bought, planned, broken, refuelled or expiring, call proponi_righe. If it is a question or a request for information/advice, call rispondi: about this boat answer from the data (say clearly when the data is not in the app); general boating questions (oils, mixtures, procedures, rules, how-to, products) answer with your knowledge, and set needsWeb when up-to-date or specific web information is needed.
${RULES_ITEMS}`;
    case "receipt": return `${b}
The image is a receipt, invoice or delivery note. Read it and call proponi_righe with ONE expense item (title = short description of what was bought, amount = total, date, category from ctx.expenseCats, supplierId if the shop matches ctx.suppliers else supplierName). If it is clearly a fuel receipt also add a fuel item with liters and price. If you cannot read it, return items=[] and a question. ${RULES_ITEMS}`;
    case "doc": return `${b}
The user attached a photo or a PDF. First understand what it is (insurance policy or certificate, invoice, receipt, quote, safety/registration/radio certificate, survey, licence, engine plate, part label, work report...).
If the user's text asks a question about it, call rispondi and answer from the document.
Otherwise call proponi_righe with the useful records, max 4, only with data actually written in the document, and always set docTitle and docKind:
- Insurance policy: ONE expense (title "Assicurazione <company>", category = the insurance category in ctx.expenseCats, amount = total premium, date = payment or issue date, periodFrom/periodTo = coverage dates) and ONE deadline (title "Scadenza assicurazione <company>", date = coverage end, notes = policy number, coverage and limits in one line).
- Any document with an expiry (certificate, licence, extinguisher or liferaft service, survey): ONE deadline with that date and the reference number in notes.
- Invoice or receipt: ONE expense (amount = total, date, category, supplier); for fuel also a fuel item. For a yearly berth/storage contract set periodFrom/periodTo.
- Quote: ONE job with status todo, supplier, and the quoted amount and items in notes.
- Engine plate or part label: engine_info or part as for a data plate.
If nothing can be read, items=[] and a short question. ${RULES_ITEMS}`;
    case "plate": return `${b}
The image is an engine/generator/equipment data plate or a spare-part label. Call proponi_righe: for an engine plate, ONE engine_info item with engineId (best match in ctx.engines, by kind and position if stated), brand, model, serial, power; for a part label, ONE part item with title, brand, code, qty 1. If unreadable, items=[] and a question. ${RULES_ITEMS}`;
    case "summary": return `${b}
Write a summary for the owner of what happened on the boat in this period: ${extra.period || "last 30 days"}. Sections as short paragraphs: works done and in progress, engine hours and services, expenses (total and main items), problems and open issues, what is coming next (deadlines, planned works). Use only the data. Call rispondi.`;
    case "advice": return `${b}
Give practical maintenance advice for this boat ${extra.focus ? "for: " + extra.focus : "for the coming weeks"}: what is overdue or due soon (services by hours or months, deadlines, safety gear), what to prepare before launch or winter storage depending on the date and the yard dates, spares to restock (qty below min). Max 8 bullets, most urgent first, each with the reason from the data. Call rispondi.`;
    case "diagnose": return `${b}
The user describes a problem on board. Act as an experienced marine mechanic: list the most likely causes (most common first), simple checks the crew can safely do, what NOT to do, and when to stop and call a technician (suggest a supplier from ctx.suppliers if one fits). Consider the engines in the context. End with one short line saying this is guidance and does not replace a qualified technician; for safety risks (fire, fuel smell, water ingress, CO) tell them to stop and call for help first. Call rispondi.`;
    case "message": return `${b}
Write a ready-to-send message (WhatsApp/email style) from the boat owner/captain to a supplier. Purpose: ${extra.purpose || "request a quote"}. Job: ${extra.job || ""}. Supplier: ${extra.supplier || ""}. Write it in the language with code "${extra.to || ctx.lang || "it"}". Polite, short, concrete (boat name, what is needed, timing). No placeholders in square brackets except the sender's name at the end if unknown. Call rispondi.`;
    case "translate": return `You translate text for a boat crew app. Translate the user's text into the language with code "${extra.to || ctx.lang || "it"}", keeping nautical terms correct and the tone of the original. Reply only via rispondi with the translation.`;
  }
  return b;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "not_configured" }, 503);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const mode = MODES.includes(body?.mode) ? body.mode : "auto";
  const text = String(body?.text || "").trim().slice(0, 4000);
  const image = typeof body?.image === "string" ? body.image : "";
  const pdf = mode === "doc" && typeof body?.pdf === "string" ? body.pdf : "";
  if (mode === "doc" && !image && !pdf) return json({ error: "no_file" }, 400);
  if (pdf && (pdf.length > 6_400_000 || !pdf.startsWith("JVBER"))) return json({ error: "pdf_bad" }, 400);
  if ((mode === "receipt" || mode === "plate") && !image) return json({ error: "no_image" }, 400);
  if (image && image.length > 2_800_000) return json({ error: "image_too_big" }, 400);
  if (["auto", "diagnose", "translate"].includes(mode) && text.length < 2) return json({ error: "bad_text" }, 400);
  const ctx = (body?.ctx && typeof body.ctx === "object") ? body.ctx : {};
  if (JSON.stringify(ctx).length > 60000) return json({ error: "ctx_too_big" }, 400);
  const extra: Record<string, string> = {};
  for (const k of ["period", "focus", "purpose", "job", "supplier", "to", "engine", "kind"]) if (body?.extra?.[k]) extra[k] = String(body.extra[k]).slice(0, 400);
  const plan = ["base", "pro", "fleet"].includes(body?.plan) ? body.plan : "";
  const device = String(body?.device || "").slice(0, 64);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let who = device ? "dev:" + device : "ip:" + (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) {
    const { data } = await admin.auth.getUser(auth.slice(7));
    if (data?.user?.id) who = "user:" + data.user.id;
  }
  const { data: lim, error: le } = await admin.rpc("ai_take", { p_key: who, p_max: LIMITS[plan] ?? 10, p_global: GLOBAL_DAY });
  if (le) return json({ error: "limit_check" }, 500);
  if (lim === false) return json({ error: "limit" }, 429);

  if (mode === "manuals") return await manuals(key, extra, ctx);
  if (mode === "svcmap") return await svcmap(key, body, ctx);
  const content: any[] = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } });
  if (pdf) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf } });
  content.push({ type: "text", text: text || (mode === "summary" ? "Riassunto" : mode === "advice" ? "Consigli" : mode === "doc" ? "Leggi il documento allegato e prepara le righe." : "Leggi l'immagine") });
  const tools = mode === "auto" || mode === "doc" ? [T_ITEMS, T_ANSWER] : (mode === "receipt" || mode === "plate") ? [T_ITEMS] : [T_ANSWER];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: mode === "doc" ? 1400 : mode === "summary" || mode === "diagnose" || mode === "advice" ? 1400 : 900,
      system: system(mode, ctx, extra), tools,
      tool_choice: tools.length === 1 ? { type: "tool", name: tools[0].name } : { type: "any" },
      messages: [{ role: "user", content }],
    }),
  });
  if (!r.ok) return json({ error: "ai_" + r.status }, 502);
  const out = await r.json();
  const use = (out.content || []).find((c: any) => c.type === "tool_use");
  if (use?.name === "rispondi") {
    if (use.input?.needsWeb && (mode === "auto" || mode === "doc")) {
      const w = await webAnswer(key, text, String(use.input?.webQuery || ""), ctx);
      if (w) return json({ text: w, items: [], web: true });
    }
    return json({ text: String(use.input?.text || "").slice(0, 6000), items: [] });
  }
  const items = Array.isArray(use?.input?.items) ? use.input.items.filter((x: any) => TYPES.includes(x?.type)).slice(0, 6) : [];
  const dk = ["fattura", "preventivo", "certificato", "manuale", "foto", "altro"].includes(use?.input?.docKind) ? use.input.docKind : "altro";
  return json({ items, question: use?.input?.question || "", docTitle: String(use?.input?.docTitle || "").slice(0, 120), docKind: dk });
});

// ---- Abbina i tagliandi del costruttore a quelli già nel piano ----
async function svcmap(key: string, body: any, ctx: Record<string, unknown>) {
  const off = (Array.isArray(body?.official) ? body.official : []).slice(0, 40).map((v: any, i: number) => ({ i, name: String(v?.name || "").slice(0, 120), everyH: +v?.everyH || 0, everyM: +v?.everyM || 0 }));
  const eid = String(body?.extra?.engineId || "");
  const mine = ((ctx.services as any[]) || []).filter((v: any) => !eid || v.engineId === eid || !v.engineId).slice(0, 80).map((v: any) => ({ id: String(v.id), name: String(v.name || "").slice(0, 120), everyH: v.everyH, everyM: v.everyM }));
  if (!off.length) return json({ pairs: [] });
  const tool = { name: "abbina", description: "Pairs of the same maintenance task", input_schema: { type: "object", properties: { pairs: { type: "array", items: { type: "object", properties: { i: { type: "number", description: "index in OFFICIAL" }, id: { type: "string", description: "id in MINE" } }, required: ["i", "id"] } } }, required: ["pairs"] } };
  const sys = `Match maintenance tasks. OFFICIAL is the manufacturer's list for one engine, MINE is the user's maintenance plan (any language). Pair an OFFICIAL item with a MINE item only when they are clearly the same task (e.g. "Water pump impeller" = "Girante pompa acqua"; "Lower unit gear oil" = "Olio piede"). Each item at most once. Do not pair different tasks. Call abbina.`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1200, system: sys, tools: [tool], tool_choice: { type: "tool", name: "abbina" }, messages: [{ role: "user", content: "OFFICIAL: " + JSON.stringify(off) + "\nMINE: " + JSON.stringify(mine) }] }),
  });
  if (!r.ok) return json({ error: "ai_" + r.status }, 502);
  const out = await r.json();
  const use = (out.content || []).find((c: any) => c.type === "tool_use");
  const ids = new Set(mine.map((m: any) => m.id));
  const usedI = new Set<number>(), usedId = new Set<string>();
  const pairs = (Array.isArray(use?.input?.pairs) ? use.input.pairs : []).filter((p: any) => {
    const i = +p?.i, id = String(p?.id || "");
    if (!(i >= 0 && i < off.length) || !ids.has(id) || usedI.has(i) || usedId.has(id)) return false;
    usedI.add(i); usedId.add(id); return true;
  }).map((p: any) => ({ i: +p.i, id: String(p.id) }));
  return json({ pairs });
}

// ---- Risposta con ricerca web (solo quando serve) ----
async function webAnswer(key: string, question: string, query: string, ctx: Record<string, unknown>) {
  const boat = { engines: ctx.engines, boat: (ctx as any).boat, lang: ctx.lang, today: ctx.today };
  const sys = `You are the assistant inside HullHub, a boat-management app. Today is ${ctx.today}. Answer the user's boating question using web search (max 3 searches), preferring official and manufacturer sources. Write in the language with code "${ctx.lang || "it"}", concise and practical, plain text with short paragraphs or "- " bullets, no markdown headings, no tables, no bold. Do not invent numbers: if sources disagree say so. At the end add a line "Fonti:" (translated) followed by up to 3 lines "- site name: https://url" of the pages you actually used. Boat context (may help): ${JSON.stringify(boat)}`;
  const user = question + (query ? `\n(search hint: ${query})` : "");
  const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }];
  let messages: any[] = [{ role: "user", content: user }];
  let txt = "";
  for (let turn = 0; turn < 3; turn++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1400, system: sys, tools, messages }),
    });
    if (!r.ok) return "";
    const out = await r.json();
    txt = (out.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    if (out.stop_reason === "pause_turn") { messages = [{ role: "user", content: user }, { role: "assistant", content: out.content }]; continue; }
    break;
  }
  return txt.replace(/\*\*/g, "").trim().slice(0, 6000);
}

// ---- Manuali ufficiali e dati di manutenzione (ricerca web) ----
async function manuals(key: string, extra: Record<string, string>, ctx: Record<string, unknown>) {
  const sys = `You find OFFICIAL documentation for a marine engine/drive/generator: owner's or operator's manual, maintenance schedule, service/parts list, published by the manufacturer (or an official dealer). Use web search (max 4 searches). Prefer direct PDF links on the manufacturer's domain. Never use piracy or "free manual download" aggregator sites.
Then reply with ONLY a JSON object, no other text:
{"docs":[{"title":"...","url":"https://...","kind":"manual|maintenance|parts|other","lang":"en","pdf":true}],
 "data":{"oil":{"type":"e.g. SAE 15W-40 API CI-4","qty":"e.g. 18 l with filter"},"coolant":"","filters":[{"name":"oil filter","code":"..."}],"impeller":"","belts":"","services":[{"name":"Engine oil and filter","everyH":250,"everyM":12}],"notes":"short notes"}}
Only include data you actually read in the sources; leave fields empty otherwise. Write titles and names in the language with code "${ctx.lang || "it"}" (keep part codes as they are). Max 5 docs.`;
  const user = `Engine: ${extra.engine || ""}. Type: ${extra.kind || ""}.`;
  const tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }];
  let messages: any[] = [{ role: "user", content: user }];
  const seen = new Set<string>();
  let finalText = "";
  for (const model of [MODEL, "claude-sonnet-5-5"]) {
    messages = [{ role: "user", content: user }]; finalText = ""; let ok = true;
    for (let turn = 0; turn < 4; turn++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 1800, system: sys, tools, messages }),
      });
      if (!r.ok) { ok = false; break; }
      const out = await r.json();
      for (const c of out.content || []) {
        if (c.type === "web_search_tool_result" && Array.isArray(c.content)) for (const x of c.content) if (x?.url) seen.add(String(x.url));
        if (c.type === "text") { finalText += c.text; for (const ct of c.citations || []) if (ct?.url) seen.add(String(ct.url)); }
      }
      if (out.stop_reason === "pause_turn") { messages = [{ role: "user", content: user }, { role: "assistant", content: out.content }]; continue; }
      break;
    }
    if (ok && finalText) break;
  }
  const m = finalText.match(/\{[\s\S]*\}/);
  let j: any = {};
  try { j = m ? JSON.parse(m[0]) : {}; } catch { j = {}; }
  const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } };
  const seenHosts = new Set([...seen].map(host));
  const docs = (Array.isArray(j.docs) ? j.docs : []).filter((d: any) => typeof d?.url === "string" && /^https:\/\//.test(d.url) && (seen.has(d.url) || seenHosts.has(host(d.url)))).slice(0, 5)
    .map((d: any) => ({ title: String(d.title || "").slice(0, 160), url: d.url, kind: String(d.kind || "other"), lang: String(d.lang || ""), pdf: !!d.pdf || /\.pdf($|\?)/i.test(d.url), host: host(d.url) }));
  return json({ docs, data: j.data && typeof j.data === "object" ? j.data : {}, items: [] });
}

// Il PDF lo scarica l'app direttamente dal sito del costruttore (CapacitorHttp) e lo salva solo sul telefono.
