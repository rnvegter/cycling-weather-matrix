"use strict";

/* ---------------------------------------------------------------
   Backups.

   This is the first thing in the app that writes files someone chose the
   contents of, and deletes files by name, so the tests lean towards the two
   ways that goes wrong: a name that escapes the backup directory, and a
   restore that destroys the current state without leaving a way back.

   node --test runs each file in its own process, so setting BACKUP_DIR here
   before requiring the server is safe: nothing writes to a real backup
   directory, and the temporary one is removed afterwards.
----------------------------------------------------------------*/

const {test, describe, before, after} = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cwem-backup-test-"));
process.env.BACKUP_DIR = path.join(TMP, "backups");
process.env.STATE_DIR = TMP;

const srv = require("../server.js");

after(() => { try{ fs.rmSync(TMP, {recursive: true, force: true}); }catch(e){} });

const STATE_FILE = path.join(TMP, "state.json");
const setState = doc => fs.writeFileSync(STATE_FILE, JSON.stringify(doc));
const clearBackups = () => {
  try{ fs.rmSync(process.env.BACKUP_DIR, {recursive: true, force: true}); }catch(e){}
};
const someState = (rides = 2, items = 3) => ({
  gear: Array.from({length: items}, (_, i) => ({name: "item" + i, slot: "mid"})),
  history: Array.from({length: rides}, (_, i) => ({id: "r" + i, delta: 0})),
  gearUpdatedAt: "2026-03-01T10:00:00.000Z",
  savedAt: "2026-03-01T10:00:00.000Z"
});

/* --- Where they go ---------------------------------------------- */

describe("the backup directory", () => {
  test("is its own directory, not the app's", () => {
    // The point of the feature: an update replaces the app directory, so the
    // backups must not be in it.
    assert.equal(srv.BACKUP_DIR, path.join(TMP, "backups"));
  });

  test("is never servable over HTTP", () => {
    /* The extension allow-list already refuses .json, but a directory holding
       every version of someone's rides is worth naming outright. */
    assert.equal(srv.isServable("backups/backup-20260301-100000-manual.json"), false);
    assert.equal(srv.isServable("backups/anything.js"), false, "not even a .js in there");
    assert.equal(srv.isServable("app.js"), true, "and the app still works");
  });
});

/* --- Writing ---------------------------------------------------- */

describe("writing a backup", () => {
  before(() => { clearBackups(); setState(someState()); });

  test("writes one file, dated, and lists it with its counts", () => {
    const name = srv.writeBackup("manual");
    assert.match(name, srv.BACKUP_NAME, `${name} must match the one shape allowed`);
    const list = srv.listBackups();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, name);
    assert.equal(list[0].reason, "manual");
    assert.equal(list[0].rides, 2);
    assert.equal(list[0].items, 3);
    assert.ok(list[0].bytes > 0);
    assert.ok(Date.parse(list[0].at) > 0, "and says when it was taken");
  });

  test("holds the whole state, in an envelope that says what it is", () => {
    const doc = JSON.parse(fs.readFileSync(
      path.join(srv.BACKUP_DIR, srv.listBackups()[0].name), "utf8"));
    assert.equal(doc.app, "cycling-weather-matrix");
    assert.equal(doc.version, 1);
    assert.equal(doc.state.history.length, 2);
    assert.equal(doc.state.gear.length, 3);
  });

  test("refuses to write a file when there is nothing to back up", () => {
    clearBackups();
    fs.rmSync(STATE_FILE, {force: true});
    assert.equal(srv.writeBackup("manual"), null, "an empty state is not worth a file");
    setState(someState());
  });

  test("two in the same second do not collide", () => {
    clearBackups(); setState(someState());
    const a = srv.writeBackup("manual"), b = srv.writeBackup("manual");
    assert.notEqual(a, b);
    assert.match(b, srv.BACKUP_NAME);
    assert.equal(srv.listBackups().length, 2);
  });

  test("skipIfUnchanged writes nothing when the state has not moved", () => {
    /* A scheduler left running through a fortnight of not riding should not
       fill the directory with the same document thirty times. */
    clearBackups(); setState(someState());
    assert.ok(srv.writeBackup("scheduled"));
    assert.equal(srv.writeBackup("scheduled", {skipIfUnchanged: true}), null);
    assert.equal(srv.listBackups().length, 1);
  });

  test("...but a real change still gets its own version", () => {
    setState(someState(5, 3));
    assert.ok(srv.writeBackup("scheduled", {skipIfUnchanged: true}));
    assert.equal(srv.listBackups().length, 2);
  });

  test("a re-save that changed nothing but the timestamp is not a change", () => {
    // The state endpoint stamps savedAt on every write, including a push that
    // carried identical gear and rides. That must not count as a change.
    clearBackups();
    setState(Object.assign(someState(), {savedAt: "2026-03-01T10:00:00.000Z"}));
    assert.ok(srv.writeBackup("scheduled"));
    setState(Object.assign(someState(), {savedAt: "2026-03-02T18:30:00.000Z"}));
    assert.equal(srv.writeBackup("scheduled", {skipIfUnchanged: true}), null);
  });
});

