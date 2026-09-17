# Working agreements

Instructions for working on the Cycling Weather Effect Matrix. They come from how this project was actually built and what proved itself. The reasoning, the decisions and the full history are in [PROJECT.md](PROJECT.md); `README.md` explains the app and `INSTALL.md` how to run it.

## Definition of done

- **Build it, test it, push it.** A change is finished when it is implemented, verified, committed and pushed to `origin` (`rnvegter/cycling-weather-matrix`, private). Say plainly if any of those did not happen.
- **Run `npm test` before every commit.** All tests must pass. The script is `node --test`; the directory form `node --test test/` fails on Node 26.
- **Update `README.md` or `INSTALL.md`** when a change alters what the app does or how it is deployed.

## Asking and scope

- **Ask only when a request is genuinely unclear**, and then as a few multiple-choice questions with the recommended option first. Make routine choices yourself and state them.
- **Fix what was asked.** Report adjacent bugs you find and offer them as a next step instead of widening the change quietly.
- **Check a finding before acting on it** — an external code review, a scraper result, or your own earlier claim. Confirm it against the code, the config or the live service first.

## Verification

- **Prove a bug before fixing it.** Write the test, run it against the old code and watch it fail, then fix and watch it pass. A regression test that was never seen failing is not trusted.
- **Measure, don't reason.** Check behaviour against the real thing: live Open-Meteo responses, a real container, measured DOM sizes rather than an eyeballed screenshot.
- **Use the app's own functions** when quoting a downstream effect, not an approximation of them.
- **Verify user-visible changes in the real app** on an isolated server: a spare port and a scratch `STATE_DIR` (and `BACKUP_DIR`) in the session scratchpad. Preview configs live in the parent folder's `.claude/launch.json`; add a temporary entry and remove it afterwards.
- **Never touch the rider's data.** Do not write to the real `state.json`, `backups/`, or the running instance's history and gear. Remove every test ride, favourite, container, volume, image and scratch file you create.

## Reporting

- **Report honestly.** Say what was not done, not tested, or only partly fixed. Name a trade-off rather than hiding it inside a loose test tolerance. Correct a wrong earlier statement plainly and move on.
- **Lead with the outcome** in plain language; give the evidence and numbers after.

## Commits

- **Explain why, not only what:** the problem, the evidence that it was real, what changed downstream, and what is still open.
- End with a `Co-Authored-By:` line naming the Claude model used.
- Commit only files that belong to the change. Never commit `state.json`, `state.prev.json` or `backups/`.

## Code rules

- **Zero dependencies.** No npm packages, no bundler, no build step. Node ≥ 18 built-ins only; tests on `node:test` and `node:assert`.
- **Match the surrounding code:** plain browser scripts sharing one global scope (load order is set in `index.html`), comments that explain *why*, and the existing naming.
- **Browser scripts in tests** are loaded with `vm.runInThisContext` in `index.html` order, with an in-memory `localStorage` where needed. `parseGPX` needs `DOMParser`, so test what runs on its output instead.
- **`server.js` listens only when run directly** and exports its internals for tests. Keep it that way.
- **Escape everything rendered** with `escHtml` or `textContent`.
- **Normalise everything that arrives** from storage, sync, import or a backup, field by field. When adding a field to a ride, favourite or gear item, add it to the matching normalise function too, or sync will silently drop it.
- **Optional feeds must never cost the answer.** Ensemble, pollen and similar fetches are wrapped so a failure removes one line, not the forecast.

## Model and data rules

- **The rider's own calibration beats a maker's rating.** Stored `tmin`/`tmax` are ride-feel ranges for when this rider reaches for a garment; a maker's air-temperature range goes in the note.
- **No cliffs in the model.** Thresholds ramp rather than step. Ride-feel must stay monotonic in air temperature, and a test guards it.
- **Speed touches ride-feel only through `selfWindTerm`,** which keeps the speed correction in `history.js` exact. Do not add a second route for speed.
- **Extremities use the air-based number,** not the run-hot calibration.
- **Treat the gear lookup service as a starting point.** Confirm a surprising scraped value before applying it.
- **Changing the seed in `gear.js` does not reach an existing install** — a saved gear list wins. Say so whenever a change edits the seed.
- **Mind the sign convention:** a verdict of "too warm" is +2 and means the model read *cold*.

## Security constraints

- **The static allow-list (`isServable`) must keep refusing** dotfiles, `.git`, `deploy/`, `backups/`, `node_modules`, `server.js`, `package.json`, `Dockerfile` and every `.md` and `.json`.
- **Outbound fetches go through `checkedURL`:** resolved, private and link-local ranges refused, redirects re-checked hop by hop, ports 80 and 443 only.
- **The client IP for rate limiting** is read `TRUST_PROXY_HOPS` entries from the end of `X-Forwarded-For`, and only from a loopback peer.
- **Every writing route checks `sameOrigin`.** The API has no authentication of its own by design; it relies on the reverse proxy.

## Deployment facts to keep straight

- **Containers are replaced, not restarted,** to pick up a new image. State lives in the `cwem-state` volume at `/state`.
- **A host folder for backups** needs owner `1000:1000` and the `:Z` mount flag on SELinux hosts; rootless Podman uses `:Z,U`.
- **Under systemd the checkout stays root-owned and read-only;** state goes to `/var/lib/cycling-weather-matrix`.
- **Prove an update landed** by comparing the checksum of the served `model.js` with the checkout's.

## Working in this environment

- **A hook may ask for facts** before the first shell command or the first edit of a file. Answer it briefly and retry the same operation.
- **If the app has been quitting mid-task,** split long shell commands into small steps and save output to a file before reading it.
