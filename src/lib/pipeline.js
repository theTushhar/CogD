import fs from "node:fs";
import path from "node:path";

const STATES = ["created", "queued", "planned", "executing", "reviewing", "completed", "failed", "cancelled"];
const VALID_TRANSITIONS = {
  created: ["queued", "cancelled"],
  queued: ["planned", "cancelled"],
  planned: ["executing", "failed", "cancelled"],
  executing: ["reviewing", "failed"],
  reviewing: ["completed", "failed", "executing"],
  completed: [],
  failed: ["queued", "cancelled"],
  cancelled: []
};

export class TaskPipeline {
  #tasksDir;
  #bus;

  constructor(tasksDir, bus) {
    this.#tasksDir = tasksDir;
    this.#bus = bus;
    fs.mkdirSync(tasksDir, { recursive: true });
  }

  create(definition) {
    const task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: "created",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...definition,
      history: []
    };

    this.#save(task);
    this.#bus.emit("task:created", { task });
    return task;
  }

  transition(taskId, newStatus, meta = {}) {
    const task = this.get(taskId);
    if (!task) return null;

    const allowed = VALID_TRANSITIONS[task.status] ?? [];
    if (!allowed.includes(newStatus)) {
      console.error(`[pipeline] invalid transition ${task.status} → ${newStatus} for ${taskId}`);
      return null;
    }

    const oldStatus = task.status;
    task.status = newStatus;
    task.updatedAt = new Date().toISOString();
    task.history.push({
      from: oldStatus,
      to: newStatus,
      at: task.updatedAt,
      ...meta
    });

    if (meta.result) {
      task.result = meta.result;
    }

    this.#save(task);
    this.#bus.emit(`task:${newStatus}`, { task, meta });
    return task;
  }

  get(taskId) {
    const filePath = path.join(this.#tasksDir, `${taskId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  list(status) {
    let files;
    try {
      files = fs.readdirSync(this.#tasksDir);
    } catch {
      return [];
    }
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.#tasksDir, f), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((t) => !status || t.status === status)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  #save(task) {
    const filePath = path.join(this.#tasksDir, `${task.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(task, null, 2) + "\n");
  }
}