/* --- Naming, which is where a file-writing feature gets attacked - */

describe("addressing a backup by name", () => {
  before(() => { clearBackups(); setState(someState()); srv.writeBackup("manual"); });

  test("accepts a name it wrote itself", () => {
    const name = srv.listBackups()[0].name;
    assert.equal(srv.backupPath(name), path.join(srv.BACKUP_DIR, name));
  });

  test("refuses every way out of the directory", () => {
    for (const bad of [
      "../state.json",
      "../../etc/passwd",
      "backups/../../state.json",
      "/etc/passwd",
      "..\\state.json",
      "backup-20260301-100000-manual.json/../../state.json",
      "./backup-20260301-100000-manual.json"
    ]) assert.equal(srv.backupPath(bad), null, `${bad} must not resolve`);
  });

  test("refuses a name of the right shape that is not actually there", () => {
    /* The pattern alone would let a well-formed name address a file this did
       not write — a symlink someone dropped in, or a leftover. The listing
       check is what makes that impossible. */
    assert.equal(srv.backupPath("backup-19990101-000000-manual.json"), null);
  });

  test("refuses anything that is not a backup name", () => {
    for (const bad of [null, undefined, 42, {}, "", "state.json", "schedule.json",
                       "backup-2026-03-01-manual.json", "backup-20260301-100000-evil.json",
                       "backup-20260301-100000-manual.json.tmp"])
      assert.equal(srv.backupPath(bad), null, `${JSON.stringify(bad)} must not resolve`);
  });

  test("the schedule file cannot be reached, read or deleted as a backup", () => {
    srv.writeSchedule({enabled: true, everyHours: 24, keep: 5});
    assert.equal(srv.backupPath("schedule.json"), null);
    assert.ok(fs.existsSync(path.join(srv.BACKUP_DIR, "schedule.json")));
  });
});

/* --- Retention -------------------------------------------------- */

describe("pruning", () => {
  const fill = n => {
    clearBackups();
    fs.mkdirSync(srv.BACKUP_DIR, {recursive: true});
    for (let i = 1; i <= n; i++){
      const day = String(i).padStart(2, "0");
      fs.writeFileSync(path.join(srv.BACKUP_DIR, `backup-202603${day}-100000-scheduled.json`),
        JSON.stringify({app: "cycling-weather-matrix", version: 1,
                        backupAt: `2026-03-${day}T10:00:00.000Z`, reason: "scheduled",
                        state: someState()}));
    }
  };

  test("keeps the newest and drops the oldest", () => {
    fill(10);
    const gone = srv.pruneBackups(4);
    assert.equal(gone.length, 6);
    const left = srv.listBackups().map(b => b.name);
    assert.equal(left.length, 4);
    assert.ok(left[0].includes("20260310"), "newest first, and it survived");
    assert.ok(gone.every(n => n < left[left.length - 1]), "everything dropped is older");
  });

  test("does nothing when there is room", () => {
    fill(3);
    assert.deepEqual(srv.pruneBackups(30), []);
    assert.equal(srv.listBackups().length, 3);
  });

  test("keeps exactly one when one is what it is asked for", () => {
    fill(5);
    srv.pruneBackups(1);
    assert.equal(srv.listBackups().length, 1);
  });

  test("a missing or zero count keeps the default, it does not clear the shelf", () => {
    /* Zero and absent are the same value in JavaScript's eyes, and for a
       backup feature the safe reading of both is "nobody said", not "delete
       everything but one". A corrupt schedule file should cost you disk, not
       your history. */
    fill(5);
    assert.deepEqual(srv.pruneBackups(0), []);
    assert.deepEqual(srv.pruneBackups(), []);
    assert.equal(srv.listBackups().length, 5);
  });

  test("touches nothing it did not write", () => {
    fill(5);
    const alien = path.join(srv.BACKUP_DIR, "please-keep-me.json");
    fs.writeFileSync(alien, "{}");
    srv.writeSchedule({enabled: false, everyHours: 24, keep: 30});
    srv.pruneBackups(1);
    assert.ok(fs.existsSync(alien), "a file this did not write is not its business");
    assert.ok(fs.existsSync(path.join(srv.BACKUP_DIR, "schedule.json")),
      "and the schedule is not a backup");
  });
});

