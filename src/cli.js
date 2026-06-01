#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  ensureWorkspace,
  getAgentPaths,
  getProjectRoot,
} from "./lib/workspace.js";
import {
  cleanupStalePid,
  loadDaemonState,
  saveDaemonState,
} from "./lib/daemon.js";
import { ContinuityManager } from "./lib/continuity.js";
import { EventBus } from "./lib/event-bus.js";
import {
  initProviderFile,
  initAllProviders,
  SUPPORTED_PROVIDERS,
} from "./lib/init-provider.js";

function printUsage() {
  console.log(`cog commands

  init                   create the .agent workspace
  init <provider>        generate provider .md (opencode, claude, gemini)
  remove                 remove .agent workspace and clean up
  task list [status]     list tasks, optionally filtered by status
  task show <id>         show details of a specific task
  status                 show workspace and daemon status
  doctor                 validate the local setup
  events [n]             show recent n events (default 10)
  event emit <type>      emit a custom event
  memory                 show recent episodic memory
  memory semantic        show semantic memory topics
  agents                 list registered agents
  providers              list available providers (auto-detected)
  plan                   show the most recent plan
  inspect                inspect the full .agent/ workspace
  lock list              show active locks
  lock claim <name>      claim a lock
  lock release <name>    release a lock
  session list           show active sessions
  review list            list reviews
  review show <id>       show review details
  patch list             list recent patches
  workflow list          list available workflows
  workflow show <name>   show workflow steps

  resume [task]          show continuity resume capsule
  finalize [status] [summary]  save execution summary
  work-state [start|update|close]  manage active work state
  decision [record <title> <decision>]  manage project decisions
  continuity-view        generate continuity report and map
`);
}

function formatStatus(paths, daemonState, daemonPid) {
  return [
    `project:  ${paths.rootDir}`,
    `agent:    ${paths.agentRoot}`,
    `daemon:   ${daemonState.status}`,
    `pid:      ${daemonPid ?? "—"}`,
    `started:  ${daemonState.startedAt ?? "—"}`,
  ].join("\n");
}

function removeWorkspace() {
  const paths = getAgentPaths();
  const providerFiles = [
    "AGENTS.md",
    "CLAUDE.md",
    "OPENCLAUDE.md",
    "GEMINI.md",
    ".cursorrules",
    "cog.json",
    "cog.default.json",
  ];

  if (!fs.existsSync(paths.agentRoot)) {
    console.log("no .agent workspace to remove");
  }

  try {
    // 1. Remove .agent directory
    if (fs.existsSync(paths.agentRoot)) {
      fs.rmSync(paths.agentRoot, { recursive: true, force: true });
      console.log(`Removed ${paths.agentRoot}`);
    }

    // 2. Remove provider-specific discovery files and legacy configs
    for (const file of providerFiles) {
      const filePath = path.join(paths.rootDir, file);
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { force: true });
        console.log(`Removed ${file}`);
      }
    }

    console.log("Cleanup complete.");
  } catch (err) {
    console.error(`Failed during cleanup: ${err.message}`);
    process.exitCode = 1;
  }
}

function showStatus() {
  const paths = getAgentPaths();
  if (!fs.existsSync(paths.agentRoot)) {
    console.log("workspace: not initialized");
    return;
  }

  const daemonPid = cleanupStalePid(paths);
  const daemonState = loadDaemonState(paths);
  if (daemonState.status === "running" && !daemonPid) {
    saveDaemonState(paths, {
      ...daemonState,
      status: "stopped",
      stoppedAt: new Date().toISOString(),
      pid: null,
    });
    daemonState.status = "stopped";
    daemonState.pid = null;
  }

  const taskCounts = countTasks(paths);
  const output = [
    formatStatus(paths, daemonState, daemonPid),
    "",
    `tasks:`,
    `  completed: ${taskCounts.completed}`,
    `  failed:    ${taskCounts.failed}`,
    `  pending:   ${taskCounts.pending}`,
    `  total:     ${taskCounts.total}`,
  ];

  console.log(output.join("\n"));
}

