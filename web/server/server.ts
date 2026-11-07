/** Support Slot server: serves the built web app and a small JSON API.
 *
 *  The booking rules are the same ones the browser build uses (createLocalRepo);
 *  here they run on the server against a JSON file, so every browser shares one
 *  database. The server, not the client, decides who is acting: for every call
 *  it overwrites the "acting user" argument with the signed-in session's user.
 *  Single process, single file: fine for a small group, not for scale. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { createLocalRepo, type Storage2 } from "../src/data/localRepo";
import { RepoError } from "../src/data/repo";

/** Index of the "acting user" argument for each authenticated method. */
const ACTOR: Record<string, number> = {
  updateProfile: 0, notifications: 0, markAllRead: 0, threads: 0, thread: 2, sendMessage: 2,
  openSlots: 0, slot: 1, apply: 1, withdraw: 1, myApplications: 0,
  myBookings: 0, booking: 1, cancelBooking: 1,
  myListings: 0, createListing: 0, cancelListing: 1, applicants: 1, accept: 1, decline: 1,
};
const PUBLIC = new Set(["signUp", "signIn", "user", "signOut"]);
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

function fileStorage(path: string): Storage2 {
  let cache: string | null = existsSync(path) ? readFileSync(path, "utf8") : null;
  return {
    getItem: () => cache,
    setItem: (_k, v) => {
      cache = v;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path + ".tmp", v); // write then rename so a crash can't leave half a file
      renameSync(path + ".tmp", path);
    },
    removeItem: () => { cache = null; },
  };
}

export interface Options { port?: number; host?: string; dataFile: string; staticDir?: string }

export function startServer(opts: Options): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  const repo = createLocalRepo({ storage: fileStorage(opts.dataFile), latencyMs: 0 }) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const sessionsFile = opts.dataFile.replace(/\.json$/, "") + ".sessions.json";
  const sessions = new Map<string, string>(existsSync(sessionsFile) ? Object.entries(JSON.parse(readFileSync(sessionsFile, "utf8"))) : []);
  const persistSessions = () => writeFileSync(sessionsFile, JSON.stringify(Object.fromEntries(sessions)));
  const failures = new Map<string, { n: number; since: number }>(); // sign-in throttle per email

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) => new Promise<string>((ok, bad) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => { size += c.length; if (size > 200_000) { bad(new RepoError("invalid", "Request too large.")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", bad);
  });

  async function rpc(req: IncomingMessage, res: ServerResponse) {
    try {
      const raw = await readBody(req);
      let body: { method?: unknown; args?: unknown };
      try { body = JSON.parse(raw); } catch { throw new RepoError("invalid", "Bad request."); }
      const method = String(body.method);
      const args = Array.isArray(body.args) ? [...body.args] : [];
      if (!PUBLIC.has(method) && !(method in ACTOR)) throw new RepoError("not_found", "Unknown action.");
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");

      if (method === "signOut") { sessions.delete(token); persistSessions(); return send(res, 200, { result: null }); }
      if (method === "user") {
        const uid = sessions.get(token);
        return send(res, 200, { result: uid && uid === args[0] ? await repo.user(uid) : null });
      }
      if (method === "signIn") {
        const email = String(args[0] ?? "").trim().toLowerCase();
        const f = failures.get(email);
        if (f && Date.now() - f.since < 10 * 60_000 && f.n >= 10) throw new RepoError("auth", "Too many attempts. Wait a few minutes and try again.");
        try {
          const user = (await repo.signIn(...args)) as { id: string };
          failures.delete(email);
          return send(res, 200, { result: { user, token: newSession(user.id) } });
        } catch (e) {
          if (e instanceof RepoError && e.code === "auth") failures.set(email, { n: (f && Date.now() - f.since < 10 * 60_000 ? f.n : 0) + 1, since: f?.since ?? Date.now() });
          throw e;
        }
      }
      if (method === "signUp") {
        const user = (await repo.signUp(...args)) as { id: string };
        return send(res, 200, { result: { user, token: newSession(user.id) } });
      }
      const uid = sessions.get(token);
      if (!uid) throw new RepoError("auth", "Please sign in again.");
      args[ACTOR[method]] = uid; // never trust the client about who is acting
      return send(res, 200, { result: await repo[method](...args) });
    } catch (e) {
      if (e instanceof RepoError) return send(res, e.code === "auth" ? 401 : e.code === "forbidden" ? 403 : e.code === "not_found" ? 404 : e.code === "conflict" ? 409 : 400, { error: { code: e.code, message: e.message } });
      console.error(e);
      send(res, 500, { error: { code: "network", message: "Something went wrong on the server." } });
    }
  }
  function newSession(userId: string) {
    const token = randomBytes(32).toString("hex");
    sessions.set(token, userId); persistSessions();
    return token;
  }

  const root = opts.staticDir ? resolve(opts.staticDir) : null;
  const serveStatic = (req: IncomingMessage, res: ServerResponse) => {
    if (!root) return send(res, 404, { error: { code: "not_found", message: "Not found." } });
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || !extname(file)) file = join(root, "index.html"); // SPA fallback
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": file.endsWith("index.html") ? "no-cache" : "public, max-age=3600" });
    res.end(readFileSync(file));
  };

  const server = createServer((req, res) => {
    res.setHeader("x-content-type-options", "nosniff");
    if (req.url === "/api/health") return send(res, 200, { ok: true });
    if (req.url === "/api/rpc" && req.method === "POST") { void rpc(req, res); return; }
    if (req.method !== "GET") return send(res, 405, { error: { code: "invalid", message: "Method not allowed." } });
    serveStatic(req, res);
  });
  return new Promise((ok) => server.listen(opts.port ?? 8787, opts.host ?? "127.0.0.1", () => {
    const addr = server.address() as { port: number };
    ok({ server, url: `http://${opts.host ?? "127.0.0.1"}:${addr.port}`, close: () => new Promise<void>((r) => server.close(() => r())) });
  }));
}

// run directly: node server/dist/server.mjs
if (process.argv[1] && /server\.m?js$/.test(process.argv[1])) {
  const here = dirname(process.argv[1]);
  const port = Number(process.env.PORT ?? 8787);
  startServer({ port, host: process.env.HOST ?? "127.0.0.1", dataFile: process.env.DATA_FILE ?? join(here, "../../data/db.json"), staticDir: join(here, "../../dist") })
    .then((s) => console.log(`Support Slot running at ${s.url}  (data: web/data/db.json)`));
}
