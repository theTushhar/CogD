import fs from "node:fs";
import path from "node:path";

export class AgentRegistry {
  #paths;
  #bus;
  #pipeline;
  #providers;
  #context;
  #agents;

  constructor(paths, bus, pipeline, providers, context) {
    this.#paths = paths;
    this.#bus = bus;
    this.#pipeline = pipeline;
    this.#providers = providers;
    this.#context = context;
    this.#agents = new Map();
  }

  registerAll() {
    this.#registerMemoryAgent();
    this.#registerReflectionAgent();
    this.#registerOrchestratorAgent();
    this.#loadAgentDefs();
  }

  get(name) {
    return this.#agents.get(name) ?? null;
  }

  list() {
    return Array.from(this.#agents.values());
  }

  #registerMemoryAgent() {
    this.#bus.on("task:completed", (envelope) => {
      const { task } = envelope.data;
      this.#agents.set("memory-agent", {
        name: "memory-agent",
        role: "memory curator",
        description: "Persists task learnings into episodic and semantic memory.",
        event: "task:completed"
      });
    });

    this.#bus.on("memory:stored", (envelope) => {
      this.#checkCompaction();
    });
  }

  #registerReflectionAgent() {
    let reflectionCount = 0;

    this.#bus.on("memory:stored", () => {
      reflectionCount++;
      if (reflectionCount >= 5) {
        reflectionCount = 0;
        this.#bus.emit("reflection:trigger", { at: new Date().toISOString() });
      }
    });

    this.#bus.on("reflection:trigger", () => {
      this.#agents.set("reflection-agent", {
        name: "reflection-agent",
        role: "self-improvement analyzer",
        description: "Analyzes completed tasks to extract patterns and improve workflows.",
        event: "reflection:trigger"
      });
    });
  }

  #registerOrchestratorAgent() {
    this.#bus.on("task:escalated", (envelope) => {
      const { task } = envelope.data;
      console.error(`[orchestrator] Task ${task.id} escalated after repeated failures`);
    });
  }

  #checkCompaction() {
    let files;
    try {
      files = fs.readdirSync(this.#paths.episodicDir);
    } catch {
      return;
    }

    const episodes = files.filter((f) => f.startsWith("ep-") && f.endsWith(".json"));
    if (episodes.length > 100) {
      this.#bus.emit("memory:compaction-needed", {
        episodeCount: episodes.length,
        at: new Date().toISOString()
      });
    }
  }

  #loadAgentDefs() {
    const agentsDir = this.#paths.agentsDir;
    if (!agentsDir || !fs.existsSync(agentsDir)) return;
    let files;
    try {
      files = fs.readdirSync(agentsDir);
    } catch {
      return;
    }
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      try {
        const content = fs.readFileSync(path.join(agentsDir, f), "utf8");
        const def = this.#parseAgentDef(f, content);
        if (def) {
          this.#agents.set(def.name, def);
        }
      } catch {
        continue;
      }
    }
  }

  #parseAgentDef(filename, content) {
    const lines = content.split("\n");
    const meta = { name: filename.replace(".md", ""), source: `agents/${filename}` };

    let foundRole = false;
    let foundDesc = false;

    for (let i = 0; i < Math.min(lines.length, 100); i++) {
      const line = lines[i].trim();
      
      // Look for role in identity section or first few paragraphs
      if (!foundRole && (line.startsWith("You are the ") && line.includes("Agent"))) {
        const match = line.match(/You are the (.+?) Agent/i);
        if (match) {
          meta.role = match[1].toLowerCase().replace(/\s+/g, "-");
          foundRole = true;
        }
      }
      
      // Look for responsibility/description
      if (!foundDesc && (line.startsWith("Your responsibility is ") || line.startsWith("- **Responsibility**:"))) {
        meta.description = line.replace(/Your responsibility is | - \*\*Responsibility\*\*:/i, "").replace(/\.$/, "").trim();
        foundDesc = true;
      }

      // Fallback for header-based identity
      if (!foundRole && line.startsWith("# ")) {
        const h = line.replace("# ", "").trim();
        if (h.toLowerCase().includes("agent")) {
          meta.role = h.toLowerCase().replace("agent", "").trim().replace(/\s+/g, "-");
          foundRole = true;
        }
      }
    }

    return {
      name: meta.name,
      role: meta.role || "unknown",
      description: meta.description || "",
      model: "any",
      provider: "any",
      source: meta.source
    };
  }
}
