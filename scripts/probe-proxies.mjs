import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import net from "node:net";
import tls from "node:tls";

const root = resolve(process.cwd(), "..");
const timeoutMs = Number(process.env.PROXY_TIMEOUT_MS || 2500);
const concurrency = Number(process.env.PROXY_CONCURRENCY || 64);
const targetHost = "api.ipify.org";
const targetPort = 443;
const pendingSocketData = new WeakMap();

function addProxy(out, item, source) {
  if (!item?.host || !Number.isInteger(Number(item.port))) return;
  const host = String(item.host).trim().replace(/^\[|\]$/g, "");
  const port = Number(item.port);
  const kind = String(item.kind || item.type || item.protocol || "socks5").toLowerCase().replace(/socks5h/g, "socks5");
  if (!host || port < 1 || port > 65535) return;
  const key = `${kind}|${host.toLowerCase()}|${port}|${item.username || ""}|${item.password || ""}`;
  if (!out.has(key)) out.set(key, { host, port, kind, username: item.username || "", password: item.password || "", sources: new Set([source]) });
  else out.get(key).sources.add(source);
}

async function loadInventory() {
  const all = new Map();
  for (const [name, path] of [
    ["working_proxies.json", resolve(root, "working_proxies.json")],
    ["http_verified_proxies.json", resolve(root, "http_verified_proxies.json")],
    ["top_proxies_fixtures.json", resolve(root, "top_proxies_fixtures.json")],
  ]) {
    try {
      const data = JSON.parse(await readFile(path, "utf8"));
      for (const p of Array.isArray(data) ? data : Object.values(data)) addProxy(all, p, name);
    } catch { /* A missing optional inventory is reported in the summary. */ }
  }
  try {
    const raw = await readFile(resolve(root, "proxies_raw.txt"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const value = line.trim();
      if (!value || value.startsWith("#")) continue;
      try {
        const u = new URL(value.includes("://") ? value : `socks5://${value}`);
        addProxy(all, { kind: u.protocol.slice(0, -1), host: u.hostname, port: u.port, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) }, "proxies_raw.txt");
      } catch { /* Ignore malformed lines; they are counted separately below. */ }
    }
  } catch {}
  try {
    const src = await readFile(resolve(process.cwd(), "src/dev/mock/fixtures.ts"), "utf8");
    const section = src.match(/const PROXIES: ProxyEntry\[\] = \[([\s\S]*?)\n\];/)?.[1] || "";
    for (const row of section.matchAll(/\{([^{}]+)\}/g)) {
      const text = row[1];
      const field = (name) => text.match(new RegExp(`\\b${name}:\\s*([^,]+)`))?.[1]?.trim();
      const unquote = (v) => v?.replace(/^['"]|['"]$/g, "");
      addProxy(all, { host: unquote(field("host")), port: Number(field("port")), kind: unquote(field("kind")), username: unquote(field("username")) || "", password: unquote(field("password")) || "" }, "ShardBrowser fixtures");
    }
  } catch {}
  return [...all.values()].map((p) => ({ ...p, sources: [...p.sources] }));
}

function connect(host, port) {
  return new Promise((resolveSocket, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => socket.destroy(new Error("connect timeout")), timeoutMs);
    socket.once("connect", () => { clearTimeout(timer); resolveSocket(socket); });
    socket.once("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

function readExactly(socket, bytes, phase = "proxy response") {
  return new Promise((resolveData, reject) => {
    const saved = pendingSocketData.get(socket) || Buffer.alloc(0);
    if (saved.length >= bytes) {
      pendingSocketData.set(socket, saved.subarray(bytes));
      resolveData(saved.subarray(0, bytes));
      return;
    }
    let buffer = saved;
    pendingSocketData.delete(socket);
    const cleanup = () => { socket.off("data", onData); socket.off("error", onError); socket.off("close", onClose); clearTimeout(timer); };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= bytes) {
        cleanup();
        pendingSocketData.set(socket, buffer.subarray(bytes));
        resolveData(buffer.subarray(0, bytes));
      }
    };
    const onError = (e) => { cleanup(); reject(e); };
    const onClose = () => { cleanup(); reject(new Error(`${phase}: connection closed`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`${phase} timeout`)); }, timeoutMs);
    socket.on("data", onData); socket.once("error", onError); socket.once("close", onClose);
  });
}

function readHeader(socket) {
  return new Promise((resolveHeader, reject) => {
    let buffer = Buffer.alloc(0);
    const cleanup = () => { socket.off("data", onData); socket.off("error", onError); socket.off("close", onClose); clearTimeout(timer); };
    const onData = (chunk) => { buffer = Buffer.concat([buffer, chunk]); const end = buffer.indexOf("\r\n\r\n"); if (end >= 0) { cleanup(); resolveHeader(buffer.subarray(0, end + 4).toString("latin1")); } };
    const onError = (e) => { cleanup(); reject(e); };
    const onClose = () => { cleanup(); reject(new Error("connection closed")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("proxy response timeout")); }, timeoutMs);
    socket.on("data", onData); socket.once("error", onError); socket.once("close", onClose);
  });
}

async function socksTunnel(proxy, socket) {
  const hasAuth = !!(proxy.username || proxy.password);
  socket.write(Buffer.from(hasAuth ? [5, 2, 0, 2] : [5, 1, 0]));
  const method = await readExactly(socket, 2, "SOCKS5 greeting");
  if (method[0] !== 5 || method[1] === 255) throw new Error("SOCKS5 auth method rejected");
  if (method[1] === 2) {
    const user = Buffer.from(proxy.username); const pass = Buffer.from(proxy.password);
    if (user.length > 255 || pass.length > 255) throw new Error("SOCKS5 credentials too long");
    socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
    const auth = await readExactly(socket, 2, "SOCKS5 authentication");
    if (auth[1] !== 0) throw new Error("SOCKS5 authentication rejected");
  } else if (method[1] !== 0) throw new Error(`unsupported SOCKS5 auth ${method[1]}`);
  const domain = Buffer.from(targetHost);
  socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, domain.length]), domain, Buffer.from([targetPort >> 8, targetPort & 255])]));
  const head = await readExactly(socket, 4, "SOCKS5 CONNECT reply");
  if (head[0] !== 5 || head[1] !== 0) throw new Error(`SOCKS5 connect refused (${head[1]})`);
  const addrLen = head[3] === 1 ? 4 : head[3] === 4 ? 16 : (await readExactly(socket, 1, "SOCKS5 bind address length"))[0];
  await readExactly(socket, addrLen + 2, "SOCKS5 bind address");
}