function doctor() {
  const paths = getAgentPaths();
  const issues = [];

  if (!fs.existsSync(paths.agentRoot)) {
    issues.push("missing .agent workspace — run 'cog init'");
  }

  const required = ["context", "tasks", "memory", "runtime"];
  for (const dir of required) {
    const d = path.join(paths.agentRoot, dir);
    if (!fs.existsSync(d)) {
      issues.push(`missing .agent/${dir}/ directory`);
    }
  }

  const pid = cleanupStalePid(paths);
  if (!pid) {
    issues.push("daemon not running — start with 'cogd start'");
  }

  if (issues.length === 0) {
    console.log("ok");
    return;
  }

  for (const issue of issues) {
    console.log(`issue: ${issue}`);
  }
}

function listTasks(statusFilter) {
  const paths = getAgentPaths();
  if (!fs.existsSync(paths.tasksDir)) {
    console.log("no tasks directory");
    return;
  }

  let files;
  try {
    files = fs.readdirSync(paths.tasksDir);
  } catch {
    console.log("no tasks");
    return;
  }

  const tasks = files
    .filter((f) => f.endsWith(".json"))
    .sort()
    .slice(-30)
    .map((f) => {
      try {
        return JSON.parse(
          fs.readFileSync(path.join(paths.tasksDir, f), "utf8"),
        );
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((t) => !statusFilter || t.status === statusFilter);

  if (tasks.length === 0) {
    console.log(statusFilter ? `no ${statusFilter} tasks` : "no tasks");
    return;
  }

  for (const t of tasks) {
    const id = (t.id ?? t.type ?? "?").slice(0, 24);
    const label = (t.goal ?? t.description ?? t.content ?? "?").slice(0, 40);
    console.log(`${id.padEnd(24)} ${(t.status ?? "?").padEnd(12)} ${label}`);
  }
}

function showTask(taskId) {
  const paths = getAgentPaths();
  const taskPath = path.join(
    paths.tasksDir,
    taskId.endsWith(".json") ? taskId : `${taskId}.json`,
  );

  if (!fs.existsSync(taskPath)) {
    console.log(`task not found: ${taskId}`);
    return;
  }

  try {
    const task = JSON.parse(fs.readFileSync(taskPath, "utf8"));
    console.log(JSON.stringify(task, null, 2));
  } catch {
    console.log("failed to parse task file");
  }
}

function showEvents(n = 10) {
  const paths = getAgentPaths();
  const eventDir = paths.eventsDir || path.join(paths.runtimeDir, "events");

  if (!fs.existsSync(eventDir)) {
    console.log("no events");
    return;
  }

  let files;
  try {
    files = fs.readdirSync(eventDir);
  } catch {
    console.log("no events");
    return;
  }

  const events = files
    .filter((f) => f.endsWith(".json"))
    .sort()
    .slice(-n)
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(eventDir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (events.length === 0) {
    console.log("no events");
    return;
  }

  for (const e of events) {
    const evtName = (e.event || e.type || "?").slice(0, 25).padEnd(25);
    const evtDetail = e.data?.path ?? e.data?.type ?? e.data?.source ?? "";
    console.log(`${e.at.slice(0, 19)} ${evtName} ${evtDetail}`);
  }
}

function showSemanticMemory() {
  const paths = getAgentPaths();
  const semDir = paths.semanticDir;
  if (!fs.existsSync(semDir)) {
    console.log("no semantic memory");
    return;
  }
  let files;
  try {
    files = fs.readdirSync(semDir);
  } catch {
    files = [];
  }
  const topics = files.filter((f) => f.endsWith(".json"));
  if (topics.length === 0) {
    console.log("no semantic memory topics");
    return;
  }
  console.log("semantic memory topics:");
  for (const f of topics) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(semDir, f), "utf8"));
      const count = Array.isArray(data) ? data.length : 1;
      console.log(`  ${f.replace(".json", "").padEnd(25)} ${count} entries`);
    } catch {
      console.log(`  ${f.replace(".json", "")}`);
    }
  }
}

