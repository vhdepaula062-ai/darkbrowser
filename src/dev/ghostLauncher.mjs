import { exec, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve resources from the checkout, not the shell's current directory. Vite
// can be started from a shortcut or another working directory on Windows.
const projectRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

// Active spawned browser processes by profileId
const activeProcesses = new Map();

// Candidate paths for Chromium engine (Google Chrome removed per user instruction)
function findEngineBinary() {
  const candidates = [
    // 1. Official DARKBYTE Chromium engine (pure Chromium binary)
    resolve(process.env.APPDATA || "", "darkbyte-ghost-browser/runtime/darkbyte-engine-windows-x64/chrome.exe"),
    resolve(process.env.APPDATA || "", "darkbyte-ghost-browser/runtime/darkbyte-engine-windows-x64/chromium.exe"),
    // 2. Local workspace engine builds
    resolve(projectRoot, "engine/darkbyte-engine-windows-x64/chrome.exe"),
    resolve(projectRoot, "../engine/darkbyte-engine-windows-x64/chrome.exe"),
    resolve(projectRoot, "engine/darkbyte-engine-windows-x64/chromium.exe"),
    resolve(projectRoot, "../engine/darkbyte-engine-windows-x64/chromium.exe"),
    // 3. Fallback Chromium-based engine (Edge Chromium, strictly non-Google)
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export async function launchBrowserProfile({ profileId, profile, proxy, startUrl }) {
  const enginePath = findEngineBinary();
  if (!enginePath) {
    throw new Error("Chromium engine binary not found on this system.");
  }

  // Create isolated user-data-dir
  const profilesBase = resolve(projectRoot, "../profiles");
  const udd = join(profilesBase, profileId);
  if (!existsSync(udd)) {
    mkdirSync(udd, { recursive: true });
  }

  const flags = [
    `--user-data-dir=${udd}`,
    "--new-window",
    "--start-maximized",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--no-pings",
    "--disable-sync",
    "--disable-breakpad",
    // The current machine's GPU subprocess exits with Windows access denied;
    // disabling hardware acceleration lets Chromium fall back to software.
    "--disable-gpu",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  ];

  const isDummyProxy = proxy && proxy.host && (
    proxy.host.endsWith(".example") ||
    proxy.host.startsWith("203.0.113.") ||
    proxy.host.startsWith("198.51.100.") ||
    proxy.host.startsWith("192.0.2.")
  );

  // Configure Proxy
  if (proxy && proxy.host && proxy.port) {
    const kind = (proxy.kind || "http").toLowerCase();
    
    // Only apply --proxy-server if it's NOT a dummy test proxy, OR apply it but warn
    flags.push(`--proxy-server=${kind}://${proxy.host}:${proxy.port}`);

    // If proxy has authentication, generate modern Manifest V3 extension
    if (proxy.username || proxy.password) {
      const extDir = join(udd, "darkbyte_proxy_auth");
      if (!existsSync(extDir)) {
        mkdirSync(extDir, { recursive: true });
      }

      const manifest = {
        name: "Darkbyte Ghost Proxy Auth",
        version: "1.0.0",
        manifest_version: 3,
        description: "Authenticated proxy handler for Darkbyte Ghost Browser",
        permissions: [
          "webRequest",
          "webRequestAuthProvider"
        ],
        host_permissions: [
          "<all_urls>"
        ],
        background: {
          service_worker: "background.js"
        }
      };

      const userSafe = JSON.stringify(proxy.username || "");
      const passSafe = JSON.stringify(proxy.password || "");

      const backgroundJs = `
chrome.webRequest.onAuthRequired.addListener(
  function(details) {
    return {
      authCredentials: {
        username: ${userSafe},
        password: ${passSafe}
      }
    };
  },
  { urls: ["<all_urls>"] }
);
console.log("[Darkbyte Ghost] Proxy Auth active for ${proxy.host}:${proxy.port}");
`;

      writeFileSync(join(extDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
      writeFileSync(join(extDir, "background.js"), backgroundJs, "utf8");
      flags.push(`--load-extension=${extDir}`);
    }
  }

  // Create a diagnostic welcome page in the profile folder
  const welcomeHtmlPath = join(udd, "darkbyte_status.html");
  const profileName = profile?.name || profileId;
  const proxyText = proxy && proxy.host ? `${proxy.kind || 'http'}://${proxy.host}:${proxy.port}` : "Nenhum (Conexão Direta)";
  
  const statusHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>DARKBYTE GHOST BROWSER — Status do Perfil</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1117; color: #e2e8f0; margin: 0; padding: 40px; display: flex; justify-content: center; align-items: center; min-height: 80vh; }
    .card { background: #1a1d27; border: 1px solid #2d3748; border-radius: 12px; padding: 32px; max-width: 650px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { color: #60a5fa; font-size: 24px; margin-top: 0; display: flex; align-items: center; gap: 10px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: bold; }
    .badge-ok { background: #065f46; color: #34d399; }
    .badge-warn { background: #7c2d12; color: #fb923c; }
    .info-table { width: 100%; margin: 20px 0; border-collapse: collapse; }
    .info-table td { padding: 10px; border-bottom: 1px solid #2d3748; font-size: 14px; }
    .info-table td:first-child { color: #94a3b8; font-weight: 500; width: 35%; }
    .alert-box { background: #2a1b14; border-left: 4px solid #f97316; padding: 16px; border-radius: 6px; margin-top: 20px; font-size: 14px; line-height: 1.5; }
    .btn { display: inline-block; background: #2563eb; color: #fff; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: 500; font-size: 14px; margin-top: 15px; }
    .btn:hover { background: #1d4ed8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>👻 DARKBYTE GHOST BROWSER</h1>
    <table class="info-table">
      <tr><td>Perfil Ativo:</td><td><strong>${profileName}</strong></td></tr>
      <tr><td>Status:</td><td><span class="badge badge-ok">● Executando</span></td></tr>
      <tr><td>Proxy Vinculado:</td><td><code>${proxyText}</code></td></tr>
      <tr><td>Armazenamento Isolado:</td><td><code>${udd}</code></td></tr>
    </table>

    ${isDummyProxy ? `
    <div class="alert-box">
      <strong>⚠️ Atenção: Proxy de Demonstração Detectado!</strong><br>
      O proxy configurado neste perfil (<code>${proxy.host}</code>) é um endereço fictício de exemplo (RFC 5737 / .example). Por isso, a navegação externa pode exibir falha de conexão.<br><br>
      <strong>Para navegar normalmente com proxy:</strong>
      <ol style="margin: 8px 0 0 16px; padding: 0;">
        <li>Acesse o painel do Darkbyte Ghost e vá na aba <strong>Proxies</strong>.</li>
        <li>Adicione o seu proxy real (IP público, porta e credenciais).</li>
        <li>Edite este perfil e vincule o seu novo proxy funcional.</li>
      </ol>
    </div>
    ` : `
    <div style="background: #14271f; border-left: 4px solid #10b981; padding: 16px; border-radius: 6px; margin-top: 20px; font-size: 14px;">
      <strong>✓ Perfil Pronto</strong><br>
      A conexão está configurada. Você pode abrir qualquer aba para navegar.
    </div>
    `}

    <a href="https://browserleaks.com/ip" class="btn">Testar Vazamento de IP (BrowserLeaks) →</a>
  </div>
</body>
</html>`;

  writeFileSync(welcomeHtmlPath, statusHtml, "utf8");

  // In Windows file URL format
  const welcomeUrl = `file:///${welcomeHtmlPath.replace(/\\/g, "/")}`;

  // If it's a dummy proxy, open the welcome status page so the user sees the window immediately
  // If it's a real proxy, open the target URL directly (or both)
  if (isDummyProxy) {
    flags.push(welcomeUrl);
  } else {
    const targetUrl = startUrl || "https://browserleaks.com/ip";
    flags.push(targetUrl);
  }

  // Remove stale singleton locks to avoid background attachment traps
  for (const lock of ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    const lockPath = join(udd, lock);
    if (existsSync(lockPath)) {
      try { unlinkSync(lockPath); } catch {}
    }
  }

  // Clear mismatched profile version (e.g. from Chrome 157 vs Chromium 158)
  const lv = join(udd, "Last Version");
  if (existsSync(lv)) {
    try {
      const ver = readFileSync(lv, "utf8").trim();
      if (!ver.startsWith("158.")) {
        unlinkSync(lv);
      }
    } catch {}
  }

  console.log(`[Darkbyte Ghost] Spawning Chromium engine window:`);
  console.log(`[Darkbyte Ghost] Binary: ${enginePath}`);
  console.log(`[Darkbyte Ghost] Profile: ${profileId} | Flags: ${flags.length}`);

  // Spawn Chromium itself. The bundled CreateProcess wrapper reported success
  // but did not leave a visible browser process on Windows; direct spawn does.
  console.log(`[Darkbyte Ghost] Launcher: ${enginePath}`);
  const child = spawn(enginePath, flags, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once("spawn", resolveSpawn);
    child.once("error", (error) => rejectSpawn(new Error(`Não foi possível iniciar o DARKBYTE Chromium: ${error.message}`)));
  });
  // Do not report a profile as started just because CreateProcess accepted it.
  // Catch immediate Chromium startup failures before the mock UI records a PID.
  await new Promise((resolveStart) => setTimeout(resolveStart, 1200));
  if (child.exitCode !== null) {
    throw new Error(`DARKBYTE Chromium encerrou durante a inicialização (código ${child.exitCode}).`);
  }
  child.unref();

  activeProcesses.set(profileId, {
    child,
    pid: child.pid,
    enginePath,
    udd,
    started: Date.now()
  });

  // Automatically bring the spawned window to the front
  setTimeout(() => focusBrowserProfile(profileId), 1200);
  setTimeout(() => focusBrowserProfile(profileId), 2600);

  return { pid: child.pid, enginePath, udd };
}

export function focusBrowserProfile(profileId) {
  const item = activeProcesses.get(profileId);
  const profilesBase = resolve(projectRoot, "../profiles");
  const udd = item?.udd || join(profilesBase, profileId);
  const uddEscaped = udd.replace(/\\/g, "\\\\");

  console.log(`[Darkbyte Ghost] Focusing window for profile: ${profileId}`);
  const psCommand = `$ws = New-Object -ComObject WScript.Shell; Get-CimInstance Win32_Process -Filter "Name = 'chromium.exe' or Name = 'chrome.exe' or Name = 'msedge.exe'" | Where-Object { $_.CommandLine -like "*${uddEscaped}*" } | ForEach-Object { $ws.AppActivate($_.ProcessId) }`;
  spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCommand], { stdio: "ignore", detached: true });
  return true;
}

export function killBrowserProfile(profileId) {
  const item = activeProcesses.get(profileId);
  const profilesBase = resolve(projectRoot, "../profiles");
  const udd = item?.udd || join(profilesBase, profileId);

  try {
    if (item?.child) {
      try { item.child.kill(); } catch {}
    }
    if (process.platform === "win32") {
      const uddEscaped = udd.replace(/\\/g, "\\\\");
      const psCommand = `Get-CimInstance Win32_Process -Filter "Name = 'chromium.exe' or Name = 'chrome.exe' or Name = 'msedge.exe'" | Where-Object { $_.CommandLine -like "*${uddEscaped}*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
      spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCommand], { stdio: "ignore", detached: true });
    } else if (item?.pid) {
      process.kill(item.pid);
    }
    setTimeout(() => {
      for (const lock of ["lockfile", "SingletonLock", "SingletonCookie", "SingletonSocket"]) {
        const lockPath = join(udd, lock);
        if (existsSync(lockPath)) {
          try { unlinkSync(lockPath); } catch {}
        }
      }
    }, 1000);
  } catch (err) {
    console.warn(`[Darkbyte Ghost] Error terminating profile ${profileId}:`, err);
  }

  activeProcesses.delete(profileId);
  return true;
}

export function isProfileRunning(profileId) {
  return activeProcesses.has(profileId);
}

export function getRunningProcesses() {
  const result = [];
  for (const [profileId, info] of activeProcesses.entries()) {
    result.push({ profileId, pid: info.pid, started: info.started });
  }
  return result;
}

export function openChromiumTab(url = "http://127.0.0.1:1420/?section=profiles") {
  const enginePath = findEngineBinary();
  if (!enginePath) throw new Error("Chromium engine not found");

  const profilesBase = resolve(projectRoot, "../profiles");
  const udd = join(profilesBase, "darkbrowser-main-ui");
  if (!existsSync(udd)) mkdirSync(udd, { recursive: true });

  const flags = [
    `--user-data-dir=${udd}`,
    "--new-window",
    "--start-maximized",
    "--no-first-run",
    "--no-default-browser-check",
    url
  ];

  console.log(`[Darkbyte Ghost] Opening DarkBrowser UI in pure Chromium: ${enginePath}`);
  const child = spawn(enginePath, flags, {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();

  return { pid: child.pid, enginePath };
}
