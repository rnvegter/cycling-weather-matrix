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
const dns = require("dns").promises;
const net = require("net");
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

/* --- Where backups live, and why it is its own directory ---------

   state.prev.json is one step of insurance and no more: it holds the version
   before the last write, which is the wrong thing entirely when what you want
   is the gear list as it stood in March. So backups are kept as dated files,
   and they are kept somewhere an update cannot reach.

   That last part is the whole point of a separate directory. Updating this app
   means replacing the files in its own directory -- a git pull, a fresh clone,
   a rebuilt container -- and anything sitting among them is at the mercy of
   that. A directory of its own, listed in .gitignore, is never tracked and
   never checked out over.

   Under systemd it is already outside the app: StateDirectory= hands the
   service a writable /var/lib/cycling-weather-matrix that survives updates and
   STATE_DIR points at it, so backups land in there. Running by hand it falls
   back to a backups/ directory beside the app, which is still separate from
   everything git manages. BACKUP_DIR overrides both -- point it at an external
   disk or a synced folder and nothing else changes. */
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(STATE_DIR, "backups");
const SCHEDULE_FILE = path.join(BACKUP_DIR, "schedule.json");

/* Retention is a plain count: the newest KEEP files survive and the rest are
   pruned oldest-first. Nothing cleverer, because anything cleverer has to be
   explained before it can be trusted, and a month of daily copies is what this
   is actually for. A restore takes its safety copy first, which makes that
   copy the newest file in the directory and so never the one pruned. */
const KEEP_DEFAULT = 30, KEEP_MAX = 500;
const BACKUP_LIST_MAX = 500;

/* How often the scheduler wakes up to see whether a backup is due. Well under
   the shortest interval it will accept, so a due backup is never late by more
   than this. */
const SCHEDULE_TICK_MS = 5 * 60 * 1000;
const EVERY_HOURS_MIN = 1, EVERY_HOURS_MAX = 24 * 30;

/* The lookup endpoint makes outbound requests on someone else's behalf, which
   is worth a limit before it faces a network. A handful per minute is far more
   than a person editing their wardrobe will ever need. */
/* Who is calling, for rate-limiting purposes.

   X-Forwarded-For is a list the client starts and each proxy appends to, so
   the FIRST entry is whatever the caller chose to put there and the LAST is
   the one the nearest trusted proxy added. Reading the first entry means the
   limit is keyed on a value the attacker controls — a different fake header
   on each request buys unlimited lookups. Both supplied configs append this
   way: nginx via $proxy_add_x_forwarded_for, Caddy by default.

   So: only believe the header at all when the connection itself came from a
   proxy we trust, and then count back TRUST_PROXY_HOPS from the end. One hop
   is the supplied setup (nginx or Caddy on the same box). Put something else
   in front of that — Cloudflare, a load balancer — and raise it to match, or
   every visitor shares one bucket. */
const TRUST_HOPS = Math.max(1, +(process.env.TRUST_PROXY_HOPS || 1));

function isLocalPeer(ip){
  if (!ip) return false;
  const s = String(ip).replace(/^::ffff:/, "");
  return s === "::1" || s === "127.0.0.1" || /^127\./.test(s);
}

