#!/usr/bin/env node
/* ---------------------------------------------------------------
   Static file server plus the gear lookup service.

   The browser can't fetch manufacturer sites directly — cross-origin rules
   block it — so the lookup runs here instead. It searches, pulls the two or
   three most promising pages, strips them to text, and hands that to the same
   inference engine the browser uses. If the search or the fetches fail, the
   engine still runs on the garment name alone, so the button always returns
   something and always says where the numbers came from.

     node server.js [port]
----------------------------------------------------------------*/

const http = require("http");
const fs = require("fs");
const path = require("path");
const {inferGarment} = require("./insulation.js");

const PORT = +(process.argv[2] || process.env.PORT || 8765);
// Behind a reverse proxy, bind to the loopback so the Node process isn't
// reachable from outside on its own — see INSTALL.md.
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;

/* Where the synced copy of the gear list and ride history lives.

   Deliberately NOT inside the app directory by default under systemd: the unit
   mounts that read-only, which is worth keeping. StateDirectory= hands the
   service a writable /var/lib/cycling-weather-matrix and the unit points
   STATE_DIR at it. Locally it falls back to alongside the app, which is what
   you want when running it by hand.

   Nothing here is servable as a static file — the allow-list below admits no
   .json at all — so state.json cannot be fetched over HTTP by accident. */
const STATE_DIR = process.env.STATE_DIR || __dirname;
const STATE_FILE = path.join(STATE_DIR, "state.json");
const STATE_PREV = path.join(STATE_DIR, "state.prev.json");
const STATE_MAX_BYTES = 4 * 1024 * 1024;

/* The lookup endpoint makes outbound requests on someone else's behalf, which
   is worth a limit before it faces a network. A handful per minute is far more
   than a person editing their wardrobe will ever need. */
const RATE = {max: +(process.env.LOOKUP_RATE || 12), windowMs: 60_000, hits: new Map()};
function rateLimited(ip){
  const now = Date.now();
  const seen = (RATE.hits.get(ip) || []).filter(t => now - t < RATE.windowMs);
  if (seen.length >= RATE.max){ RATE.hits.set(ip, seen); return true; }
  seen.push(now);
  RATE.hits.set(ip, seen);
  if (RATE.hits.size > 5000) RATE.hits.clear();   // crude, but this is one process
  return false;
}
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
           "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const MIME = {
  ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8",
  ".svg":"image/svg+xml", ".ico":"image/x-icon"
};

/* --- Fetching --------------------------------------------------- */

async function get(url, timeoutMs = 8000){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try{
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {"user-agent": UA, "accept-language": "en-GB,en;q=0.9"}
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "";
    if (!/text\/html|text\/plain/.test(type)) return null;
    return await res.text();
  }catch(e){
    return null;
  }finally{ clearTimeout(t); }
}

/* DuckDuckGo's lightweight endpoints tolerate a plain server-side GET where
   the major engines block it. Two shapes, because either can go down. */
