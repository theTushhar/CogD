import { ProviderAdapter } from "../lib/adapter.js";

export function register(registry) {
  const adapter = new ProviderAdapter({
    name: "claude",
    command: "npx",
    args: ["@anthropic-ai/claude-code", "--print", "--output-format=json"],
    env: {},
    cwd: process.cwd()
  });

  adapter.execute = async function(task, context, config) {
    const startTime = Date.now();
    const prompt = buildPrompt(task, context);
    const mergedArgs = config?.args ? [...this.args, ...config.args] : this.args;
    const mergedEnv = config?.env ? { ...process.env, ...config.env } : { ...process.env };
    const result = await invokeClaude(prompt, mergedArgs, mergedEnv);

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

  registry.register("claude", adapter);
}

function buildPrompt(task, context) {
  const lines = ["[goal]", task.goal ?? task.description ?? "", ""];

  if (context.memory?.semantic?.length > 0) {
    lines.push("[relevant context]");
    for (const entry of context.memory.semantic.slice(-3)) {
      if (entry.insight) lines.push("- " + entry.insight);
    }
    lines.push("");
  }

  if (context.architecture) {
    lines.push("[architecture]", context.architecture.slice(0, 2000), "");
  }

  if (context.recentTasks?.length > 0) {
    lines.push("[recent related work]");
    for (const t of context.recentTasks.slice(-3)) {
      lines.push(`- ${t.goal} (${t.status}) via ${t.provider}`);
    }
    lines.push("");
  }

  lines.push(
    "[instructions]",
    "1. Analyze the goal and context above.",
    "2. Execute the necessary work in the codebase.",
    "3. Output a summary prefixed with 'summary:'.",
    "4. For each file change, output between [patch:start file=<path>] and [patch:end] markers.",
    "5. Include any architecture decisions or important context in the summary."
  );

  return lines.join("\n");
}

async function invokeClaude(prompt, args, env) {
  const { spawn } = await import("node:child_process");

  return new Promise((resolve) => {
    const startTime = Date.now();
    const verbose = process.env.COG_VERBOSE === "1";
    const child = spawn("npx", args ?? ["@anthropic-ai/claude-code", "--print", "--output-format=json"], {
      cwd: process.cwd(),
      env: env ?? { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
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
  const summaryLines = lines.filter(
    (l) => l.startsWith("summary:") || l.startsWith("[summary]")
  );
  if (summaryLines.length > 0) {
    return summaryLines
      .map((l) => l.replace(/^summary:\s*/i, "").replace(/^\[summary\]\s*/i, ""))
      .join("\n");
  }
  if (result.stderr?.trim()) {
    return `Claude completed with exit code ${result.exitCode}: ${result.stderr.trim().split("\n").pop()}`;
  }
  return `Claude completed with exit code ${result.exitCode}`;
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
