#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, execSync } from "node:child_process";
import {
  ensureWorkspace,
  getAgentPaths,
  getProjectRoot,
  loadConfig,
  saveConfig,
  ensureConfig,
} from "./lib/workspace.js";
import {
  cleanupStalePid,
  loadDaemonState,
  saveDaemonState,
  isPidAlive,
} from "./lib/daemon.js";
import { Runtime } from "./lib/runtime.js";
import { ProviderRegistry } from "./lib/provider.js";
import { ProviderAdapter, resolveNpmGlobalBin } from "./lib/adapter.js";
import { ReflectionEngine } from "./lib/reflection.js";
import { LockManager } from "./lib/locks.js";
import { SessionManager } from "./lib/sessions.js";
import { WorkflowEngine } from "./lib/workflow.js";
import { ReviewManager } from "./lib/reviews.js";
import { PatchManager } from "./lib/patches.js";
import {
  initProviderFile,
  getSupportedProviders,
} from "./lib/init-provider.js";

async function initRuntime(paths) {
  const runtime = new Runtime(paths);
  await setupProviders(runtime);
  setupReflection(runtime);
  runtime.workflows = new WorkflowEngine(paths.workflowsDir, runtime.bus);
  runtime.locks = new LockManager(paths.locksDir);
  runtime.sessions = new SessionManager(
    paths.sessionsActiveDir,
    paths.sessionsArchivedDir,
  );
  runtime.reviews = new ReviewManager(paths.reviewsDir);
  runtime.patches = new PatchManager(paths.patchesDir);
  return runtime;
}

function loadProviderConfig() {
  return loadConfig();
}

function saveProviderConfig(config) {
  saveConfig(getProjectRoot(), config);
}

function isProviderActive(config, name) {
  const entry = config.providers[name];
  return entry ? entry.active === true : false;
}

async function setupProviders(runtime) {
  const registry = runtime.providers;
  const config = loadProviderConfig();
  let changed = false;

  autoGenerateProviderFiles(config);

  if (isProviderActive(config, "generic")) {
    registry.register(
      "generic",
      new ProviderAdapter({
        name: "generic",
        command: "node",
        args: ["-e", "console.log('[summary] Generic execution completed')"],
      }),
    );
  }

  const adaptersDir = path.join(process.cwd(), "src", "providers");
  if (fs.existsSync(adaptersDir)) {
    let files;
    try {
      files = fs.readdirSync(adaptersDir);
    } catch {
      files = [];
    }
    const imports = [];
    for (const file of files) {
      if (file.endsWith(".js") && !file.startsWith("_")) {
        const modPath = path.resolve(adaptersDir, file);
        const modUrl = new URL(`file://${modPath.replace(/\\/g, "/")}`);
        imports.push(
          import(modUrl.href)
            .then((mod) => {
              if (typeof mod.register === "function") {
                mod.register(registry);
              }
            })
            .catch((err) => {
              console.error(
                `[daemon] failed to load provider adapter: ${file}`,
                err.message,
              );
            }),
        );
      }
    }
    await Promise.all(imports);
  }

  if (config.autoDetect) {
    const detected = await registry.detectAvailable();
    const auto = detected.filter((f) => f.source === "detected");
    for (const p of auto) {
      if (!config.providers[p.name]) {
        config.providers[p.name] = { active: true };
        changed = true;
        console.log(`[daemon] auto-detected provider: ${p.name}`);
      } else if (!config.providers[p.name].active) {
        registry.unregister(p.name);
        console.log(`[daemon] provider available but inactive: ${p.name}`);
      } else {
        console.log(`[daemon] auto-detected provider: ${p.name}`);
      }
    }
  }

  const prefs = config.preferences.filter((p) => isProviderActive(config, p));
  registry.setPreferences(prefs);

  for (const [name, providerCfg] of Object.entries(config.providers)) {
    const { model, args, env } = providerCfg;
    const resolvedEnv = { ...(env || {}) };
    registry.setConfig(name, {
      model: model || "",
      args: args || [],
      env: resolvedEnv,
    });
  }

  if (config.agents) {
    for (const [agentName, agentCfg] of Object.entries(config.agents)) {
      const resolvedEnv = { ...(agentCfg.env || {}) };
      registry.setAgentConfig(agentName, {
        provider: agentCfg.provider || "",
        model: agentCfg.model || "",
        args: agentCfg.args || [],
        env: resolvedEnv,
      });
    }
  }

  validateProviderCommands(config);

  if (changed) saveProviderConfig(config);
}