/* --- The schedule ----------------------------------------------- */

describe("the schedule", () => {
  before(() => { clearBackups(); setState(someState()); });

  test("is off until it is asked for", () => {
    clearBackups();
    const s = srv.readSchedule();
    assert.equal(s.enabled, false);
    assert.equal(s.lastAt, null);
    assert.equal(s.keep, srv.KEEP_DEFAULT);
  });

  test("clamps what it is given rather than trusting it", () => {
    const wild = srv.writeSchedule({enabled: true, everyHours: 99999, keep: 99999});
    assert.equal(wild.everyHours, srv.EVERY_HOURS_MAX);
    assert.equal(wild.keep, srv.KEEP_MAX);
    const tiny = srv.writeSchedule({enabled: true, everyHours: 0, keep: -5});
    assert.equal(tiny.everyHours, 24, "zero is not an interval, so it falls back");
    assert.equal(tiny.keep, 1);
  });

  test("nothing is due while it is off", () => {
    assert.equal(srv.backupDue({enabled: false, everyHours: 1, lastAt: null}, Date.now()), false);
  });

  test("due when it has never run, and again once the interval has passed", () => {
    const now = Date.parse("2026-03-10T12:00:00.000Z");
    assert.equal(srv.backupDue({enabled: true, everyHours: 24, lastAt: null}, now), true);
    assert.equal(srv.backupDue({enabled: true, everyHours: 24,
      lastAt: "2026-03-10T11:00:00.000Z"}, now), false, "an hour ago, on a daily schedule");
    assert.equal(srv.backupDue({enabled: true, everyHours: 24,
      lastAt: "2026-03-09T11:00:00.000Z"}, now), true, "yesterday, so due");
  });

  test("a clock that has gone backwards means due, not never", () => {
    /* A laptop waking up, or a container with no real-time clock, can leave
       lastAt in the future — which would otherwise park the next backup
       somewhere beyond reach. */
    const now = Date.parse("2026-03-10T12:00:00.000Z");
    assert.equal(srv.backupDue({enabled: true, everyHours: 24,
      lastAt: "2027-01-01T00:00:00.000Z"}, now), true);
    assert.equal(srv.backupDue({enabled: true, everyHours: 24, lastAt: "not a date"}, now), true);
  });

  test("a run moves the clock on even when it wrote nothing", () => {
    clearBackups(); setState(someState());
    srv.writeSchedule({enabled: true, everyHours: 1, keep: 10,
                       lastAt: "2020-01-01T00:00:00.000Z"});
    assert.ok(srv.runScheduledBackup(), "due, so it writes");
    const after = srv.readSchedule();
    assert.ok(Date.parse(after.lastAt) > Date.parse("2020-01-01T00:00:00.000Z"));

    // Due again, but the state has not moved, so no file — and the clock still
    // advances, or every tick would re-read and re-compare the whole document.
    srv.writeSchedule(Object.assign({}, after, {lastAt: "2020-01-01T00:00:00.000Z"}));
    assert.equal(srv.runScheduledBackup(), null, "nothing changed, nothing written");
    assert.ok(Date.parse(srv.readSchedule().lastAt) > Date.parse("2020-01-01T00:00:00.000Z"),
      "but the clock moved");
  });

  test("a scheduled run prunes to the count it was told", () => {
    clearBackups();
    fs.mkdirSync(srv.BACKUP_DIR, {recursive: true});
    for (let i = 1; i <= 6; i++){
      const day = String(i).padStart(2, "0");
      fs.writeFileSync(path.join(srv.BACKUP_DIR, `backup-202602${day}-100000-scheduled.json`),
        JSON.stringify({app: "cycling-weather-matrix", version: 1, reason: "scheduled",
                        backupAt: `2026-02-${day}T10:00:00.000Z`, state: someState(9, 9)}));
    }
    setState(someState(7, 7));
    srv.writeSchedule({enabled: true, everyHours: 1, keep: 3, lastAt: null});
    srv.runScheduledBackup();
    assert.equal(srv.listBackups().length, 3);
  });

  /* The regression this guards: the run used to end in a bare
     catch(e){ return null; }, which is also what "nothing due" returns. A
     backup directory that went unwritable stopped every scheduled backup with
     nothing logged, nothing reported, and the Backup tab still saying it was
     on. chmod cannot stop root, so this is skipped when run as root. */
  test("a failing run is reported, not swallowed, and recovers on its own",
       {skip: typeof process.getuid === "function" && process.getuid() === 0
              && "chmod does not restrict root"}, () => {
    clearBackups(); setState(someState());
    const due = "2020-01-01T00:00:00.000Z";
    srv.writeSchedule({enabled: true, everyHours: 1, keep: 10, lastAt: due});

    const errors = [], logs = [];
    const oe = console.error, ol = console.log;
    console.error = (...a) => errors.push(a.join(" "));
    console.log = (...a) => logs.push(a.join(" "));
    fs.chmodSync(srv.BACKUP_DIR, 0o555);          // the unplugged or full disk
    try{
      assert.equal(srv.runScheduledBackup(), null, "nothing could be written");
      srv.runScheduledBackup();
      srv.runScheduledBackup();

      const f = srv.lastScheduleFailure();
      assert.ok(f, "the failure is recorded rather than thrown away");
      assert.match(f.message, /EACCES|EPERM/, "and says why");
      assert.equal(f.dir, srv.BACKUP_DIR, "and where");
      assert.equal(errors.length, 1, "logged once for three failing ticks, not three times");
      assert.match(errors[0], /Scheduled backup failed/);
      assert.equal(srv.readSchedule().lastAt, due,
        "the clock does not move on a failure, so the next tick retries");
      assert.equal(srv.listBackups().length, 0);
    }finally{
      fs.chmodSync(srv.BACKUP_DIR, 0o755);        // always, or cleanup cannot delete it
      console.error = oe; console.log = ol;
    }

    // The disk is back: the very next tick writes, and says it recovered.
    const recovered = [];
    console.log = (...a) => recovered.push(a.join(" "));
    try{
      assert.ok(srv.runScheduledBackup(), "recovers without anyone intervening");
    }finally{ console.log = ol; }
    assert.equal(srv.lastScheduleFailure(), null, "and the failure clears");
    assert.ok(recovered.some(l => /working again/.test(l)), "and the recovery is logged");
    assert.ok(Date.parse(srv.readSchedule().lastAt) > Date.parse(due));
  });
});

