"use strict";

/* ---------------------------------------------------------------
   The two findings that were real, and the allow-list that was
   already there. Run with: npm test

   node:test and node:assert ship with Node, so the project keeps its
   no-dependency rule — there is still nothing to npm install.
----------------------------------------------------------------*/

const {test, describe} = require("node:test");
const assert = require("node:assert");
const path = require("path");
const {isBlockedAddress, checkedURL, clientIP, isServable, rateLimited, RATE} =
  require("../server.js");

/* --- SSRF -------------------------------------------------------- */

describe("outbound address filter", () => {
  test("refuses every range that is only reachable from inside", () => {
    [
      "127.0.0.1", "127.1.2.3",            // loopback
      "0.0.0.0",                            // this network
      "10.0.0.1", "10.255.255.254",         // private
      "172.16.0.1", "172.31.255.254",       // private
      "192.168.1.1",                        // private
      "169.254.169.254",                    // cloud metadata — the classic target
      "169.254.0.1",                        // link-local generally
      "100.64.0.1",                         // carrier-grade NAT
      "192.0.0.1",                          // protocol assignments
      "198.18.0.1",                         // benchmarking
      "224.0.0.1",                          // multicast
      "255.255.255.255",                    // broadcast
      "::1", "::",                          // v6 loopback, unspecified
      "fc00::1", "fd12:3456::1",            // v6 unique local
      "fe80::1",                            // v6 link-local
      "ff02::1",                            // v6 multicast
      "::ffff:127.0.0.1",                   // v4 loopback wearing a v6 hat
      "::ffff:169.254.169.254",             // metadata, same trick
      "not-an-address", ""                  // and anything unparseable
    ].forEach(ip => assert.equal(isBlockedAddress(ip), true, `${ip} should be refused`));
  });

  test("allows ordinary public addresses", () => {
    ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.15.255.255", "172.32.0.1",
     "192.167.255.255", "192.169.0.1", "2606:4700:4700::1111"]
      .forEach(ip => assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`));
  });

  test("boundaries of the private ranges are not off by one", () => {
    assert.equal(isBlockedAddress("172.15.255.255"), false, "just below 172.16/12");
    assert.equal(isBlockedAddress("172.16.0.0"), true,      "first of 172.16/12");
    assert.equal(isBlockedAddress("172.31.255.255"), true,  "last of 172.16/12");
    assert.equal(isBlockedAddress("172.32.0.0"), false,     "just above 172.16/12");
    assert.equal(isBlockedAddress("100.63.255.255"), false, "just below 100.64/10");
    assert.equal(isBlockedAddress("100.64.0.0"), true,      "first of 100.64/10");
    assert.equal(isBlockedAddress("100.127.255.255"), true, "last of 100.64/10");
    assert.equal(isBlockedAddress("100.128.0.0"), false,    "just above 100.64/10");
  });

  test("URL check refuses internal literals, odd schemes and odd ports", async () => {
    for (const bad of [
      "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/", "http://192.168.0.1/",
      "file:///etc/passwd", "gopher://example.com/", "ftp://example.com/",
      "http://example.com:8765/",         // internal service on a public-looking host
      "http://example.com:22/",
      "not a url"
    ]) assert.equal(await checkedURL(bad), null, `${bad} should be refused`);
  });

  test("URL check keeps ordinary product pages, on either standard port", async () => {
    for (const good of ["https://www.gorewear.com/some-garment",
                        "http://example.com/x", "https://example.com:443/x"]){
      assert.ok(await checkedURL(good), `${good} should be allowed`);
    }
  });

  test("a hostname that resolves to loopback is refused", async () => {
    // The bypass a first-hop-only check misses: a perfectly public-looking
    // name whose DNS answer points back inside.
    assert.equal(await checkedURL("http://localhost/"), null,
      "localhost must not survive resolution");
  });
});

/* --- Rate limiting ----------------------------------------------- */

describe("client identity for rate limiting", () => {
  const req = (xff, peer) => ({headers: xff == null ? {} : {"x-forwarded-for": xff},
                               socket: {remoteAddress: peer}});

  test("takes the proxy-appended entry, not the caller's invention", () => {
    // nginx's $proxy_add_x_forwarded_for produces "<what the client sent>, <real ip>".
    assert.equal(clientIP(req("203.0.113.9, 198.51.100.7", "127.0.0.1")), "198.51.100.7");
  });

  test("a spoofed header cannot move the caller between buckets", () => {
    const a = clientIP(req("1.1.1.1, 198.51.100.7", "127.0.0.1"));
    const b = clientIP(req("2.2.2.2, 198.51.100.7", "127.0.0.1"));
    const c = clientIP(req("evil, 198.51.100.7", "127.0.0.1"));
    assert.equal(a, b, "different spoofed values must not yield different keys");
    assert.equal(b, c);
    assert.equal(a, "198.51.100.7");
  });

  test("ignores the header entirely on a direct connection", () => {
    assert.equal(clientIP(req("1.2.3.4", "203.0.113.50")), "203.0.113.50");
  });

  test("falls back to the peer when there is no header", () => {
    assert.equal(clientIP(req(null, "127.0.0.1")), "127.0.0.1");
    assert.equal(clientIP(req("", "127.0.0.1")), "127.0.0.1");
  });

  test("the limit actually bites, and per key", () => {
    RATE.hits.clear();
    const key = "test-client-" + Date.now();
    let allowed = 0;
    for (let i = 0; i < RATE.max + 5; i++) if (!rateLimited(key)) allowed++;
    assert.equal(allowed, RATE.max, "exactly the budget gets through");
    assert.equal(rateLimited("someone-else-" + Date.now()), false, "other keys unaffected");
    RATE.hits.clear();
  });
});

/* --- The static allow-list --------------------------------------- */

describe("static file allow-list", () => {
  const rel = p => p.split("/").join(path.sep);

  test("refuses the repository and the server's own files", () => {
    [".git/config", ".git/HEAD", ".gitignore", ".env",
     "server.js", "package.json", "package-lock.json", "Dockerfile",
     "deploy/Caddyfile", "deploy/nginx.conf",
     "state.json", "state.prev.json",           // no .json is servable at all
     "node_modules/x/index.js", "README.md", "INSTALL.md", ""]
      .forEach(p => assert.equal(isServable(rel(p)), false, `${p} must not be servable`));
  });

  test("still serves what the browser actually needs", () => {
    ["index.html", "styles.css", "app.js", "model.js", "gear.js", "gpx.js",
     "history.js", "historyui.js", "sync.js", "insulation.js", "weather.js", "map.js"]
      .forEach(p => assert.equal(isServable(p), true, `${p} should be servable`));
  });
});