async function search(query){
  const q = encodeURIComponent(query);
  const endpoints = [
    `https://lite.duckduckgo.com/lite/?q=${q}`,
    `https://html.duckduckgo.com/html/?q=${q}`
  ];
  for (const url of endpoints){
    const html = await get(url);
    if (!html) continue;
    const links = [];
    // Results are wrapped in a redirect: /l/?uddg=<encoded target>
    const re = /uddg=([^"&]+)/g;
    let m;
    while ((m = re.exec(html)) !== null && links.length < 12){
      try{
        const target = decodeURIComponent(m[1]);
        if (/^https?:\/\//.test(target) && !links.includes(target)) links.push(target);
      }catch(e){}
    }
    if (links.length) return links;
  }
  return [];
}

/* Prefer the maker's own site and the retailers that publish spec tables;
   skip marketplaces and forums, which quote nothing useful. */
const SKIP = /(ebay|amazon|aliexpress|pinterest|facebook|instagram|reddit|youtube|marktplaats|vinted)\./i;
const PREFER = /(castelli|assos|rapha|gore|sportful|endura|pearlizumi|gripgrab|bioracer|agu|santini|maap|velocio|wiggle|sigmasports|bike24|bike-components|competitivecyclist|cyclingtips|road\.cc|bikeradar)/i;

function rank(urls){
  return urls.slice().sort((a, b) => (PREFER.test(b) ? 1 : 0) - (PREFER.test(a) ? 1 : 0))
             .filter(u => !SKIP.test(u));
}

function toText(html){
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&deg;/gi, "°").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/\s+/g, " ")
    .trim();
}

async function lookup(name, slot){
  const sources = [];
  let text = "";
  let searchWorked = false;

  const urls = rank(await search(`${name} cycling temperature range fabric`));
  if (urls.length){
    searchWorked = true;
    for (const url of urls.slice(0, 3)){
      const html = await get(url);
      if (!html) continue;
      const t = toText(html).slice(0, 40000);
      if (t.length < 400) continue;
      text += " " + t;
      sources.push(url);
      if (text.length > 60000) break;
    }
  }

  const result = inferGarment({name, slot, text});
  result.sources = sources;
  result.source = sources.length ? "web" : (searchWorked ? "inference (pages unreadable)" : "inference (search unavailable)");
  if (!sources.length){
    result.confidence = result.confidence === "high" ? "medium" : result.confidence;
    result.evidence.push("No page could be read, so these are derived from the garment name and fabric words alone — check them against how the garment actually wears.");
  }
  return result;
}

/* --- Synced state ------------------------------------------------
   One document, written whole. Small enough that rewriting it costs nothing,
   and simple enough that a backup is a file copy. */

function readState(){
  try{ return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch(e){ return null; }
}

/* Temp file then rename, because a crash halfway through a write would
   otherwise leave truncated JSON where the gear list used to be. The previous
   version is kept alongside as the cheapest possible insurance. */
function writeState(doc){
  const text = JSON.stringify(doc);
  if (Buffer.byteLength(text) > STATE_MAX_BYTES) throw new Error("state too large");
  fs.mkdirSync(STATE_DIR, {recursive: true});
  try{ if (fs.existsSync(STATE_FILE)) fs.copyFileSync(STATE_FILE, STATE_PREV); }catch(e){}
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, STATE_FILE);
}

function readBody(req, limit){
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > limit){ reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/* --- Server ----------------------------------------------------- */

/* Which files this may hand out.

   The app directory is also a git checkout, a set of deploy templates and this
   file. Serving the whole directory means a public deployment answers
   /.git/config with its own remote, and /.git/index and the packed objects
   behind it — enough to reconstruct every version of everything. So this is an
   allow-list: dotted paths are refused outright, a few server-side files are
   named, and what is left has to look like something a browser asked for. */
const SERVABLE = /\.(html|css|js|svg|ico|png|jpe?g|webp|woff2?|webmanifest)$/i;
const NEVER = new Set(["server.js", "package.json", "package-lock.json", "Dockerfile"]);

function isServable(rel){
  const parts = rel.split(path.sep).filter(Boolean);
  if (!parts.length) return false;
  if (parts.some(p => p.startsWith("."))) return false;            // .git, .env, .gitignore
  if (parts.some(p => p === "deploy" || p === "node_modules")) return false;
  const base = parts[parts.length - 1];
  if (NEVER.has(base)) return false;
  return SERVABLE.test(base);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Matched by suffix so the app still works when mounted under a sub-path.
  if (url.pathname.endsWith("/api/state")){
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (req.method === "GET"){
      const doc = readState();
      res.writeHead(200);
      return res.end(JSON.stringify(doc || {empty: true}));
    }

    if (req.method === "PUT"){
      try{
        const body = await readBody(req, STATE_MAX_BYTES);
        const doc = JSON.parse(body);
        if (!doc || typeof doc !== "object" || Array.isArray(doc))
          throw new Error("expected an object");
        doc.savedAt = new Date().toISOString();
        writeState(doc);
        res.writeHead(200);
        return res.end(JSON.stringify({ok: true, savedAt: doc.savedAt}));
      }catch(e){
        res.writeHead(e.message === "too large" ? 413 : 400);
        return res.end(JSON.stringify({error: String(e.message || e)}));
      }
    }

    res.writeHead(405);
    return res.end(JSON.stringify({error: "GET to read, PUT to write."}));
  }

  if (url.pathname.endsWith("/api/lookup")){
    const name = (url.searchParams.get("name") || "").trim().slice(0, 120);
    const slot = (url.searchParams.get("slot") || "mid").trim();
    res.setHeader("content-type", "application/json; charset=utf-8");
    if (!name){
      res.writeHead(400); return res.end(JSON.stringify({error:"Give the garment a name first."}));
    }
    const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
            || req.socket.remoteAddress || "unknown";
    if (rateLimited(ip)){
      res.writeHead(429);
      return res.end(JSON.stringify({error:`Too many lookups — limit is ${RATE.max} a minute.`}));
    }
    try{
      const out = await lookup(name, slot);
      res.writeHead(200); res.end(JSON.stringify(out));
    }catch(e){
      res.writeHead(500); res.end(JSON.stringify({error: String(e && e.message || e)}));
    }
    return;
  }

  // Static files, confined to this directory AND to the files a browser needs.
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/" ) rel = "/index.html";
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(ROOT)){ res.writeHead(403); return res.end("Forbidden"); }
  if (!isServable(path.relative(ROOT, file))){ res.writeHead(404); return res.end("Not found"); }

  fs.readFile(file, (err, buf) => {
    if (err){ res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      // The gear editor is edited live; stale JS is worse than a re-fetch.
      "cache-control": "no-cache"
    });
    res.end(buf);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Cycling Weather Effect Matrix on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
  console.log(`Gear lookup at /api/lookup?name=...&slot=...  (max ${RATE.max}/min per client)`);
  console.log(`Synced state in ${STATE_FILE}`);
});