function showMemory() {
  const paths = getAgentPaths();
  const epDir = paths.episodicDir;

  if (!fs.existsSync(epDir)) {
    console.log("no memory");
    return;
  }

  let files;
  try {
    files = fs.readdirSync(epDir);
  } catch {
    console.log("no memory");
    return;
  }

  const episodes = files
    .filter((f) => f.startsWith("ep-") && f.endsWith(".json"))
    .sort()
    .slice(-10)
    .map((f) => {
      try {
        const ep = JSON.parse(fs.readFileSync(path.join(epDir, f), "utf8"));
        return `${ep.id.slice(0, 20).padEnd(20)} ${(ep.goal ?? "?").slice(0, 45)} ${ep.status}`;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (episodes.length === 0) {
    console.log("no episodic memory");
    return;
  }

  console.log("recent memory:");
  for (const ep of episodes) {
    console.log(`  ${ep}`);
  }
}

function showAgents() {
  console.log("built-in agents:");
  console.log(
    "  memory-agent         memory curator            triggers: task:completed, task:failed",
  );
  console.log(
    "  planner              goal decomposition agent  triggers: goal:created",
  );
  console.log(
    "  reflection-agent     self-improvement analyzer triggers: reflection:trigger",
  );
  console.log(
    "  orchestrator         escalation handler        triggers: task:escalated",
  );
}

function showProviders() {
  console.log("available providers (auto-detected):");
  console.log("  claude, openclaude, opencode, codex, gemini, openhands");
}

function showPlan() {
  const paths = getAgentPaths();
  const tasksDir = paths.tasksDir;

  if (!fs.existsSync(tasksDir)) {
    console.log("no plans");
    return;
  }

  let files;
  try {
    files = fs.readdirSync(tasksDir);
  } catch {
    console.log("no plans");
    return;
  }

  const planFiles = files.filter((f) => f.endsWith(".plan.md")).sort();
  if (planFiles.length === 0) {
    console.log("no plans");
    return;
  }

  const latest = planFiles[planFiles.length - 1];
  const content = fs.readFileSync(path.join(tasksDir, latest), "utf8");
  console.log(content);
}

function inspectWorkspace() {
  const paths = getAgentPaths();

  if (!fs.existsSync(paths.agentRoot)) {
    console.log("workspace not initialized");
    return;
  }

  function inspectDir(dirPath, indent = "") {
    if (!fs.existsSync(dirPath)) return;
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        console.log(`${indent}${entry.name}/`);
        inspectDir(full, indent + "  ");
      } else {
        const stat = fs.statSync(full);
        const size =
          stat.size < 1024
            ? `${stat.size}B`
            : `${(stat.size / 1024).toFixed(1)}K`;
        console.log(`${indent}${entry.name} (${size})`);
      }
    }
  }

  console.log(`.agent/ (${paths.rootDir})`);
  inspectDir(paths.agentRoot, "");
}

function countTasks(paths) {
  const result = { completed: 0, failed: 0, pending: 0, total: 0 };

  if (!fs.existsSync(paths.tasksDir)) return result;

  let files;
  try {
    files = fs.readdirSync(paths.tasksDir);
  } catch {
    return result;
  }

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    result.total++;
    try {
      const task = JSON.parse(
        fs.readFileSync(path.join(paths.tasksDir, file), "utf8"),
      );
      if (task.status === "completed") result.completed++;
      else if (task.status === "failed") result.failed++;
      else result.pending++;
    } catch {
      result.pending++;
    }
  }

  return result;
}

