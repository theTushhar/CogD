import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export function resolveNpmGlobalBin() {
  if (process.platform !== "win32") return "";
  try {
    const npmPrefix = execSync("npm config get prefix", { encoding: "utf8", timeout: 5000 }).trim();
    if (npmPrefix) return path.join(npmPrefix, "");
  } catch {
  }
  return process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : "";
}

function ensurePathWithNpmBin(env) {
  const npmBin = resolveNpmGlobalBin();
  if (!npmBin || process.platform !== "win32") return env;
  
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") || "PATH";
  const currentPath = env[pathKey] || "";
  const paths = currentPath.split(";");
  if (!paths.some((p) => p.toLowerCase() === npmBin.toLowerCase())) {
    return { ...env, [pathKey]: npmBin + ";" + currentPath };
  }
  return env;
}

export class ProviderAdapter {
  constructor(config = {}) {
    this.name = config.name ?? "generic";
    this.command = config.command;
    this.args = config.args ?? [];
    this.env = { ...process.env, ...config.env };
    this.cwd = config.cwd ?? process.cwd();
  }

  async execute(task, context, config) {
    const startTime = Date.now();

    const mergedArgs = config?.args ? [...this.args, ...config.args] : this.args;
    const mergedEnv = config?.env ? { ...this.env, ...config.env } : this.env;
    const instructions = this.#buildInstructions(task, context);
    const result = await this.#invoke(instructions, mergedArgs, mergedEnv);

    return {
      status: result.exitCode === 0 ? "completed" : "failed",
      summary: this.#extractSummary(result),
      patches: this.#extractPatches(result),
      artifacts: {
        stdout: result.stdout?.slice(0, 10000),
        stderr: result.stderr?.slice(0, 5000),
        exitCode: result.exitCode,
        duration: Date.now() - startTime
      },
      duration: Date.now() - startTime
    };
  }

  #buildInstructions(task, context) {
    return {
      task: {
        id: task.id,
        goal: task.goal ?? task.description ?? "",
        provider: this.name
      },
      context: {
        relevantMemory: context.memory ?? [],
        architecture: context.architecture ?? "",
        projectDocs: context.docs ?? "",
        priorArtifacts: context.artifacts ?? []
      }
    };
  }

  #invoke(instructions, args, env) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const verbose = process.env.COG_VERBOSE === "1";
      const resolvedEnv = ensurePathWithNpmBin(env ?? this.env);
      const isWin = process.platform === "win32";

      const child = spawn(this.command, args ?? this.args, {
        cwd: this.cwd,
        env: resolvedEnv,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: isWin
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
          duration: Date.now() - startTime
        });
      });

      child.on("error", (err) => {
        resolve({
          exitCode: 1,
          stdout,
          stderr: err.message,
          duration: Date.now() - startTime
        });
      });

      const input = JSON.stringify(instructions);
      child.stdin.write(input);
      child.stdin.end();

      const timeout = 300_000;
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({
          exitCode: 124,
          stdout,
          stderr: "Execution timed out after 300s",
          duration: Date.now() - startTime
        });
      }, timeout);

      child.on("close", () => clearTimeout(timer));
    });
  }

  #extractSummary(result) {
    const lines = result.stdout?.split("\n") ?? [];
    const summaryLines = lines.filter((l) => l.startsWith("[summary]") || l.startsWith("summary:"));
    if (summaryLines.length > 0) {
      return summaryLines.map((l) => l.replace(/^\[summary\]\s*/i, "").replace(/^summary:\s*/i, "")).join("\n");
    }
    if (result.stderr?.trim()) {
      return `Exit code ${result.exitCode}: ${result.stderr.trim().split("\n").pop()}`;
    }
    return `Task completed with exit code ${result.exitCode}`;
  }

  #extractPatches(result) {
    const lines = result.stdout?.split("\n") ?? [];
    const patches = [];
    let currentPatch = null;

    for (const line of lines) {
      if (line.startsWith("[patch:start]") || line.startsWith("patch:start")) {
        currentPatch = { file: "", diff: "", summary: "" };
        const match = line.match(/file:\s*(\S+)/);
        if (match) currentPatch.file = match[1];
      } else if ((line.startsWith("[patch:end]") || line.startsWith("patch:end")) && currentPatch) {
        patches.push(currentPatch);
        currentPatch = null;
      } else if (currentPatch) {
        currentPatch.diff += line + "\n";
      }
    }

    return patches;
  }

  validate() {
    if (!this.command) {
      return { valid: false, error: "No command configured" };
    }
    return { valid: true };
  }
}