/* --- Limits ----------------------------------------------------- */

describe("the backup rate limit", () => {
  test("is its own bucket, so gear lookups cannot block a restore", () => {
    /* Found by testing rather than by reading: sharing the lookup's twelve a
       minute meant a handful of lookups could leave a restore refused -- the
       one operation you reach for precisely because something has already
       gone wrong. */
    srv.RATE.hits.clear(); srv.BACKUP_RATE.hits.clear();
    const key = "same-caller";
    for (let i = 0; i < srv.RATE.max + 5; i++) srv.rateLimited(key);
    assert.equal(srv.rateLimited(key), true, "the lookup budget is spent");
    assert.equal(srv.rateLimited(key, srv.BACKUP_RATE), false,
      "and the backup budget is untouched by it");
    srv.RATE.hits.clear(); srv.BACKUP_RATE.hits.clear();
  });

  test("still bites, and is more generous than the lookup's", () => {
    srv.BACKUP_RATE.hits.clear();
    const key = "loop-" + Date.now();
    let allowed = 0;
    for (let i = 0; i < srv.BACKUP_RATE.max + 5; i++)
      if (!srv.rateLimited(key, srv.BACKUP_RATE)) allowed++;
    assert.equal(allowed, srv.BACKUP_RATE.max);
    assert.ok(srv.BACKUP_RATE.max > srv.RATE.max);
    srv.BACKUP_RATE.hits.clear();
  });
});

/* --- The cross-origin guard every write shares ------------------- */

describe("sameOrigin", () => {
  test("lets the app's own writes through", () => {
    assert.equal(srv.sameOrigin({headers: {origin: "http://box:8765", host: "box:8765"}}), true);
  });
  test("lets through a caller with no Origin at all", () => {
    // curl, a script, the app's own sendBeacon on the way out.
    assert.equal(srv.sameOrigin({headers: {host: "box:8765"}}), true);
  });
  test("refuses another site driving it with your session", () => {
    assert.equal(srv.sameOrigin({headers: {origin: "https://evil.example", host: "box:8765"}}), false);
  });
  test("refuses an Origin it cannot even parse", () => {
    assert.equal(srv.sameOrigin({headers: {origin: "not a url", host: "box:8765"}}), false);
  });
});
