import fs from "node:fs";
import path from "node:path";
import { EventBus } from "./event-bus.js";
import { InboxWatcher } from "./inbox.js";
import { TaskPipeline } from "./pipeline.js";
import { MemorySystem } from "./memory.js";
import { ProviderRegistry } from "./provider.js";
import { ContextAssembler } from "./context.js";
import { AgentRegistry } from "./agent.js";
import { LockManager } from "./locks.js";
import { SessionManager } from "./sessions.js";
import { WorkflowEngine } from "./workflow.js";
import { ReviewManager } from "./reviews.js";
import { PatchManager } from "./patches.js";
import { MCPServer } from "./mcp.js";
import { ContinuityManager } from "./continuity.js";
import { KnowledgeGraph } from "./graph.js";
import { Planner } from "./planner.js";

export class Runtime {
  #pendingTasks = new Map();

  constructor(paths) {
    this.paths = paths;
    this.bus = new EventBus(path.join(paths.runtimeDir, "events"), paths.eventsDir);
    this.graph = new KnowledgeGraph(paths.graphDir);
    this.pipeline = new TaskPipeline(paths.tasksDir, this.bus);
    this.memory = new MemorySystem(paths, this.bus);
    this.providers = new ProviderRegistry();
    this.context = new ContextAssembler(paths, this.memory, this.bus, this.graph);
    this.agents = new AgentRegistry(paths, this.bus, this.pipeline, this.providers, this.context);
    this.planner = new Planner(paths, this.bus, this.providers);
    this.inbox = new InboxWatcher(paths, this.bus);
    this.locks = new LockManager(paths.locksDir);
    this.sessions = new SessionManager(paths.sessionsActiveDir, paths.sessionsArchivedDir);
    this.workflows = new WorkflowEngine(paths.workflowsDir, this.bus);
    this.reviews = new ReviewManager(paths.reviewsDir);
    this.patches = new PatchManager(paths.patchesDir);
    this.mcp = new MCPServer(paths, this);
    this.continuity = new ContinuityManager(paths, this.bus);
  }

  start() {
    this.memory.register();
    this.continuity.register();
    this.planner.register();
    this.agents.registerAll();
    this.context.startAutoRefresh();

    this.#registerCoreHandlers();

    this.inbox.start();

    this.bus.emit("runtime:started", { at: new Date().toISOString() });
  }

  stop() {
    this.inbox.stop();
    this.context.stopAutoRefresh();
    this.bus.emit("runtime:stopped", { at: new Date().toISOString() });
  }

  #registerCoreHandlers() {
    this.bus.on("plan:ready", (envelope) => {
      this.#executePlan(envelope.data);
    });

    this.bus.on("task:created", (envelope) => {
      const { task } = envelope.data;
      if (task) this.continuity.startWorkState(task);
      const pending = this.#pendingTasks.get(task.id);
      if (pending && pending.requires.length > 0) {
        if (this.#areDependenciesMet(pending.requires)) {
          this.#pendingTasks.delete(task.id);
          this.pipeline.transition(task.id, "queued");
        }
      } else {
        this.pipeline.transition(task.id, "queued");
      }
    });

    this.bus.on("task:completed", (envelope) => {
      const { task } = envelope.data;
      this.#checkUnblockedTasks(task.goal);
      if (task.result?.patches?.length > 0) {
        this.patches.store(task.id, task.result.patches, task.provider);
      }
      this.continuity.finalize(task, "success", task.result?.summary ?? "");
    });

    this.bus.on("task:queued", (envelope) => {
      this.#executeTask(envelope.data.task);
    });

    this.bus.on("task:retry", (envelope) => {
      const { task } = envelope.data;
      this.pipeline.transition(task.id, "queued", { reason: "retry" });
    });

    this.bus.on("session:register", (envelope) => {
      const { provider, mode, task, scope } = envelope.data;
      this.sessions.register(provider, mode, task, scope);
    });

