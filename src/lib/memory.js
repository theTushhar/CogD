import fs from "node:fs";
import path from "node:path";

export class MemorySystem {
  #paths;
  #bus;

  constructor(paths, bus) {
    this.#paths = paths;
    this.#bus = bus;
    fs.mkdirSync(paths.episodicDir, { recursive: true });
    fs.mkdirSync(paths.semanticDir, { recursive: true });
  }

  register() {
    this.#bus.on("task:completed", (envelope) => this.#storeTaskMemory(envelope));
    this.#bus.on("task:failed", (envelope) => this.#storeFailureMemory(envelope));
  }

  #storeTaskMemory(envelope) {
    const { task } = envelope.data;
    if (!task) return;

    const episodeId = `ep-${task.id}`;
    const episode = {
      id: episodeId,
      taskId: task.id,
      goal: task.goal ?? task.description ?? "unknown",
      provider: task.provider ?? "unknown",
      status: task.status,
      summary: task.result?.summary ?? "",
      patches: task.result?.patches ?? [],
      artifacts: task.result?.artifacts ?? {},
      createdAt: task.createdAt,
      completedAt: task.updatedAt,
      duration: task.result?.duration ?? 0
    };

    const epFile = path.join(this.#paths.episodicDir, `${episodeId}.json`);
    fs.writeFileSync(epFile, JSON.stringify(episode, null, 2) + "\n");

    this.#extractSemantic(episode);
    this.#bus.emit("memory:stored", { episode });
  }

  #storeFailureMemory(envelope) {
    const { task } = envelope.data;
    if (!task) return;

    const failDir = path.join(this.#paths.episodicDir, "failures");
    fs.mkdirSync(failDir, { recursive: true });

    const failFile = path.join(failDir, `fail-${task.id}.json`);
    fs.writeFileSync(failFile, JSON.stringify({
      id: `fail-${task.id}`,
      taskId: task.id,
      goal: task.goal ?? task.description ?? "unknown",
      provider: task.provider,
      history: task.history,
      result: task.result,
      failedAt: task.updatedAt
    }, null, 2) + "\n");

    this.#storeIncident(task);
  }

  #storeIncident(task) {
    const incidentsDir = this.#paths.incidentsDir;
    if (!incidentsDir) return;
    fs.mkdirSync(incidentsDir, { recursive: true });

    const { summary, command, exitCode, errorFile, errorLine } = (task.result ?? {});
    const incident = {
      id: `INCIDENT-${Date.now()}`,
      taskId: task.id,
      title: task.goal ?? "Unknown failure",
      summary: summary ?? "No summary",
      provider: task.provider,
      command: command ?? "",
      exitCode: exitCode ?? null,
      errorFile: errorFile ?? "",
      errorLine: errorLine ?? null,
      failedAt: task.updatedAt,
      severity: this.#determineSeverity(task),
      fingerprint: this.#failureFingerprint(task)
    };

    const incFile = path.join(incidentsDir, `${incident.id}.json`);
    fs.writeFileSync(incFile, JSON.stringify(incident, null, 2) + "\n");
    this.#bus.emit("incident:created", { incident });
  }

  #failureFingerprint(task) {
    const parts = [
      task.provider ?? "unknown",
      "execution",
      "",
      (task.result?.summary ?? "").slice(0, 80)
    ].filter(Boolean).join("::");
    let hash = 0;
    for (let i = 0; i < parts.length; i++) {
      const char = parts.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).slice(0, 8);
  }

  #determineSeverity(task) {
    const failures = (task.history ?? []).filter((h) => h.to === "failed").length;
    if (failures >= 3) return "critical";
    if (failures >= 2) return "high";
    return "medium";
  }

  #extractSemantic(episode) {
    const { goal, summary, patches } = episode;

    const semanticEntry = {
      id: `sem-${episode.id}`,
      source: episode.id,
      topic: this.#classifyTopic(goal),
      insight: summary,
      patterns: this.#extractPatterns(patches),
      learned: new Date().toISOString()
    };

    const topicFile = path.join(
      this.#paths.semanticDir,
      `${semanticEntry.topic.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.json`
    );

    let existing = [];
    if (fs.existsSync(topicFile)) {
      try {
        existing = JSON.parse(fs.readFileSync(topicFile, "utf8"));
      } catch {
        existing = [];
      }
    }

    if (!Array.isArray(existing)) existing = [];
    existing.push(semanticEntry);

    fs.writeFileSync(topicFile, JSON.stringify(existing, null, 2) + "\n");
  }

  semanticSearch(query, limit = 10) {
    const q = query.toLowerCase();
    const results = [];
    const topics = this.#listTopics();
    
    for (const topic of topics) {
      const entries = this.retrieve(topic, 50);
      for (const entry of entries) {
        const text = (entry.insight + " " + entry.topic + " " + (entry.patterns || []).map(p => p.file).join(" ")).toLowerCase();
        if (text.includes(q)) {
          results.push(entry);
        }
      }
    }
    
    return results.sort((a, b) => new Date(b.learned) - new Date(a.learned)).slice(0, limit);
  }

  #listTopics() {
    try {
      const files = fs.readdirSync(this.#paths.semanticDir);
      return files.filter(f => f.endsWith(".json")).map(f => f.replace(".json", ""));
    } catch {
      return [];
    }
  }

  #classifyTopic(goal) {
    const goalLower = goal.toLowerCase();
    if (/test|spec|coverage/.test(goalLower)) return "testing";
    if (/bug|fix|error|broken/.test(goalLower)) return "bug-fix";
    if (/refactor|clean|improve/.test(goalLower)) return "refactoring";
    if (/doc|readme|comment/.test(goalLower)) return "documentation";
    if (/api|endpoint|route/.test(goalLower)) return "api";
    if (/auth|login|session|permission/.test(goalLower)) return "authentication";
    if (/deploy|ci|cd|pipeline/.test(goalLower)) return "deployment";
    if (/perf|performance|slow|latency/.test(goalLower)) return "performance";
    return "general";
  }

  #extractPatterns(patches) {
    if (!patches || !Array.isArray(patches)) return [];
    return patches.map((p) => ({
      file: p.file ?? "unknown",
      change: p.summary ?? `${p.additions ?? 0} additions, ${p.deletions ?? 0} deletions`
    }));
  }

  retrieve(topic, limit = 5) {
    const topicFile = path.join(
      this.#paths.semanticDir,
      `${topic.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.json`
    );

    if (!fs.existsSync(topicFile)) return [];

    try {
      const entries = JSON.parse(fs.readFileSync(topicFile, "utf8"));
      return Array.isArray(entries) ? entries.slice(-limit) : [];
    } catch {
      return [];
    }
  }

  recentEpisodes(limit = 10) {
    let files;
    try {
      files = fs.readdirSync(this.#paths.episodicDir);
    } catch {
      return [];
    }

    return files
      .filter((f) => f.startsWith("ep-") && f.endsWith(".json"))
      .sort()
      .slice(-limit)
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.#paths.episodicDir, f), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }
}