async function httpTunnel(proxy, socket) {
  const auth = proxy.username || proxy.password
    ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64")}\r\n`
    : "";
  socket.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}Connection: keep-alive\r\n\r\n`);
  const header = await readHeader(socket);
  const status = Number(header.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/i)?.[1] || 0);
  if (status !== 200) throw new Error(`HTTP CONNECT returned ${status || "invalid status"}`);
}

async function probe(proxy) {
  const t0 = Date.now();
  let socket;
  try {
    socket = await connect(proxy.host, proxy.port);
    const kind = proxy.kind.includes("socks") ? "socks5" : "http";
    if (kind === "socks5") await socksTunnel(proxy, socket);
    else await httpTunnel(proxy, socket);
    const secure = await new Promise((resolveTls, rejectTls) => {
      const tlsSocket = tls.connect({ socket, servername: targetHost, rejectUnauthorized: true });
      const timer = setTimeout(() => tlsSocket.destroy(new Error("TLS timeout")), timeoutMs);
      tlsSocket.once("secureConnect", () => { clearTimeout(timer); resolveTls(tlsSocket); });
      tlsSocket.once("error", (e) => { clearTimeout(timer); rejectTls(e); });
    });
    const body = await new Promise((resolveBody, rejectBody) => {
      let data = "";
      const timer = setTimeout(() => { secure.destroy(); rejectBody(new Error("HTTPS response timeout")); }, timeoutMs);
      secure.on("data", (chunk) => {
        data += chunk.toString("utf8");
        const sep = data.indexOf("\r\n\r\n");
        if (sep >= 0) {
          const headers = data.slice(0, sep);
          const status = Number(headers.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/i)?.[1] || 0);
          const json = data.slice(sep + 4).match(/\{[^{}]*"ip"\s*:\s*"([^"]+)"[^{}]*\}/);
          if (status >= 200 && status < 300 && json) { clearTimeout(timer); secure.destroy(); resolveBody(json[1]); }
          else if (status >= 400) { clearTimeout(timer); secure.destroy(); rejectBody(new Error(`HTTPS status ${status}`)); }
        }
      });
      secure.once("error", (e) => { clearTimeout(timer); rejectBody(e); });
      secure.write(`GET /?format=json HTTP/1.1\r\nHost: ${targetHost}\r\nAccept: application/json\r\nConnection: close\r\nUser-Agent: DarkBrowser-probe/1.0\r\n\r\n`);
    });
    return { host: proxy.host, port: proxy.port, kind: proxy.kind, sources: proxy.sources, ok: true, exitIp: body, latencyMs: Date.now() - t0 };
  } catch (e) {
    socket?.destroy();
    return { host: proxy.host, port: proxy.port, kind: proxy.kind, sources: proxy.sources, ok: false, reason: String(e.message || e).slice(0, 160), latencyMs: Date.now() - t0 };
  }
}

async function main() {
  let proxies = await loadInventory();
  const recheckFile = process.env.PROXY_RECHECK_FILE;
  if (recheckFile) {
    const previous = JSON.parse(await readFile(resolve(root, recheckFile), "utf8"));
    proxies = (previous.working || previous.candidates || []).map((p) => ({ ...p, sources: p.sources || ["previous HTTPS pass"] }));
  }
  const filter = process.env.PROXY_FILTER;
  if (filter) proxies = proxies.filter((p) => `${p.host}:${p.port}`.includes(filter));
  if (!proxies.length) throw new Error("No proxy entries found in the project inventories.");
  console.log(`Testing ${proxies.length} unique proxy endpoints against an HTTPS IP echo service (${concurrency} concurrent).`);
  const results = new Array(proxies.length);
  let next = 0; let done = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= proxies.length) return;
      results[i] = await probe(proxies[i]);
      done++;
      if (done % 100 === 0 || done === proxies.length) console.log(`Completed ${done}/${proxies.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, proxies.length) }, worker));
  const ok = results.filter((r) => r.ok);
  const summary = {
    testedAt: new Date().toISOString(), target: `https://${targetHost}/?format=json`, uniqueEndpoints: results.length,
    passed: ok.length, failed: results.length - ok.length,
    sources: [...new Set(proxies.flatMap((p) => p.sources))],
    working: ok.sort((a, b) => a.latencyMs - b.latencyMs),
    results,
  };
  const out = resolve(root, process.env.PROXY_OUTPUT || (filter ? "docs/proxy-probe-single.json" : "docs/proxy-probe-results.json"));
  await writeFile(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ uniqueEndpoints: summary.uniqueEndpoints, passed: summary.passed, failed: summary.failed, output: out, working: summary.working.slice(0, 12) }, null, 2));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
