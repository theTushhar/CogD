import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export class ContinuityManager {
  #paths;
  #bus;

  constructor(paths, bus) {
    this.#paths = paths;
    this.#bus = bus;
    fs.mkdirSync(paths.continuityDir, { recursive: true });
    fs.mkdirSync(paths.workStateDir, { recursive: true });
    fs.mkdirSync(paths.handoffsDir, { recursive: true });
    fs.mkdirSync(paths.decisionsDir, { recursive: true });
    fs.mkdirSync(paths.failureMemoryDir, { recursive: true });
  }

  register() {
    this.#bus.on("task:created", (envelope) => this.#onTaskCreated(envelope));
    this.#bus.on("task:completed", (envelope) => this.#onTaskCompleted(envelope));
    this.#bus.on("task:failed", (envelope) => this.#onTaskFailed(envelope));
  }

  resume(task) {
    const state = this.#loadActiveWorkState();
    const handoff = this.#latestHandoff();
    const decisions = this.#recentDecisions(5);
    const failures = this.#recentFailurePatterns(5);

    return {
      workState: state,
      handoff: handoff ? { summary: handoff.summary, recommendedStartingPoints: handoff.recommendedStartingPoints } : null,
      decisions: decisions.map((d) => ({ title: d.title, decision: d.decision, context: d.context })),
      failures: failures.map((f) => ({ toolchain: f.toolchain, message: f.message, fingerprint: f.fingerprint })),
      compiled: this.#compileResumeCapsule(state, handoff, decisions)
    };
  }

  finalize(task, status, summary) {
    const handoff = {
      executionId: task?.id ?? `exec-${Date.now()}`,
      timestamp: new Date().toISOString(),
      summary: summary ?? "",
      status: status ?? "unknown",
      taskType: this.#classifyTask(task?.goal ?? ""),
      completedItems: [task?.goal ?? ""].filter(Boolean),
      nextSteps: task?.nextSteps ?? [],
      blockedItems: task?.blockedItems ?? [],
      risks: task?.risks ?? [],
      recommendedStartingPoints: task?.recommendedStartingPoints ?? [],
      observedFiles: task?.observedFiles ?? [],
      branch: this.#getGitBranch(),
      head: this.#getGitHead()
    };

    this.#appendHandoff(handoff);
    this.#writeExecutionSummary(task, status, summary);
    this.#writeResumeCapsule(null, handoff);

    this.#bus.emit("continuity:finalized", { handoff });
    return handoff;
  }

  #onTaskCreated(envelope) {
    const { task } = envelope.data;
    if (!task) return;

    const state = this.#loadActiveWorkState();
    state.active = true;
    state.taskId = task.id;
    state.goal = task.goal ?? "";
    state.status = "active";
    state.hypothesis = "";
    state.activeFiles = [];
    state.verifiedItems = [];
    state.unverifiedAssumptions = [];
    state.discardedPaths = [];
    state.nextAction = task.goal ?? "";
    state.recommendedCommands = [];
    state.risks = [];
    state.uncertainties = [];
    state.updatedAt = new Date().toISOString();
    this.#saveWorkState(state);
  }

  #onTaskCompleted(envelope) {
    const { task } = envelope.data;
    if (!task) return;

    const state = this.#loadActiveWorkState();
    if (state.taskId === task.id) {
      state.active = false;
      state.status = "completed";
      state.updatedAt = new Date().toISOString();
      this.#saveWorkState(state);
    }
  }

  #onTaskFailed(envelope) {
    const { task } = envelope.data;
    if (!task) return;

    const state = this.#loadActiveWorkState();
    if (state.taskId === task.id) {
      state.active = true;
      state.status = "paused";
      state.updatedAt = new Date().toISOString();
      this.#saveWorkState(state);
    }
  }

  startWorkState(task, fields = {}) {
    const state = {
      active: true,
      taskId: task?.id ?? `task-${Date.now()}`,
      goal: task?.goal ?? fields?.goal ?? "",
      hypothesis: fields?.hypothesis ?? "",
      activeFiles: fields?.activeFiles ?? [],
      verifiedItems: fields?.verifiedItems ?? [],
      unverifiedAssumptions: fields?.unverifiedAssumptions ?? [],
      discardedPaths: fields?.discardedPaths ?? [],
      nextAction: fields?.nextAction ?? task?.goal ?? "",
      recommendedCommands: fields?.recommendedCommands ?? [],
      risks: fields?.risks ?? [],
      uncertainties: fields?.uncertainties ?? [],
      contractGaps: fields?.contractGaps ?? [],
      strongestContractGap: fields?.strongestContractGap ?? null,
      sourceExecutionIds: fields?.sourceExecutionIds ?? [],
      branch: this.#getGitBranch(),
      head: this.#getGitHead(),
      dirty: this.#isGitDirty(),
      changedFiles: this.#getChangedFiles(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.#saveWorkState(state);
    this.#bus.emit("continuity:work-state-started", { state });
    return state;
  }

  updateWorkState(patches) {
    const state = this.#loadActiveWorkState();
    for (const [key, value] of Object.entries(patches)) {
      if (key in state) state[key] = value;
    }
    state.updatedAt = new Date().toISOString();
    this.#saveWorkState(state);
    this.#bus.emit("continuity:work-state-updated", { state, patches });
    return state;
  }

  closeWorkState(status) {
    const state = this.#loadActiveWorkState();
    state.active = false;
    state.status = status ?? "completed";
    state.updatedAt = new Date().toISOString();
    this.#saveWorkState(state);
    this.#bus.emit("continuity:work-state-closed", { state, status });
    return state;
  }

  getWorkState() {
    return this.#loadActiveWorkState();
  }

  recordDecision(title, decision, context = "", meta = {}) {
    const entry = {
      id: `decision-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      decision,
      context,
      meta,
      branch: this.#getGitBranch(),
      recordedAt: new Date().toISOString()
    };

    this.#appendDecision(entry);
    this.#bus.emit("continuity:decision-recorded", { entry });
    return entry;
  }

  getDecisions(limit = 20) {
    return this.#recentDecisions(limit);
  }

  recordFailure(failure) {
    const entry = {
      id: `failure-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      toolchain: failure.toolchain ?? "unknown",
      phase: failure.phase ?? "execution",
      severity: failure.severity ?? "medium",
      message: failure.message ?? "",
      code: failure.code ?? "",
      file: failure.file ?? "",
      line: failure.line ?? null,
      command: failure.command ?? "",
      exitCode: failure.exitCode ?? null,
      fingerprint: this.#fingerprint(failure),
      taskId: failure.taskId ?? null,
      occurredAt: new Date().toISOString()
    };

    this.#appendFailure(entry);
    this.#bus.emit("continuity:failure-recorded", { entry });
    return entry;
  }

  getFailurePatterns(limit = 20) {
    return this.#recentFailurePatterns(limit);
  }

  getContinuityQuality() {
    const state = this.#loadActiveWorkState();
    const handoff = this.#latestHandoff();
    const failures = this.#recentFailurePatterns(1);
    const issues = [];

    if (!state.active && !handoff) {
      return { score: "missing", issues: ["No continuity artifacts found"] };
    }

    if (state.active) {
      const elapsed = (Date.now() - new Date(state.updatedAt).getTime()) / 1000 / 3600;
      if (elapsed > 24) issues.push(`Work State stale - last updated ${elapsed.toFixed(1)}h ago`);
      else if (elapsed > 4) issues.push(`Work State may be stale - ${elapsed.toFixed(1)}h since update`);
    }

    if (failures.length > 0) issues.push(`${failures.length} unresolved failure patterns`);

    const branch = this.#getGitBranch();
    if (state.branch && state.branch !== branch) issues.push(`Work State was recorded on branch "${state.branch}", currently on "${branch}"`);

    const score = issues.length === 0 ? "fresh" : issues.some((i) => i.includes("stale")) ? "stale" : "degraded";
    return { score, issues, workStateActive: !!state.active, handoffExists: !!handoff };
  }

  generateContinuityView() {
    const state = this.#loadActiveWorkState();
    const handoff = this.#latestHandoff();
    const decisions = this.#recentDecisions(10);
    const failures = this.#recentFailurePatterns(10);
    const quality = this.getContinuityQuality();

    const view = [
      "# Continuity View",
      "",
      `*Generated: ${new Date().toISOString()}*`,
      "",
      "---",
      "",
      "## Quality",
      `Score: **${quality.score}**`,
      ...quality.issues.map((i) => `- ${i}`),
      "",
      "---",
      "",
      "## Work State",
      state.active
        ? [
            `**Active:** ${state.goal}`,
            `**Status:** ${state.status}`,
            `**Next Action:** ${state.nextAction}`,
            `**Hypothesis:** ${state.hypothesis || "—"}`,
            `**Active Files:** ${state.activeFiles.length > 0 ? state.activeFiles.join(", ") : "none"}`,
            `**Verified:** ${state.verifiedItems.length > 0 ? state.verifiedItems.join(", ") : "none"}`,
            `**Risks:** ${state.risks.length > 0 ? state.risks.join("; ") : "none identified"}`,
            `**Branch:** ${state.branch}`,
            `**Updated:** ${state.updatedAt}`
          ].join("\n")
        : "None.",
      "",
      "---",
      "",
      "## Latest Handoff",
      handoff
        ? [
            `**Summary:** ${handoff.summary}`,
            `**Status:** ${handoff.status}`,
            `**Starting Points:** ${(handoff.recommendedStartingPoints ?? []).join(", ") || "—"}`,
            `**Timestamp:** ${handoff.timestamp}`
          ].join("\n")
        : "None.",
      "",
      "---",
      "",
      "## Recent Decisions",
      ...(decisions.length > 0 ? decisions.map((d) => `- **${d.title}**: ${d.decision}`) : ["None."]),
      "",
      "---",
      "",
      "## Failure Patterns",
      ...(failures.length > 0 ? failures.map((f) => `- [${f.toolchain}] ${f.message} — fingerprint: \`${f.fingerprint}\``) : ["None."])
    ];

    const viewPath = path.join(this.#paths.continuityDir, "continuity-view.md");
    fs.writeFileSync(viewPath, view.join("\n") + "\n");
    this.#bus.emit("continuity:view-generated", { path: viewPath });
    return viewPath;
  }

  generateContinuityMap() {
    const state = this.#loadActiveWorkState();
    const handoff = this.#latestHandoff();
    const decisions = this.#recentDecisions(5);

    const lines = ["graph TD"];
    lines.push("  Continuity[Repo Continuity]");

    if (state.active) {
      const safeId = this.#mermaidSafe(state.goal || "work");
      lines.push(`  WorkState[${safeId}]`);
      lines.push("  Continuity --> WorkState");
      if (state.nextAction) lines.push(`  Next[Next: ${this.#mermaidSafe(state.nextAction)}]`);
      lines.push("  WorkState --> Next");
    }

    if (handoff) {
      lines.push("  Handoff[Last Session]");
      lines.push("  Continuity --> Handoff");
    }

    if (decisions.length > 0) {
      lines.push("  Decisions[Project Decisions]");
      lines.push("  Continuity --> Decisions");
      for (const d of decisions.slice(0, 3)) {
        const safeTitle = this.#mermaidSafe(d.title);
        lines.push(`  D_${d.id?.slice(-6) ?? "dec"}["${safeTitle}"]`);
        lines.push("  Decisions --> " + `D_${d.id?.slice(-6) ?? "dec"}`);
      }
    }

    const mapPath = path.join(this.#paths.continuityDir, "continuity-map.mmd");
    fs.writeFileSync(mapPath, lines.join("\n") + "\n");
    return mapPath;
  }

  #compileResumeCapsule(state, handoff, decisions) {
    const lines = [
      "# Resume Capsule",
      "",
      state.active
        ? [
            `Active work: **${state.goal}**`,
            state.nextAction ? `Next action: ${state.nextAction}` : "",
            state.hypothesis ? `Hypothesis: ${state.hypothesis}` : "",
            state.risks.length > 0 ? `Risks: ${state.risks.join("; ")}` : ""
          ].filter(Boolean).join("\n")
        : "No active work state.",
      "",
      handoff ? `Previous session: ${handoff.summary}` : "",
      decisions.length > 0 ? `Recent decisions: ${decisions.map((d) => d.title).join(", ")}` : ""
    ].filter(Boolean);

    const capsule = lines.join("\n") + "\n";
    const capsulePath = path.join(this.#paths.continuityDir, "resume-capsule.md");
    fs.writeFileSync(capsulePath, capsule);
    return capsule;
  }

  #writeExecutionSummary(task, status, summary) {
    const lines = [
      "# Last Execution Summary",
      "",
      `**Task:** ${task?.goal ?? task?.id ?? "unknown"}`,
      `**Status:** ${status}`,
      `**Summary:** ${summary}`,
      `**Completed:** ${new Date().toISOString()}`,
      "",
      task?.nextSteps?.length > 0 ? `**Next:** ${task.nextSteps.join(", ")}` : "",
      task?.recommendedStartingPoints?.length > 0 ? `**Entry point:** ${task.recommendedStartingPoints.join(", ")}` : ""
    ].filter(Boolean);

    const summaryPath = path.join(this.#paths.continuityDir, "last-execution-summary.md");
    fs.writeFileSync(summaryPath, lines.join("\n") + "\n");
  }

  #writeResumeCapsule(state, handoff) {
    this.#compileResumeCapsule(state ?? this.#loadActiveWorkState(), handoff ?? this.#latestHandoff(), this.#recentDecisions(5));
  }

  #loadActiveWorkState() {
    const filePath = path.join(this.#paths.workStateDir, "active.json");
    if (!fs.existsSync(filePath)) {
      return { active: false, taskId: null, goal: "", status: "idle", hypothesis: "", activeFiles: [], verifiedItems: [], unverifiedAssumptions: [], discardedPaths: [], nextAction: "", recommendedCommands: [], risks: [], uncertainties: [], contractGaps: [], strongestContractGap: null, sourceExecutionIds: [], branch: this.#getGitBranch(), head: this.#getGitHead(), dirty: false, changedFiles: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return { active: false, taskId: null, goal: "" };
    }
  }

  #saveWorkState(state) {
    const filePath = path.join(this.#paths.workStateDir, "active.json");
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + "\n");
  }

  #appendHandoff(handoff) {
    const filePath = path.join(this.#paths.handoffsDir, "handoffs.jsonl");
    fs.appendFileSync(filePath, JSON.stringify(handoff) + "\n");

    const latestPath = path.join(this.#paths.handoffsDir, "latest.json");
    fs.writeFileSync(latestPath, JSON.stringify(handoff, null, 2) + "\n");
  }

  #latestHandoff() {
    const latestPath = path.join(this.#paths.handoffsDir, "latest.json");
    if (!fs.existsSync(latestPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(latestPath, "utf8"));
    } catch {
      return null;
    }
  }

  #appendDecision(entry) {
    const filePath = path.join(this.#paths.decisionsDir, "decisions.jsonl");
    fs.appendFileSync(filePath, JSON.stringify(entry) + "\n");

    const archivePath = path.join(this.#paths.decisionsDir, `${entry.id}.json`);
    fs.writeFileSync(archivePath, JSON.stringify(entry, null, 2) + "\n");
  }

  #recentDecisions(limit) {
    const filePath = path.join(this.#paths.decisionsDir, "decisions.jsonl");
    if (!fs.existsSync(filePath)) return [];
    try {
      const content = fs.readFileSync(filePath, "utf8").trim();
      if (!content) return [];
      const lines = content.split("\n").filter(Boolean);
      return lines.slice(-limit).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  #appendFailure(entry) {
    const filePath = path.join(this.#paths.failureMemoryDir, "failure_patterns.jsonl");
    fs.appendFileSync(filePath, JSON.stringify(entry) + "\n");

    const archivePath = path.join(this.#paths.failureMemoryDir, `${entry.id}.json`);
    fs.writeFileSync(archivePath, JSON.stringify(entry, null, 2) + "\n");
  }

  #recentFailurePatterns(limit) {
    const filePath = path.join(this.#paths.failureMemoryDir, "failure_patterns.jsonl");
    if (!fs.existsSync(filePath)) return [];
    try {
      const content = fs.readFileSync(filePath, "utf8").trim();
      if (!content) return [];
      const lines = content.split("\n").filter(Boolean);
      return lines.slice(-limit).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  #fingerprint(failure) {
    const parts = [
      failure.toolchain ?? "unknown",
      failure.phase ?? "execution",
      failure.code ?? "",
      failure.message?.slice(0, 80) ?? ""
    ].filter(Boolean).join("::");
    const hash = this.#simpleHash(parts);
    return `${hash}`;
  }

  #simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).slice(0, 8);
  }

  #getGitBranch() {
    try {
      return execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8", timeout: 3000, stdio: "pipe" }).trim();
    } catch {
      return "unknown";
    }
  }

  #getGitHead() {
    try {
      return execSync("git rev-parse HEAD", { encoding: "utf8", timeout: 3000, stdio: "pipe" }).trim().slice(0, 12);
    } catch {
      return "unknown";
    }
  }

  #isGitDirty() {
    try {
      const status = execSync("git status --porcelain", { encoding: "utf8", timeout: 3000, stdio: "pipe" }).trim();
      return status.length > 0;
    } catch {
      return false;
    }
  }

  #getChangedFiles() {
    try {
      const out = execSync("git status --porcelain", { encoding: "utf8", timeout: 3000, stdio: "pipe" }).trim();
      if (!out) return [];
      return out.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  #classifyTask(goal) {
    const g = (goal ?? "").toLowerCase();
    if (/test|spec|coverage/.test(g)) return "testing";
    if (/bug|fix|error|broken/.test(g)) return "bug-fix";
    if (/refactor|clean|improve/.test(g)) return "refactoring";
    if (/doc|readme|comment/.test(g)) return "documentation";
    if (/api|endpoint|route/.test(g)) return "api";
    if (/auth|login|session|permission/.test(g)) return "authentication";
    if (/deploy|ci|cd|pipeline/.test(g)) return "deployment";
    if (/perf|performance|slow|latency/.test(g)) return "performance";
    return "general";
  }

  #mermaidSafe(text) {
    return (text ?? "").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30);
  }
}
