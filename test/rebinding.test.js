"use strict";

/* ---------------------------------------------------------------
   DNS rebinding in the lookup service.

   checkedURL resolves a hostname and refuses it if any answer is internal.
   That check is only worth something if the connection then goes to the
   address that was checked. A hostname under someone else's control can
   answer "a public address" to the check and "127.0.0.1" a moment later to the
   connection, with a TTL of zero — and a fetch that resolves the name again on
   its own walks straight in.

   The test plays that hostname: the check sees a public address, every later
   lookup sees loopback, and a server on loopback holds a secret. The fetch
   must never come back with the secret.

   It needs port 80 on loopback, because the outbound filter refuses every
   other port. Linux keeps that port for root, so as an ordinary user there it
   is skipped and says so; macOS lets anyone bind it.
----------------------------------------------------------------*/

const {test, describe, before, after} = require("node:test");
const assert = require("node:assert");
const http = require("http");
const dns = require("dns");

const {get, requestOnce, pinnedLookup} = require("../server.js");

const HOST = "rebind.cwem.test";
const PUBLIC = "93.184.216.34";
const SECRET = "internal admin page, never to leave this machine";

describe("DNS rebinding", () => {
  let server = null, skipWhy = null;
  const realPromise = dns.promises.lookup, realCallback = dns.lookup;

  before(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, {"content-type": "text/html"});
      res.end(`<html><body>${SECRET}</body></html>`);
    });
    await new Promise(resolve => {
      server.once("error", e => { skipWhy = `cannot bind 127.0.0.1:80 (${e.code})`; server = null; resolve(); });
      server.listen(80, "127.0.0.1", resolve);
    });

    // The check is answered with a public address; everything after it with
    // loopback — what a rebinding name with a zero TTL does.
    dns.promises.lookup = async (host, opts) => {
      if (host !== HOST) return realPromise.call(dns.promises, host, opts);
      dns.promises.lookup = async () => [{address: "127.0.0.1", family: 4}];
      return opts && opts.all ? [{address: PUBLIC, family: 4}] : {address: PUBLIC, family: 4};
    };
    dns.lookup = (host, opts, cb) => {
      if (typeof opts === "function"){ cb = opts; opts = {}; }
      if (host !== HOST) return realCallback.call(dns, host, opts, cb);
      const all = typeof opts === "object" && opts.all;
      process.nextTick(() => all ? cb(null, [{address: "127.0.0.1", family: 4}])
                                 : cb(null, "127.0.0.1", 4));
    };
  });

  after(async () => {
    dns.promises.lookup = realPromise;
    dns.lookup = realCallback;
    if (server) await new Promise(r => server.close(r));
  });

  test("the connection goes to the address that was checked, not a second answer", async t => {
    if (skipWhy) return t.skip(skipWhy);
    const body = await get(`http://${HOST}/`, 2000);
    assert.ok(!body || !body.includes(SECRET),
      "a name that rebinds to loopback after the check must not reach the loopback server");
  });
});

/* The control: the pinned request still does its job. It is called directly
   with a target that names a host nobody can resolve and an address that was
   "checked" — so a page that comes back proves the connection went to the
   pinned address and never asked DNS. */
describe("pinned request", () => {
  let server, port;
  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/page"){
        res.writeHead(200, {"content-type": "text/html; charset=utf-8"});
        return res.end(`<p>host was ${req.headers.host}</p>`);
      }
      if (req.url === "/moved"){ res.writeHead(302, {location: "/page"}); return res.end(); }
      if (req.url === "/image"){ res.writeHead(200, {"content-type": "image/png"}); return res.end("x"); }
      res.writeHead(404, {"content-type": "text/html"}); res.end("no");
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  after(() => new Promise(r => server.close(r)));

  const target = p => ({url: new URL(`http://nowhere.cwem.test:${port}${p}`),
                        addrs: [{address: "127.0.0.1", family: 4}]});

  test("reads a page from the pinned address, with the real Host header", async () => {
    const r = await requestOnce(target("/page"));
    assert.equal(r.status, 200);
    assert.match(r.body, new RegExp(`host was nowhere\\.cwem\\.test:${port}`));
  });

  test("hands a redirect back to be checked rather than following it", async () => {
    const r = await requestOnce(target("/moved"));
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, "/page");
  });

  test("refuses what is not a text page, and error statuses", async () => {
    assert.equal((await requestOnce(target("/image"))).body, null);
    assert.equal((await requestOnce(target("/missing"))).body, null);
  });

  test("the lookup answers both shapes Node asks in, and only with checked addresses", async () => {
    const lk = pinnedLookup([{address: "93.184.216.34", family: 4}, {address: "2606:2800::1", family: 6}]);
    const one = await new Promise(r => lk("x", {}, (e, a, f) => r([e, a, f])));
    assert.deepEqual(one, [null, "93.184.216.34", 4]);
    const all = await new Promise(r => lk("x", {all: true}, (e, a) => r(a)));
    assert.equal(all.length, 2);
    const v6 = await new Promise(r => lk("x", {family: 6}, (e, a) => r(a)));
    assert.equal(v6, "2606:2800::1");
    const none = await new Promise(r => pinnedLookup([{address: "93.184.216.34", family: 4}])("x", {family: 6}, e => r(e)));
    assert.equal(none.code, "ENOTFOUND");
  });
});