    this.bus.on("lock:claim", (envelope) => {
      const { lockName, owner, task, scope } = envelope.data;
      this.locks.claim(lockName, owner, task, scope);
    });

    this.bus.on("lock:release", (envelope) => {
      const { lockName, owner } = envelope.data;
      this.locks.release(lockName, owner);
    });

    this.bus.on("workflow:execute", (envelope) => {
      const { workflowName, context } = envelope.data;
      this.workflows.execute(workflowName, context);
    });
  }

  #executePlan(plan) {
    if (!plan || !plan.tasks) return;
    for (const taskDef of plan.tasks) {
      const task = this.pipeline.create(taskDef);
      if (taskDef.requires && taskDef.requires.length > 0) {
        this.#pendingTasks.set(task.id, taskDef);
      }
    }
  }

  #areDependenciesMet(requires) {
    for (const depName of requires) {
      const depTasks = this.pipeline.list("completed");
      const met = depTasks.some((t) => t.goal === depName);
      if (!met) return false;
    }
    return true;
  }

  #checkUnblockedTasks(completedGoal) {
    for (const [taskId, pending] of this.#pendingTasks) {
      if (pending.requires.includes(completedGoal) && this.#areDependenciesMet(pending.requires)) {
        this.#pendingTasks.delete(taskId);
        this.pipeline.transition(taskId, "queued");
      }
    }
  }

  #determineFailureSeverity(task) {
    const failures = (task.history ?? []).filter((h) => h.to === "failed").length;
    if (failures >= 3) return "critical";
    if (failures >= 2) return "high";
    return "medium";
  }

  async #executeTask(task) {
    this.pipeline.transition(task.id, "planned");

    this.sessions.register(task.provider || "unknown", "execution", task.id, [task.goal || ""]);

    const agentCfg = this.providers.getAgentConfig(task.goal);
    const effectiveProvider = agentCfg?.provider || task.provider;
    const effectiveHint = agentCfg?.model ? `${effectiveProvider}:${agentCfg.model}` : effectiveProvider;

    let provider = agentCfg?.provider
      ? this.providers.resolve(agentCfg.provider)
      : this.providers.resolve(effectiveProvider);

    if (!provider) {
      provider = this.providers.resolve(null);
    }
    if (!provider) {
      this.pipeline.transition(task.id, "failed", {
        result: { summary: `No provider available for: ${effectiveHint}` }
      });
      this.continuity.recordFailure({
        taskId: task.id,
        toolchain: effectiveHint,
        phase: "setup",
        severity: "high",
        message: `No provider available for: ${effectiveHint}`
      });
      this.continuity.closeWorkState("failed");
      return;
    }

    this.pipeline.transition(task.id, "executing", { provider: provider.name });

    const assembledContext = this.context.assemble(task);

    try {
      const result = await provider.execute(task, assembledContext, {});
      this.pipeline.transition(task.id, "reviewing", { provider: provider.name, result });

      if (result.status === "completed") {
        this.pipeline.transition(task.id, "completed", { result });
        if (result.patches?.length > 0) {
          this.patches.store(task.id, result.patches, provider.name);
        }
        if (result.summary) {
          const review = this.reviews.create(task.id, provider.name);
          this.reviews.submit(review.id, "approved");
        }
      } else {
        this.pipeline.transition(task.id, "failed", { result });
        this.continuity.recordFailure({
          taskId: task.id,
          toolchain: provider.name,
          phase: "execution",
          severity: "medium",
          message: result.summary ?? "Task returned failed status",
          exitCode: result.artifacts?.exitCode ?? null
        });
        this.continuity.closeWorkState("failed");
      }
    } catch (err) {
      this.pipeline.transition(task.id, "failed", {
        result: { summary: `Execution error: ${err.message}` }
      });
      this.continuity.recordFailure({
        taskId: task.id,
        toolchain: provider?.name ?? "unknown",
        phase: "execution",
        severity: "high",
        message: err.message,
        exitCode: null
      });
      this.continuity.closeWorkState("failed");
    }
  }
}
