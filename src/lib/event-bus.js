import fs from "node:fs";
import path from "node:path";

const EVENT_PRIORITY = { high: 0, normal: 1, low: 2 };

export class EventBus {
  #handlers;
  #runtimeEventDir;
  #agentEventDir;
  #queue;

  constructor(runtimeEventDir, agentEventDir) {
    this.#handlers = new Map();
    this.#runtimeEventDir = runtimeEventDir;
    this.#agentEventDir = agentEventDir;
    this.#queue = [];
    fs.mkdirSync(runtimeEventDir, { recursive: true });
    if (agentEventDir) fs.mkdirSync(agentEventDir, { recursive: true });
  }

  on(event, handler, priority = "normal") {
    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, []);
    }
    this.#handlers.get(event).push({ handler, priority: EVENT_PRIORITY[priority] ?? 1 });
    this.#handlers.get(event).sort((a, b) => a.priority - b.priority);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const handlers = this.#handlers.get(event);
    if (!handlers) return;
    const idx = handlers.findIndex((h) => h.handler === handler);
    if (idx !== -1) handlers.splice(idx, 1);
  }

  emit(event, data = {}) {
    const envelope = {
      type: event,
      event,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      data,
      timestamp: new Date().toISOString()
    };

    const runtimeFile = path.join(this.#runtimeEventDir, `${envelope.id}.json`);
    fs.writeFileSync(runtimeFile, JSON.stringify({ ...envelope, _store: "runtime" }, null, 2) + "\n");

    if (this.#agentEventDir) {
      const agentFile = path.join(this.#agentEventDir, `${envelope.id}.json`);
      fs.writeFileSync(agentFile, JSON.stringify(envelope, null, 2) + "\n");
    }

    this.#queue.push(envelope);
    setImmediate(() => this.#drain());
  }

  #drain() {
    while (this.#queue.length > 0) {
      const envelope = this.#queue.shift();
      const handlers = this.#handlers.get(envelope.event) ?? [];
      for (const { handler } of handlers) {
        try {
          handler(envelope);
        } catch (err) {
          console.error(`[event-bus] handler error for ${envelope.event}:`, err);
        }
      }
    }
  }

  recent(limit = 50) {
    const dir = this.#agentEventDir || this.#runtimeEventDir;
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      return [];
    }
    return files
      .filter((f) => f.endsWith(".json"))
      .sort()
      .slice(-limit)
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  listByType(eventType, limit = 20) {
    const dir = this.#agentEventDir || this.#runtimeEventDir;
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      return [];
    }
    return files
      .filter((f) => f.endsWith(".json"))
      .sort()
      .slice(-limit * 5)
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((e) => e.event === eventType || e.type === eventType)
      .slice(-limit);
  }
}
