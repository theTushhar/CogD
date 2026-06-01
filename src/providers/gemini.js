import { ProviderAdapter, resolveNpmGlobalBin } from "../lib/adapter.js";

export function register(registry) {
  const adapter = new ProviderAdapter({
    name: "gemini",
    command: "gemini",
    args: ["--prompt", "-", "--approval-mode", "yolo"],
    env: {},
    cwd: process.cwd()
  });

  adapter.execute = async function(task, context, config) {
    const startTime = Date.now();
    const prompt = buildPrompt(task, context);
    const mergedArgs = config?.args ? [...this.args, ...config.args] : this.args;
    const mergedEnv = config?.env ? { ...process.env, ...config.env } : { ...process.env };
    const result = await invokeCLI(prompt, mergedArgs, mergedEnv);

    return {
      status: result.exitCode === 0 ? "completed" : "failed",
      summary: extractSummary(result),
      patches: extractPatches(result),
      artifacts: {
        stdout: result.stdout?.slice(0, 10000),
        stderr: result.stderr?.slice(0, 5000),
        exitCode: result.exitCode,
        duration: Date.now() - startTime
      },
      duration: Date.now() - startTime
    };
  };

  registry.register("gemini", adapter);
}

function buildPrompt(task, context) {
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
    "Prefix summary with 'summary:'.",
    "Mark file changes between [patch:start file=<path>] and [patch:end]."
  );

  return lines.join("\n");
}

async function invokeCLI(prompt, args, env) {
  const { spawn } = await import("node:child_process");
  const path = await import("node:path");

  return new Promise((resolve) => {
    const startTime = Date.now();
    const verbose = process.env.COG_VERBOSE === "1";
    const resolvedEnv = { ...process.env, ...(env ?? {}) };
    const npmBin = resolveNpmGlobalBin();
    
    const isWin = process.platform === "win32";
    const cmd = (isWin && npmBin) ? path.join(npmBin, "gemini.cmd") : "gemini";

    if (npmBin && isWin) {
      const pathKey = Object.keys(resolvedEnv).find((k) => k.toUpperCase() === "PATH") || "PATH";
      const currentPath = resolvedEnv[pathKey] || "";
      const paths = currentPath.split(";");
      if (!paths.some((p) => p.toLowerCase() === npmBin.toLowerCase())) {
        resolvedEnv[pathKey] = npmBin + ";" + currentPath;
      }
    }

    const child = spawn(cmd, args ?? [], {
      cwd: process.cwd(),
      env: resolvedEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: isWin ? "powershell.exe" : false
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
      resolve({ exitCode: exitCode ?? 1, stdout, stderr, duration: Date.now() - startTime });
    });

    child.on("error", (err) => {
      resolve({ exitCode: 1, stdout, stderr: err.message, duration: Date.now() - startTime });
    });

    child.stdin.write(prompt);
    child.stdin.end();

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ exitCode: 124, stdout, stderr: "Timed out", duration: Date.now() - startTime });
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
  return `Gemini completed with exit code ${result.exitCode}`;
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
    if ((line.startsWith("[patch:end]") || line.startsWith("patch:end")) && current) {
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