function autoGenerateProviderFiles(config) {
  const rootDir = process.cwd();
  for (const provider of getSupportedProviders()) {
    const entry = config.providers[provider];
    if (entry && entry.active) {
      const result = initProviderFile(provider, rootDir);
      if (result.success) {
        console.log(
          `[daemon] auto-generated ${result.outputFile} for active provider "${provider}"`,
        );
      }
    }
  }
}

function providerCommandInfo(name) {
  const map = {
    claude: { cmd: "npx", args: [] },
    openclaude: { cmd: "openclaude", args: [] },
    opencode: { cmd: "opencode", args: [] },
    codex: { cmd: "codex", args: [] },
    gemini: { cmd: "gemini", args: [] },
    copilot: { cmd: "copilot", args: [] },
    openhands: { cmd: "openhands", args: [] },
    antigravity: { cmd: "antigravity", args: [] },
  };
  return map[name] || null;
}

function checkCommandAvailable(cmd) {
  try {
    const isWin = process.platform === "win32";
    execSync(isWin ? `where ${cmd}` : `which ${cmd}`, {
      encoding: "utf8",
      timeout: 3000,
      stdio: "pipe",
    });
    return true;
  } catch {
    // Check npm global bin directory
    const npmBin = resolveNpmGlobalBin();
    if (npmBin) {
      const ext = isWin ? ".cmd" : "";
      const cmdPath = path.join(npmBin, cmd + ext);
      if (fs.existsSync(cmdPath)) return true;
    }
    return false;
  }
}

function validateProviderCommands(config) {
  for (const [name, providerCfg] of Object.entries(config.providers)) {
    if (!providerCfg.active) continue;
    if (name === "generic" || name === "internal") continue;

    const info = providerCommandInfo(name);
    if (!info) continue;

    if (!checkCommandAvailable(info.cmd)) {
      console.log(
        `[daemon] WARNING: provider "${name}" is active but "${info.cmd}" was not found on PATH`,
      );
    }
  }
}

function setupReflection(runtime) {
  const reflection = new ReflectionEngine(runtime.paths, runtime.bus);
  reflection.register();
}

