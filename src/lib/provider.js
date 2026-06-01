import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { resolveNpmGlobalBin } from "./adapter.js";

const INTERNAL = "internal";

const KNOWN_CLIS = [
  { name: "claude", cmd: "npx", args: ["@anthropic-ai/claude-code"], env: {} },
  { name: "openclaude", cmd: "openclaude", args: [], env: {} },
  { name: "opencode", cmd: "opencode", args: [], env: {} },
  { name: "codex", cmd: "codex", args: [], env: {} },
  { name: "gemini", cmd: "gemini", args: [], env: {} },
  { name: "copilot", cmd: "copilot", args: [], env: {} },
  { name: "openhands", cmd: "openhands", args: [], env: {} },
];

export class ProviderRegistry {
  #adapters;
  #preferences;
  #configs;
  #agentConfigs;

  constructor() {
    this.#adapters = new Map();
    this.#preferences = [];
    this.#configs = new Map();
    this.#agentConfigs = new Map();
    this.#registerInternal();
  }

  register(name, adapter) {
    this.#adapters.set(name, adapter);
  }

  unregister(name) {
    this.#adapters.delete(name);
  }

  setConfig(name, config) {
    this.#configs.set(name, config);
  }

  getConfig(name) {
    return this.#configs.get(name);
  }

  setAgentConfig(name, config) {
    this.#agentConfigs.set(name, config);
  }

  getAgentConfig(name) {
    return this.#agentConfigs.get(name);
  }

  setPreferences(orderedNames) {
    this.#preferences = orderedNames;
  }

  resolve(providerHint) {
    if (providerHint === INTERNAL) return this.#adapters.get(INTERNAL);
    if (providerHint) {
      return this.#adapters.get(providerHint) || null;
    }
    const preferred = this.#preferences.find((p) => this.#adapters.has(p));
    if (preferred) return this.#adapters.get(preferred);
    return this.#adapters.get(INTERNAL);
  }

  list() {
    return Array.from(this.#adapters.keys());
  }

  async detectAvailable() {
    const found = [];

    for (const cli of KNOWN_CLIS) {
      if (this.#adapters.has(cli.name)) {
        found.push({ name: cli.name, available: true, source: "registered" });
        continue;
      }
      const available = await this.#checkCommand(cli.cmd, cli.args);
      if (available) {
        found.push({ name: cli.name, available: true, source: "detected" });
        this.#adapters.set(cli.name, this.#createGenericAdapter(cli));
      }
    }

    return found;
  }

  #checkCommand(cmd, args) {
    return new Promise((resolve) => {
      const isWin = process.platform === "win32";

      // Check PATH first
      try {
        execSync(isWin ? `where ${cmd}` : `which ${cmd}`, {
          encoding: "utf8",
          timeout: 3000,
          stdio: "pipe",
        });
        resolve(true);
        return;
      } catch {}

      // Check npm global bin directory (common on Windows when npm -g is used)
      const npmBin = resolveNpmGlobalBin();
      if (npmBin) {
        const ext = isWin ? ".cmd" : "";
        const cmdPath = path.join(npmBin, cmd + ext);
        if (fs.existsSync(cmdPath)) {
          resolve(true);
          return;
        }
      }

      const child = spawn(cmd, args ?? [], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        timeout: 5000,
      });

      let resolved = false;

      child.on("error", () => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      child.on("close", (code) => {
        if (!resolved) {
          resolved = true;
          resolve(code !== 127 && code !== null);
        }
      });

      child.on("spawn", () => {
        if (!resolved) {
          resolved = true;
          child.kill();
          resolve(true);
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill();
          resolve(false);
        }
      }, 3000);
    });
  }