function emitEvent(eventType) {
  const paths = getAgentPaths();
  if (!paths.eventsDir) {
    console.error("workspace not initialized");
    return;
  }
  const event = {
    event: eventType,
    type: eventType,
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    timestamp: new Date().toISOString(),
    data: { source: "cli", type: eventType },
  };
  const filePath = path.join(paths.eventsDir, `${event.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(event, null, 2) + "\n");
  console.log(`Event emitted: ${eventType} -> ${filePath}`);
}

function showLocks() {
  const paths = getAgentPaths();
  const locksDir = paths.locksDir;
  if (!locksDir || !fs.existsSync(locksDir)) {
    console.log("no active locks");
    return;
  }
  let files;
  try {
    files = fs.readdirSync(locksDir);
  } catch {
    files = [];
  }
  const locks = files.filter((f) => f.endsWith(".lock"));
  if (locks.length === 0) {
    console.log("no active locks");
    return;
  }
  for (const f of locks) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(locksDir, f), "utf8"));
      console.log(
        `  ${f.replace(".lock", "").padEnd(20)} owner: ${data.owner}  task: ${data.task || "-"}`,
      );
    } catch {
      console.log(`  ${f.replace(".lock", "")} (unreadable)`);
    }
  }
}

function claimLock(lockName) {
  const paths = getAgentPaths();
  const locksDir = paths.locksDir;
  if (!locksDir) {
    console.error("workspace not initialized");
    return;
  }
  fs.mkdirSync(locksDir, { recursive: true });
  const lockFile = path.join(locksDir, `${lockName}.lock`);
  if (fs.existsSync(lockFile)) {
    console.error(`lock exists: ${lockName}`);
    return;
  }
  const lock = {
    owner: process.env.USER || "cli",
    task: "manual",
    scope: [],
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + "\n");
  console.log(`Lock claimed: ${lockName}`);
}

function releaseLock(lockName) {
  const paths = getAgentPaths();
  const lockFile = path.join(paths.locksDir, `${lockName}.lock`);
  if (!fs.existsSync(lockFile)) {
    console.error(`lock not found: ${lockName}`);
    return;
  }
  fs.rmSync(lockFile);
  console.log(`Lock released: ${lockName}`);
}

function showSessions() {
  const paths = getAgentPaths();
  const sessionsDir = paths.sessionsActiveDir;
  if (!sessionsDir || !fs.existsSync(sessionsDir)) {
    console.log("no active sessions");
    return;
  }
  let files;
  try {
    files = fs.readdirSync(sessionsDir);
  } catch {
    files = [];
  }
  const sessions = files.filter((f) => f.endsWith(".json"));
  if (sessions.length === 0) {
    console.log("no active sessions");
    return;
  }
  for (const f of sessions) {
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(sessionsDir, f), "utf8"),
      );
      console.log(
        `  ${data.provider.padEnd(14)} ${(data.mode || "").padEnd(14)} ${data.task || ""}  ${data.startedAt || ""}`,
      );
    } catch {
      console.log(`  ${f} (unreadable)`);
    }
  }
}

function showReviews(reviewId) {
  const paths = getAgentPaths();
  if (reviewId) {
    const reviewFile = path.join(
      paths.reviewsDir,
      reviewId.endsWith(".json") ? reviewId : `${reviewId}.json`,
    );
    if (!fs.existsSync(reviewFile)) {
      console.log(`review not found: ${reviewId}`);
      return;
    }
    try {
      console.log(fs.readFileSync(reviewFile, "utf8"));
    } catch {
      console.log("failed to read review");
    }
    return;
  }
  if (!fs.existsSync(paths.reviewsDir)) {
    console.log("no reviews");
    return;
  }
  let files;
  try {
    files = fs.readdirSync(paths.reviewsDir);
  } catch {
    files = [];
  }
  const reviews = files
    .filter((f) => f.endsWith(".json"))
    .sort()
    .slice(-10);
  if (reviews.length === 0) {
    console.log("no reviews");
    return;
  }
  for (const f of reviews) {
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(paths.reviewsDir, f), "utf8"),
      );
      console.log(
        `  ${data.id.slice(0, 28).padEnd(28)} verdict: ${data.verdict || "pending"}  task: ${data.taskId}`,
      );
    } catch {
      console.log(`  ${f}`);
    }
  }
}

function showPatches() {
  const paths = getAgentPaths();
  if (!fs.existsSync(paths.patchesDir)) {
    console.log("no patches");
    return;
  }
  let files;
  try {
    files = fs.readdirSync(paths.patchesDir);
  } catch {
    files = [];
  }
  const patches = files
    .filter((f) => f.endsWith(".json"))
    .sort()
    .slice(-10);
  if (patches.length === 0) {
    console.log("no patches");
    return;
  }
  for (const f of patches) {
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(paths.patchesDir, f), "utf8"),
      );
      console.log(
        `  ${data.id.slice(0, 28).padEnd(28)} task: ${(data.taskId || "").slice(0, 20).padEnd(20)} patches: ${(data.patches || []).length}`,
      );
    } catch {
      console.log(`  ${f}`);
    }
  }
}

function showWorkflows(workflowName) {
  const paths = getAgentPaths();
  if (workflowName) {
    const wfFile = path.join(paths.workflowsDir, `${workflowName}.yaml`);
    if (!fs.existsSync(wfFile)) {
      console.log(`workflow not found: ${workflowName}`);
      return;
    }
    try {
      console.log(fs.readFileSync(wfFile, "utf8"));
    } catch {
      console.log("failed to read workflow");
    }
    return;
  }
  if (!fs.existsSync(paths.workflowsDir)) {
    console.log("no workflows");
    return;
  }
  let files;
  try {
    files = fs.readdirSync(paths.workflowsDir);
  } catch {
    files = [];
  }
  const wfs = files.filter((f) => f.endsWith(".yaml"));
  if (wfs.length === 0) {
    console.log("no workflows");
    return;
  }
  for (const f of wfs) {
    console.log(`  ${f.replace(".yaml", "")}`);
  }
}

function loadContinuity() {
  const paths = getAgentPaths();
  const bus = new EventBus(
    path.join(paths.runtimeDir, "events"),
    paths.eventsDir,
  );
  return { manager: new ContinuityManager(paths, bus), paths };
}

function cmdResume() {
  const paths = getAgentPaths();
  if (!fs.existsSync(paths.agentRoot)) {
    console.error("workspace not initialized — run 'cog init' first");
    return;
  }
  const taskText = process.argv.slice(3).join(" ") || "continue current work";
  const { manager } = loadContinuity();
  const capsule = manager.resume({ goal: taskText });
  if (capsule.workState?.active) {
    console.log(`Resuming: ${capsule.workState.goal}`);
    console.log(`Next: ${capsule.workState.nextAction}`);
  } else if (capsule.handoff) {
    console.log(`Previous session: ${capsule.handoff.summary}`);
  } else {
    console.log("No prior continuity found — starting fresh.");
  }
  if (capsule.decisions.length > 0) {
    console.log(`Decisions: ${capsule.decisions.length} recorded`);
  }
}

function cmdFinalize() {
  const paths = getAgentPaths();
  if (!fs.existsSync(paths.agentRoot)) {
    console.error("workspace not initialized — run 'cog init' first");
    return;
  }
  const status = process.argv[4] || "success";
  const summary = process.argv.slice(5).join(" ") || "Work completed";
  const { manager } = loadContinuity();
  const task = { goal: summary, nextSteps: [], recommendedStartingPoints: [] };
  manager.finalize(task, status, summary);
  console.log(`Context finalized with status ${status}`);
  console.log(`Summary: ${summary}`);
}

function cmdWorkState() {
  const paths = getAgentPaths();
  if (!fs.existsSync(paths.agentRoot)) {
    console.error("workspace not initialized — run 'cog init' first");
    return;
  }
  const sub = process.argv[4];
  const { manager } = loadContinuity();
  if (sub === "start") {
    const goal = process.argv.slice(5).join(" ") || "New task";
    manager.startWorkState({ goal });
    console.log(`Work state started: ${goal}`);
  } else if (sub === "update") {
    const patchArg = process.argv.slice(5).join(" ");
    let patch = {};
    try {
      patch = JSON.parse(patchArg);
    } catch {
      patch = { nextAction: patchArg };
    }
    manager.updateWorkState(patch);
    console.log("Work state updated.");
  } else if (sub === "close") {
    const status = process.argv[5] || "completed";
    manager.closeWorkState(status);
    console.log(`Work state closed: ${status}`);
  } else {
    const state = manager.getWorkState();
    if (state?.active) {
      console.log(`Active: ${state.goal}`);
      console.log(`Status: ${state.status}`);
      console.log(`Next: ${state.nextAction}`);
    } else {
      console.log("No active work state.");
    }
  }
}

function cmdDecision() {
  const paths = getAgentPaths();
  if (!fs.existsSync(paths.agentRoot)) {
    console.error("workspace not initialized — run 'cog init' first");
    return;
  }
  const { manager } = loadContinuity();
  const sub = process.argv[4];
  if (sub === "record") {
    const title = process.argv[5] || "";
    const decision = process.argv[6] || "";
    const context = process.argv.slice(7).join(" ") || "";
    if (!title || !decision) {
      console.error("usage: cog decision record <title> <decision> [context]");
      return;
    }
    const entry = manager.recordDecision(title, decision, context);
    console.log(`Decision recorded: ${entry.id}`);
  } else {
    const decisions = manager.getDecisions(20);
    if (decisions.length === 0) {
      console.log("No decisions recorded.");
      return;
    }
    for (const d of decisions) {
      console.log(`- ${d.title}: ${d.decision}`);
    }
  }
}

function cmdContinuityView() {
  const paths = getAgentPaths();
  if (!fs.existsSync(paths.agentRoot)) {
    console.error("workspace not initialized — run 'cog init' first");
    return;
  }
  const { manager } = loadContinuity();
  const viewPath = manager.generateContinuityView();
  manager.generateContinuityMap();
  console.log(`Continuity view: ${viewPath}`);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "init":
    if (args[0] && SUPPORTED_PROVIDERS.includes(args[0])) {
      const provider = args[0];
      const result = initProviderFile(provider);
      if (result.success) {
        console.log(
          `Generated ${result.outputFile} for provider "${provider}"`,
        );
      } else {
        console.error(result.error);
        process.exitCode = 1;
      }
    } else if (args[0] === "--all") {
      const results = initAllProviders();
      for (const r of results) {
        if (r.success) {
          console.log(`Generated ${r.outputFile} for provider "${r.provider}"`);
        } else {
          console.error(r.error);
        }
      }
    } else if (args[0]) {
      console.error(
        `unsupported provider: ${args[0]}. Supported: ${SUPPORTED_PROVIDERS.join(", ")}`,
      );
      process.exitCode = 1;
    } else {
      const paths = ensureWorkspace();
      console.log(`Initialized ${paths.agentRoot}`);
      console.log(
        `\nTip: run 'cog init <provider>' to generate provider .md files`,
      );
      console.log(`  Supported: ${SUPPORTED_PROVIDERS.join(", ")}`);
    }
    break;

  case "remove":
    removeWorkspace();
    break;

  case "task":
    switch (args[0]) {
      case "list":
        listTasks(args[1] ?? null);
        break;
      case "show":
        if (!args[1]) {
          console.error("cog task show <id>");
          process.exitCode = 1;
          break;
        }
        showTask(args[1]);
        break;
      default:
        console.error("usage: cog task list [status] | cog task show <id>");
        process.exitCode = 1;
        break;
    }
    break;

  case "status":
    showStatus();
    break;

  case "doctor":
    doctor();
    break;

  case "events":
  case "event":
    if (args[0] === "emit") {
      if (!args[1]) {
        console.error("cog events emit <type>");
        process.exitCode = 1;
        break;
      }
      emitEvent(args.slice(1).join(" "));
    } else {
      showEvents(args[0] ? parseInt(args[0], 10) : 10);
    }
    break;

  case "memory":
    if (args[0] === "semantic") {
      showSemanticMemory();
    } else {
      showMemory();
    }
    break;

  case "agents":
    showAgents();
    break;

  case "providers":
    showProviders();
    break;

  case "plan":
    showPlan();
    break;

  case "inspect":
    inspectWorkspace();
    break;

  case "lock":
    switch (args[0]) {
      case "list":
        showLocks();
        break;
      case "claim":
        if (!args[1]) {
          console.error("cog lock claim <name>");
          process.exitCode = 1;
          break;
        }
        claimLock(args[1]);
        break;
      case "release":
        if (!args[1]) {
          console.error("cog lock release <name>");
          process.exitCode = 1;
          break;
        }
        releaseLock(args[1]);
        break;
      default:
        console.error(
          "usage: cog lock list | cog lock claim <name> | cog lock release <name>",
        );
        process.exitCode = 1;
        break;
    }
    break;

  case "session":
    if (args[0] === "list") {
      showSessions();
    } else {
      console.error("usage: cog session list");
      process.exitCode = 1;
    }
    break;

  case "review":
    if (args[0] === "list") {
      showReviews(null);
    } else if (args[0] === "show") {
      if (!args[1]) {
        console.error("cog review show <id>");
        process.exitCode = 1;
        break;
      }
      showReviews(args[1]);
    } else {
      console.error("usage: cog review list | cog review show <id>");
      process.exitCode = 1;
    }
    break;

  case "patch":
    if (args[0] === "list") {
      showPatches();
    } else {
      console.error("usage: cog patch list");
      process.exitCode = 1;
    }
    break;

  case "workflow":
    if (args[0] === "list") {
      showWorkflows(null);
    } else if (args[0] === "show") {
      if (!args[1]) {
        console.error("cog workflow show <name>");
        process.exitCode = 1;
        break;
      }
      showWorkflows(args[1]);
    } else {
      console.error("usage: cog workflow list | cog workflow show <name>");
      process.exitCode = 1;
    }
    break;

  case "resume":
    cmdResume();
    break;

  case "finalize":
    cmdFinalize();
    break;

  case "work-state":
    cmdWorkState();
    break;

  case "decision":
    cmdDecision();
    break;

  case "continuity-view":
    cmdContinuityView();
    break;

  case undefined:
    printUsage();
    break;

  default:
    printUsage();
    process.exitCode = 1;
    break;
}
