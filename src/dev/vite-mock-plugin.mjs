// `npm run dev:mock` and `npm run preview:mock`: runs the frontend in a plain
// browser against an in-page stand-in for the Tauri IPC bridge
// (src/dev/mock), with seeded profiles, proxies, fingerprints and a
// ProxyShard account. The shim script is injected ahead of the app entry so
// `invoke` finds it on first call. Plain JS, so vite.config.ts can load it
// without a TypeScript loader; `npm run strip:dev` deletes it with the rest of
// src/dev. Never active in `tauri dev` or a release build.
import { launchBrowserProfile, killBrowserProfile, getRunningProcesses, focusBrowserProfile, openChromiumTab } from "./ghostLauncher.mjs";

export function mockIpc() {
  return {
    name: "shardx-mock-ipc",
    transformIndexHtml: {
      // "pre" so a mock build (`npm run preview:mock`) bundles the shim too.
      order: "pre",
      handler(html) {
        return {
          html,
          tags: [{ tag: "script", attrs: { type: "module", src: "/src/dev/mock/install.ts" }, injectTo: "head" }],
        };
      },
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url === "/__api/ghost/launch" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", async () => {
            try {
              const data = JSON.parse(body || "{}");
              const outcome = await launchBrowserProfile(data);
              res.setHeader("Content-Type", "application/json");
              res.statusCode = 200;
              res.end(JSON.stringify({ ok: true, ...outcome }));
            } catch (err) {
              console.error("[Darkbyte Ghost] Error launching browser:", err);
              res.setHeader("Content-Type", "application/json");
              res.statusCode = 500;
              res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
            }
          });
          return;
        }

        if (req.url === "/__api/ghost/focus" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              const data = JSON.parse(body || "{}");
              const ok = focusBrowserProfile(data.profileId);
              res.setHeader("Content-Type", "application/json");
              res.statusCode = 200;
              res.end(JSON.stringify({ ok }));
            } catch (err) {
              res.setHeader("Content-Type", "application/json");
              res.statusCode = 500;
              res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
            }
          });
          return;
        }

        if (req.url === "/__api/ghost/kill" && req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => { body += chunk; });
          req.on("end", () => {
            try {
              const data = JSON.parse(body || "{}");
              const ok = killBrowserProfile(data.profileId);
              res.setHeader("Content-Type", "application/json");
              res.statusCode = 200;
              res.end(JSON.stringify({ ok }));
            } catch (err) {
              res.setHeader("Content-Type", "application/json");
              res.statusCode = 500;
              res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
            }
          });
          return;
        }

        if (req.url === "/__api/ghost/open-ui" && req.method === "POST") {
          try {
            const outcome = openChromiumTab();
            res.setHeader("Content-Type", "application/json");
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, ...outcome }));
          } catch (err) {
            res.setHeader("Content-Type", "application/json");
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
          }
          return;
        }

        if (req.url === "/__api/ghost/running" && req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, running: getRunningProcesses() }));
          return;
        }

        next();
      });
    },
  };
}