function clientIP(req){
  const peer = req.socket.remoteAddress || "unknown";
  // A direct connection has no proxy to have written the header, so anything
  // in it is the caller's own invention.
  if (!isLocalPeer(peer)) return peer;
  const chain = String(req.headers["x-forwarded-for"] || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  if (!chain.length) return peer;
  const i = chain.length - TRUST_HOPS;
  return i >= 0 ? chain[i] : chain[0];
}

const RATE = {max: +(process.env.LOOKUP_RATE || 12), windowMs: 60_000, hits: new Map()};

/* Backup actions get a bucket of their own, and finding out why is what
   testing this was for. Sharing the lookup's twelve a minute meant a handful
   of gear lookups could leave a RESTORE refused -- the one operation in the
   app that must not be blocked, since you are reaching for it precisely when
   something has already gone wrong. Different resource, different limit:
   these are local disk writes rather than outbound requests to someone else's
   site, so the cap is there to stop a runaway loop and nothing more. */
const BACKUP_RATE = {max: +(process.env.BACKUP_RATE || 60), windowMs: 60_000, hits: new Map()};

function rateLimited(ip, bucket){
  const b = bucket || RATE;
  const now = Date.now();
  const seen = (b.hits.get(ip) || []).filter(t => now - t < b.windowMs);
  if (seen.length >= b.max){ b.hits.set(ip, seen); return true; }
  seen.push(now);
  b.hits.set(ip, seen);
  if (b.hits.size > 5000) b.hits.clear();   // crude, but this is one process
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

/* --- Where this server is allowed to reach ------------------------

   The lookup fetches pages chosen by a search engine, on behalf of whoever
   called the endpoint. That is a server making requests to an address it did
   not choose, which is the shape of an SSRF: get a page ranked for a
   distinctive garment name, point it at 169.254.169.254 or at something bound
   to loopback, and the server fetches it from inside the network and hands
   back the body.

   So the destination is checked rather than trusted. Every hostname is
   resolved and every resulting address tested against the ranges that are
   only ever reachable from inside — loopback, private, link-local (which is
   where cloud metadata lives), carrier NAT, multicast and reserved space.
   Redirects are followed by hand for the same reason: a public URL that
   answers 302 to localhost would otherwise walk straight past a check done
   only on the first hop. */

const BLOCKED_V4 = [
  [[0,0,0,0], 8],           // "this network"
  [[10,0,0,0], 8],          // private
  [[100,64,0,0], 10],       // carrier-grade NAT
  [[127,0,0,0], 8],         // loopback
  [[169,254,0,0], 16],      // link-local — cloud metadata (169.254.169.254)
  [[172,16,0,0], 12],       // private
  [[192,0,0,0], 24],        // IETF protocol assignments
  [[192,168,0,0], 16],      // private
  [[198,18,0,0], 15],       // benchmarking
  [[224,0,0,0], 4],         // multicast
  [[240,0,0,0], 4]          // reserved, includes 255.255.255.255
];

function v4Blocked(ip){
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const asInt = ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
  return BLOCKED_V4.some(([base, bits]) => {
    const baseInt = ((base[0] << 24) >>> 0) + (base[1] << 16) + (base[2] << 8) + base[3];
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (asInt & mask) === (baseInt & mask);
  });
}

function isBlockedAddress(ip){
  const v = net.isIP(ip);
  if (v === 4) return v4Blocked(ip);
  if (v !== 6) return true;                       // not an address at all
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  // IPv4 carried inside IPv6 is still IPv4 — ::ffff:127.0.0.1 must not pass.
  const mapped = s.match(/(?:^::ffff:|^::)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (mapped) return v4Blocked(mapped[1]);
  if (s === "::1" || s === "::") return true;     // loopback, unspecified
  if (/^f[cd]/.test(s)) return true;              // fc00::/7 unique local
  if (/^fe[89ab]/.test(s)) return true;           // fe80::/10 link-local
  if (/^ff/.test(s)) return true;                 // multicast
  return false;
}

/* Resolve a URL and refuse it if it points anywhere internal. Returns the
   parsed URL so the caller fetches exactly what was checked. */
async function checkedURL(raw){
  let u;
  try{ u = new URL(raw); }catch(e){ return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  // A non-standard port is how you reach an internal service that happens to
  // sit on a public-looking host. Nothing we want is served off one.
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  // A literal address skips DNS but still gets checked.
  if (net.isIP(host)) return isBlockedAddress(host) ? null : u;
  let addrs;
  try{ addrs = await dns.lookup(host, {all: true}); }
  catch(e){ return null; }
  if (!addrs.length || addrs.some(a => isBlockedAddress(a.address))) return null;
  return u;
}

const MAX_REDIRECTS = 4;

async function get(url, timeoutMs = 8000){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try{
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++){
      const safe = await checkedURL(target);
      if (!safe) return null;
      const res = await fetch(safe.toString(), {
        signal: ctrl.signal,
        // Followed by hand so each hop is checked, not just the first.
        redirect: "manual",
        headers: {"user-agent": UA, "accept-language": "en-GB,en;q=0.9"}
      });
      if (res.status >= 300 && res.status < 400){
        const loc = res.headers.get("location");
        if (!loc) return null;
        target = new URL(loc, safe).toString();     // relative redirects resolve
        continue;
      }
      if (!res.ok) return null;
      const type = res.headers.get("content-type") || "";
      if (!/text\/html|text\/plain/.test(type)) return null;
      return await res.text();
    }
    return null;                                    // too many redirects
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

/* Is this write coming from the app itself rather than from some other page
   the browser happens to have open?

   Absent Origin (curl, a script, the app's own sendBeacon) passes; a present
   and foreign one does not. Every route that writes goes through this one
   function, so a route added later cannot quietly skip it. */
function sameOrigin(req){
  const origin = req.headers.origin;
  if (!origin) return true;
  try{ return new URL(origin).host === req.headers.host; }
  catch(e){ return false; }
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

/* --- Backups -----------------------------------------------------

   A backup is one JSON file holding the whole synced document -- the gear list
   and every ride -- inside a small envelope that says when it was taken and
   why. The envelope earns its place on the way back in: a restore can check
   that a file is actually one of these before it overwrites anything, rather
   than trusting a filename.

   Filenames are dated so that sorting them by name sorts them by time, and
   carry no colons, because a colon is illegal in a Windows filename and a
   nuisance in a shell.
----------------------------------------------------------------*/

const BACKUP_REASONS = new Set(["manual", "scheduled", "pre-restore"]);

/* The one shape a backup file may have. Anything else is refused rather than
   half-read: a partial restore is worse than a failed one. */
const BACKUP_NAME = /^backup-\d{8}-\d{6}(?:-\d+)?-(?:manual|scheduled|pre-restore)\.json$/;

const stamp = d => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

/* Any name that arrives from a client is checked twice: it has to match the
   pattern this writes, AND it has to be a file that is actually in the backup
   directory. The pattern alone would be enough to stop ../../etc/passwd, but
   the listing check means a name can only ever address something this put
   there -- no symlink, no leftover, nothing outside. */
function backupPath(name){
  if (typeof name !== "string" || !BACKUP_NAME.test(name)) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return null;
  let entries = [];
  try{ entries = fs.readdirSync(BACKUP_DIR); }catch(e){ return null; }
  if (!entries.includes(name)) return null;
  return path.join(BACKUP_DIR, name);
}

function listBackups(){
  let names = [];
  try{ names = fs.readdirSync(BACKUP_DIR); }catch(e){ return []; }
  return names
    .filter(n => BACKUP_NAME.test(n))
    .sort()
    .reverse()                              // dated names, so this is newest first
    .slice(0, BACKUP_LIST_MAX)
    .map(name => {
      const full = path.join(BACKUP_DIR, name);
      const out = {name, bytes: 0, at: null, reason: null, rides: null, items: null};
      try{ out.bytes = fs.statSync(full).size; }catch(e){}
      /* The counts come from inside the file rather than from its name, so a
         file that has been truncated or hand-edited shows what it actually
         holds. A file that will not parse is listed as unreadable instead of
         being hidden -- you want to know it is there and broken. */
      try{
        const doc = JSON.parse(fs.readFileSync(full, "utf8"));
        out.at = doc.backupAt || null;
        out.reason = doc.reason || null;
        out.rides = Array.isArray(doc.state && doc.state.history) ? doc.state.history.length : null;
        out.items = Array.isArray(doc.state && doc.state.gear) ? doc.state.gear.length : null;
      }catch(e){ out.unreadable = true; }
      return out;
    });
}

/* Oldest first out the door, and only ever files this wrote. */
function pruneBackups(keep){
  const limit = Math.max(1, Math.min(KEEP_MAX, keep || KEEP_DEFAULT));
  let names = [];
  try{ names = fs.readdirSync(BACKUP_DIR); }catch(e){ return []; }
  const mine = names.filter(n => BACKUP_NAME.test(n)).sort();   // oldest first
  const doomed = mine.slice(0, Math.max(0, mine.length - limit));
  const gone = [];
  doomed.forEach(n => {
    try{ fs.unlinkSync(path.join(BACKUP_DIR, n)); gone.push(n); }catch(e){}
  });
  return gone;
}

/* Write one, temp-then-rename for the same reason writeState does it. Returns
   null when there is nothing to back up: an empty state is not worth a file,
   and neither is a state identical to the newest backup already held --
   a scheduler left running for a fortnight of not riding should not fill a
   directory with the same document thirty times. */
function writeBackup(reason, opts){
  const why = BACKUP_REASONS.has(reason) ? reason : "manual";
  const state = readState();
  if (!state || (!Array.isArray(state.gear) && !Array.isArray(state.history))) return null;

  fs.mkdirSync(BACKUP_DIR, {recursive: true});

  const text = JSON.stringify({
    app: "cycling-weather-matrix", version: 1,
    backupAt: new Date().toISOString(), reason: why,
    state
  });
  if (Buffer.byteLength(text) > STATE_MAX_BYTES) throw new Error("too large");

  if (opts && opts.skipIfUnchanged){
    const newest = listBackups()[0];
    if (newest && !newest.unreadable){
      try{
        const prev = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, newest.name), "utf8"));
        // savedAt is stamped by the state endpoint on every write, so comparing
        // the documents without it asks the right question: has anything the
        // rider owns actually changed?
        const strip = d => { const c = Object.assign({}, d); delete c.savedAt; return JSON.stringify(c); };
        if (strip(prev.state) === strip(state)) return null;
      }catch(e){}
    }
  }

  const base = `backup-${stamp(new Date())}`;
  let name = `${base}-${why}.json`, n = 1;
  while (fs.existsSync(path.join(BACKUP_DIR, name))) name = `${base}-${++n}-${why}.json`;

  const full = path.join(BACKUP_DIR, name);
  const tmp = full + ".tmp";
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, full);
  return name;
}

/* --- The schedule ------------------------------------------------
   Server-side on purpose. A backup that only happens when a browser tab is
   open is not a schedule, it is a coincidence -- and the mornings you most
   want yesterday's copy are the ones you never opened the app. Off until it
   is asked for, because writing files on someone's disk uninvited is not the
   sort of thing an app should decide for itself.
----------------------------------------------------------------*/
const SCHEDULE_OFF = {enabled: false, everyHours: 24, keep: KEEP_DEFAULT, lastAt: null};

const clampHours = v => Math.max(EVERY_HOURS_MIN, Math.min(EVERY_HOURS_MAX, Math.round(+v || 24)));
const clampKeep  = v => Math.max(1, Math.min(KEEP_MAX, Math.round(+v || KEEP_DEFAULT)));

function readSchedule(){
  try{
    const doc = JSON.parse(fs.readFileSync(SCHEDULE_FILE, "utf8"));
    return {
      enabled: !!doc.enabled,
      everyHours: clampHours(doc.everyHours),
      keep: clampKeep(doc.keep),
      lastAt: typeof doc.lastAt === "string" ? doc.lastAt : null
    };
  }catch(e){ return Object.assign({}, SCHEDULE_OFF); }
}

function writeSchedule(next){
  const doc = {
    enabled: !!next.enabled,
    everyHours: clampHours(next.everyHours),
    keep: clampKeep(next.keep),
    lastAt: typeof next.lastAt === "string" ? next.lastAt : null
  };
  fs.mkdirSync(BACKUP_DIR, {recursive: true});
  const tmp = SCHEDULE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
  fs.renameSync(tmp, SCHEDULE_FILE);
  return doc;
}

/* Due if it has never run, or if the interval has elapsed. A clock that has
   gone backwards -- a laptop waking up, a container with no RTC -- would
   otherwise park a backup forever in the future, so a lastAt later than now is
   treated as due rather than trusted. */
function backupDue(sched, now){
  if (!sched.enabled) return false;
  if (!sched.lastAt) return true;
  const last = Date.parse(sched.lastAt);
  if (!Number.isFinite(last)) return true;
  if (last > now) return true;
  return now - last >= sched.everyHours * 3600 * 1000;
}

/* The scheduled run that is currently failing, if one is.

   This used to be a bare `catch(e){ return null; }`, and null is also what
   "nothing due" returns — so the ticker could not tell a failure from a quiet
   tick, its own "Scheduled backup failed" log line could never fire, and a
   backup directory that went unwritable (an external disk unplugged or full, a
   bind mount with the wrong owner) stopped every scheduled backup without a
   single trace anywhere. The Backup tab went on saying the schedule was on.

   For a backup that is the worst failure there is, because you only find out
   when you need the file that was never written. So a failure is now held
   here, logged when it starts and again only if the reason changes (the tick
   retries every five minutes and a line per tick would bury it), logged again
   when it recovers, and reported to the Backup tab through /api/backups.

   lastAt deliberately does not advance on failure. The run stays due, so it
   retries every tick and succeeds the moment the disk is back, rather than
   waiting out a full interval with nothing written. */
let scheduleFailure = null;
const lastScheduleFailure = () => scheduleFailure;

function runScheduledBackup(now){
  const sched = readSchedule();
  if (!backupDue(sched, now == null ? Date.now() : now)) return null;
  let name = null;
  try{
    name = writeBackup("scheduled", {skipIfUnchanged: true});
    pruneBackups(sched.keep);
  }catch(e){
    const message = String((e && e.message) || e);
    const at = new Date().toISOString();
    if (!scheduleFailure || scheduleFailure.message !== message){
      console.error(`Scheduled backup failed, retrying every ${SCHEDULE_TICK_MS / 60000} min: `
                  + `${message} (backup directory ${BACKUP_DIR})`);
    }
    scheduleFailure = {since: scheduleFailure ? scheduleFailure.since : at, at, message, dir: BACKUP_DIR};
    return null;
  }
  if (scheduleFailure){
    console.log(`Scheduled backup working again; it had been failing since ${scheduleFailure.since}.`);
    scheduleFailure = null;
  }
  /* The clock moves on whether or not a file was written. Otherwise an
     unchanged state means "not due" is never satisfied and the scheduler
     re-checks, re-reads and re-compares the whole document every tick. */
  writeSchedule(Object.assign({}, sched, {lastAt: new Date().toISOString()}));
  return name;
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
  /* backups/ holds every version of the gear list and ride history. The
     extension allow-list below already refuses .json, so this is a second
     lock rather than the only one -- but a directory whose whole contents are
     personal data deserves naming rather than relying on a suffix test. */
  if (parts.some(p => p === "deploy" || p === "node_modules" || p === "backups")) return false;
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
      /* This endpoint has no authentication of its own — it relies on the
         proxy, as INSTALL.md says. That is a deliberate limit, but it should
         at least not be drivable from another site in your browser: a page you
         happen to visit must not be able to overwrite your gear and rides
         using your session. A JSON PUT already forces a CORS preflight, so
         this is a second lock rather than the only one, and it costs nothing.
         Absent Origin (curl, a script, the app's own sendBeacon) is allowed
         through; a present and foreign one is not. */
      if (!sameOrigin(req)){
        res.writeHead(403);
        return res.end(JSON.stringify({error: "Cross-origin writes are refused."}));
      }
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

  /* One version's contents, for a restore or a download. Read-only, and it can
     only ever name a file backupPath approves. */
  if (url.pathname.endsWith("/api/backup")){
    res.setHeader("content-type", "application/json; charset=utf-8");
    if (req.method !== "GET"){
      res.writeHead(405);
      return res.end(JSON.stringify({error: "GET only."}));
    }
    const full = backupPath(url.searchParams.get("name"));
    if (!full){
      res.writeHead(404);
      return res.end(JSON.stringify({error: "No such backup."}));
    }
    try{
      res.writeHead(200);
      return res.end(fs.readFileSync(full, "utf8"));
    }catch(e){
      res.writeHead(500);
      return res.end(JSON.stringify({error: "That backup could not be read."}));
    }
  }

  if (url.pathname.endsWith("/api/backups")){
    res.setHeader("content-type", "application/json; charset=utf-8");

    if (req.method === "GET"){
      res.writeHead(200);
      return res.end(JSON.stringify({
        ok: true,
        dir: BACKUP_DIR,
        schedule: readSchedule(),
        // Null when scheduled backups are healthy (or off); otherwise why they
        // are not being written, so the Backup tab can say so.
        scheduleFailure,
        keepMax: KEEP_MAX, everyHoursMin: EVERY_HOURS_MIN, everyHoursMax: EVERY_HOURS_MAX,
        backups: listBackups()
      }));
    }

    if (req.method === "POST"){
      if (!sameOrigin(req)){
        res.writeHead(403);
        return res.end(JSON.stringify({error: "Cross-origin writes are refused."}));
      }
      /* Writing and deleting files is worth the same limit the outbound
         lookup gets. Nothing here is expensive, but nothing here should be
         drivable in a loop either. */
      if (rateLimited(clientIP(req), BACKUP_RATE)){
        res.writeHead(429);
        return res.end(JSON.stringify({
          error: `More than ${BACKUP_RATE.max} backup actions in a minute — that is a runaway `
               + `script rather than a person, so this one is refused. Try again shortly.`}));
      }
      try{
        const body = await readBody(req, 64 * 1024);
        const req_ = body ? JSON.parse(body) : {};
        const action = String(req_.action || "");

        if (action === "create"){
          const sched = readSchedule();
          /* A client may say why it is asking -- a copy taken to make a file
             restore undoable is a pre-restore copy, and labelling it "manual"
             in the list told the reader the wrong story. It may not claim to
             be "scheduled", though: that label means the server wrote it on
             its own, and only the scheduler gets to say so. */
          const why = req_.reason === "pre-restore" ? "pre-restore" : "manual";
          const name = writeBackup(why);
          if (!name){
            res.writeHead(409);
            return res.end(JSON.stringify({error: "Nothing to back up yet — no gear or rides have reached the server."}));
          }
          const pruned = pruneBackups(sched.keep);
          res.writeHead(200);
          return res.end(JSON.stringify({ok: true, name, pruned, backups: listBackups()}));
        }

        if (action === "restore"){
          const full = backupPath(req_.name);
          if (!full){
            res.writeHead(404);
            return res.end(JSON.stringify({error: "No such backup."}));
          }
          const doc = JSON.parse(fs.readFileSync(full, "utf8"));
          if (!doc || !doc.state || typeof doc.state !== "object")
            throw new Error("that file is not a backup of this app");
          /* The safety copy comes first, and a failure to take it stops the
             restore. Overwriting the current state with no way back is the one
             outcome this feature exists to prevent. */
          const safety = writeBackup("pre-restore");
          writeState(Object.assign({}, doc.state, {restoredFrom: req_.name}));
          pruneBackups(readSchedule().keep);
          res.writeHead(200);
          return res.end(JSON.stringify({ok: true, restored: req_.name, safety,
                                         state: readState(), backups: listBackups()}));
        }

        if (action === "delete"){
          const full = backupPath(req_.name);
          if (!full){
            res.writeHead(404);
            return res.end(JSON.stringify({error: "No such backup."}));
          }
          fs.unlinkSync(full);
          res.writeHead(200);
          return res.end(JSON.stringify({ok: true, deleted: req_.name, backups: listBackups()}));
        }

        if (action === "schedule"){
          const sched = writeSchedule({
            enabled: req_.enabled,
            everyHours: req_.everyHours,
            keep: req_.keep,
            // Turning the schedule ON starts its clock now rather than
            // firing immediately, so enabling it is not itself a backup.
            lastAt: req_.enabled ? (readSchedule().lastAt || new Date().toISOString()) : null
          });
          const pruned = pruneBackups(sched.keep);
          res.writeHead(200);
          return res.end(JSON.stringify({ok: true, schedule: sched, pruned, backups: listBackups()}));
        }

        res.writeHead(400);
        return res.end(JSON.stringify({error: "Unknown action."}));
      }catch(e){
        res.writeHead(e.message === "too large" ? 413 : 400);
        return res.end(JSON.stringify({error: String(e.message || e)}));
      }
    }

    res.writeHead(405);
    return res.end(JSON.stringify({error: "GET to list, POST to act."}));
  }

  if (url.pathname.endsWith("/api/lookup")){
    const name = (url.searchParams.get("name") || "").trim().slice(0, 120);
    const slot = (url.searchParams.get("slot") || "mid").trim();
    res.setHeader("content-type", "application/json; charset=utf-8");
    if (!name){
      res.writeHead(400); return res.end(JSON.stringify({error:"Give the garment a name first."}));
    }
    const ip = clientIP(req);
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

/* Listen only when this file is the program. Required as a module — which is
   what the tests do — it hands over its internals and binds nothing. */
if (require.main === module){
  server.listen(PORT, HOST, () => {
    const sched = readSchedule();
    console.log(`Cycling Weather Effect Matrix on http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`);
    console.log(`Gear lookup at /api/lookup?name=...&slot=...  (max ${RATE.max}/min per client)`);
    console.log(`Synced state in ${STATE_FILE}`);
    console.log(`Backups in ${BACKUP_DIR}` + (sched.enabled
      ? ` — every ${sched.everyHours} h, keeping ${sched.keep}`
      : " — scheduled backup off; turn it on from the Backup tab"));
  });

  /* The scheduler only runs when this file is the program, so requiring the
     module in a test writes nothing to anybody's disk. unref() so a pending
     tick never holds the process open on its own. */
  const ticker = setInterval(() => {
    try{
      const made = runScheduledBackup();
      if (made) console.log(`Scheduled backup written: ${made}`);
    }catch(e){ console.error("Scheduled backup failed:", e.message); }
  }, SCHEDULE_TICK_MS);
  ticker.unref();
  // And once at startup, for a machine that was off when one came due.
  try{ runScheduledBackup(); }catch(e){}
}

module.exports = {server, isServable, isBlockedAddress, checkedURL, get, clientIP,
                  rateLimited, RATE, BACKUP_RATE, toText, rank, sameOrigin,
                  BACKUP_DIR, BACKUP_NAME, backupPath, listBackups, pruneBackups, writeBackup,
                  readSchedule, writeSchedule, backupDue, runScheduledBackup, lastScheduleFailure,
                  KEEP_DEFAULT, KEEP_MAX, EVERY_HOURS_MIN, EVERY_HOURS_MAX};