  #createGenericAdapter(cli) {
    return {
      name: cli.name,
      execute: async (task, context, config) => {
        const startTime = Date.now();
        const prompt = buildGenericPrompt(task, context);
        const mergedEnv = config?.env
          ? { ...process.env, ...config.env }
          : process.env;
        const mergedArgs = config?.args
          ? [...cli.args, ...config.args]
          : cli.args;
        const result = await invokeGenericCLI(
          cli.cmd,
          mergedArgs,
          prompt,
          mergedEnv,
        );

        return {
          status: result.exitCode === 0 ? "completed" : "failed",
          summary:
            extractSummary(result) ||
            `${cli.name} completed with exit code ${result.exitCode}`,
          patches: extractPatches(result),
          artifacts: {
            stdout: result.stdout?.slice(0, 10000),
            stderr: result.stderr?.slice(0, 5000),
            exitCode: result.exitCode,
            duration: Date.now() - startTime,
          },
          duration: Date.now() - startTime,
        };
      },
    };
  }

  #registerInternal() {
    this.#adapters.set(INTERNAL, {
      name: INTERNAL,
      execute: async (task, context) => {
        return {
          status: "completed",
          summary: `Internal task processed: ${task.goal ?? task.description ?? task.id}`,
          artifacts: { note: "processed internally without external provider" },
        };
      },
    });
  }
}

function buildGenericPrompt(task, context) {
  const lines = ["# Task", task.goal ?? task.description ?? "", ""];

  if (context.memory?.semantic?.length > 0) {
    lines.push("## Prior Context");
    for (const entry of context.memory.semantic.slice(-3)) {
      if (entry.insight) lines.push("- " + entry.insight);
    }
    lines.push("");
  }

  if (context.architecture) {
    lines.push("## Architecture", context.architecture.slice(0, 2000), "");
  }

  lines.push(
    "## Output Format",
    "Prefix your summary with 'summary:'.",
    "Mark file changes between [patch:start file=<path>] and [patch:end].",
  );

  return lines.join("\n");
}

function invokeGenericCLI(cmd, args, prompt, env) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const verbose = process.env.COG_VERBOSE === "1";
    const resolvedEnv = { ...process.env, ...(env ?? {}) };
    const npmBin = resolveNpmGlobalBin();
    if (npmBin && process.platform === "win32") {
      const paths = (resolvedEnv.PATH || resolvedEnv.Path || "").split(";");
      if (!paths.some((p) => p.toLowerCase() === npmBin.toLowerCase())) {
        const sep = ";";
        resolvedEnv.PATH =
          npmBin + sep + (resolvedEnv.PATH || resolvedEnv.Path || "");
      }
    }
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      env: resolvedEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (verbose) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (verbose) process.stderr.write(chunk);
    });

    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
        duration: Date.now() - startTime,
      });
    });

    child.on("error", (err) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: err.message,
        duration: Date.now() - startTime,
      });
    });

    child.stdin.write(prompt);
    child.stdin.end();

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        exitCode: 124,
        stdout,
        stderr: "Timed out",
        duration: Date.now() - startTime,
      });
    }, 600_000);

    child.on("close", () => clearTimeout(timeout));
  });
}

function extractSummary(result) {
  const lines = result.stdout?.split("\n") ?? [];
  const found = lines
    .filter((l) => /^(summary:|\[summary\])/i.test(l))
    .map((l) => l.replace(/^(summary:|\[summary\])\s*/i, ""));
  if (found.length > 0) return found.join("\n");
  if (result.stderr?.trim()) {
    return `Exit code ${result.exitCode}: ${result.stderr.trim().split("\n").pop()}`;
  }
  return "";
}

function extractPatches(result) {
  const lines = result.stdout?.split("\n") ?? [];
  const patches = [];
  let current = null;

  for (const line of lines) {
    const startMatch = line.match(/\[patch:start\]\s*file:\s*(\S+)/i);
    if (startMatch) {
      current = { file: startMatch[1], diff: "", summary: "" };
      continue;
    }
    if (
      (line.startsWith("[patch:end]") || line.startsWith("patch:end")) &&
      current
    ) {
      patches.push(current);
      current = null;
      continue;
    }
    if (current) {
      current.diff += line + "\n";
    }
  }

  return patches;
}