async function runDaemonForeground() {
  process.env.COG_VERBOSE = "1";
  const paths = getAgentPaths();
  if (!fs.existsSync(paths.agentRoot)) {
    console.log("workspace not initialized — run 'cog init' first");
    return;
  }
  const pidPath = path.join(paths.runtimeDir, "daemon.pid");
  const state = loadDaemonState(paths);

  if (cleanupStalePid(paths)) {
    console.log("daemon already running");
    return;
  }

  fs.writeFileSync(pidPath, `${process.pid}\n`);
  saveDaemonState(paths, {
    ...state,
    status: "running",
    startedAt: new Date().toISOString(),
    pid: process.pid,
  });

  const runtime = await initRuntime(paths);
  runtime.start();

  console.log(`cogd running in ${paths.rootDir}`);
  console.log(`  agents:  ${runtime.agents.list().length} registered`);
  console.log(`  providers: ${runtime.providers.list().length} available`);

  const shutdown = (signal) => {
    runtime.stop();
    saveDaemonState(paths, {
      ...loadDaemonState(paths),
      status: "stopped",
      stoppedAt: new Date().toISOString(),
      pid: null,
      stopSignal: signal,
    });

    if (fs.existsSync(pidPath)) {
      fs.rmSync(pidPath, { force: true });
    }

    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  setInterval(() => {
    if (
      runtime.pipeline.list("completed").length > 0 ||
      runtime.pipeline.list("failed").length > 0
    ) {
      runtime.bus.emit("heartbeat:tick", {
        completed: runtime.pipeline.list("completed").length,
        failed: runtime.pipeline.list("failed").length,
        pending:
          runtime.pipeline.list("queued").length +
          runtime.pipeline.list("planned").length +
          runtime.pipeline.list("executing").length,
        at: new Date().toISOString(),
      });
    }
  }, 60_000);
}

function startDaemon() {
  const child = spawn(
    process.execPath,
    [path.resolve(process.argv[1]), "start", "--foreground"],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();
  console.log("cogd started in background");
}

function findDaemonPid() {
  try {
    const isWin = process.platform === "win32";
    if (isWin) {
      try {
        const cmd = `powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name = 'node.exe'\\" | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"`;
        const output = execSync(cmd, { encoding: "utf8", timeout: 5000 }).trim();
        if (output) {
          const parsed = JSON.parse(output);
          const processes = Array.isArray(parsed) ? parsed : [parsed];
          for (const proc of processes) {
            if (proc && proc.CommandLine && proc.CommandLine.includes("daemon.js")) {
              const pid = Number(proc.ProcessId);
              if (Number.isFinite(pid)) return pid;
            }
          }
        }
      } catch {
        const output = execSync('tasklist /V /FO CSV /FI "IMAGENAME eq node.exe"', {
          encoding: "utf8",
          timeout: 5000,
        });
        const lines = output.split("\n").filter(Boolean);
        for (const line of lines) {
          if (line.includes("daemon.js")) {
            const parts = line.split('","');
            const pid = Number(parts[1]);
            if (Number.isFinite(pid)) return pid;
          }
        }
      }
    } else {
      const output = execSync("ps -eo pid,args", { encoding: "utf8", timeout: 5000 });
      const lines = output.split("\n").filter(Boolean);
      for (const line of lines) {
        if (line.includes("daemon.js")) {
          const pid = Number(line.trim().split(/\s+/)[0]);
          if (Number.isFinite(pid)) {
            return pid;
          }
        }
      }
    }
  } catch {}
  return null;
}

function stopDaemon() {
  let pid = null;
  const paths = getAgentPaths();
  const pidPath = path.join(paths.runtimeDir, "daemon.pid");

  if (fs.existsSync(pidPath)) {
    pid = Number(fs.readFileSync(pidPath, "utf8"));
    if (!Number.isFinite(pid)) {
      fs.rmSync(pidPath, { force: true });
      pid = null;
    }
  }

  if (!pid || !isPidAlive(pid)) {
    pid = findDaemonPid();
  }

  if (!pid) {
    console.log("cogd is not running");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`cogd stop signal sent to ${pid}`);
  } catch {
    console.log(`cogd process ${pid} was already stopped`);
  }

  if (fs.existsSync(pidPath)) {
    fs.rmSync(pidPath, { force: true });
  }
}

const args = process.argv.slice(2);
const command = args[0];
const flags = args.slice(1);

switch (command) {
  case "start":
    if (flags.includes("--foreground")) {
      runDaemonForeground();
    } else if (flags.includes("--verbose")) {
      process.env.COG_VERBOSE = "1";
      startDaemon();
      console.log(
        "verbose mode: provider output will be captured but not shown in background mode",
      );
      console.log("use 'cogd start --foreground' to see live provider output");
    } else {
      startDaemon();
    }
    break;
  case "stop":
    stopDaemon();
    break;
  default:
    console.log("usage: cogd start [--foreground] [--verbose] | cogd stop");
    process.exitCode = 1;
    break;
}
