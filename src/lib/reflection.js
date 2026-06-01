import fs from "node:fs";
import path from "node:path";

export class ReflectionEngine {
  #paths;
  #bus;
  #periodicTimer;
  #periodicInterval;

  constructor(paths, bus) {
    this.#paths = paths;
    this.#bus = bus;
    this.#periodicInterval = 300_000;
    this.#periodicTimer = null;
  }

  register() {
    this.#bus.on("reflection:trigger", () => this.#reflect());
    this.#bus.on("memory:compaction-needed", (envelope) => this.#compact(envelope));
    this.#bus.on("incident:created", () => this.#checkRecurringFailures());
    this.#startPeriodic();
  }

  unregister() {
    this.#stopPeriodic();
  }

  #startPeriodic() {
    this.#periodicTimer = setInterval(() => {
      this.#bus.emit("reflection:trigger", { source: "periodic", at: new Date().toISOString() });
    }, this.#periodicInterval);
  }

  #stopPeriodic() {
    if (this.#periodicTimer) {
      clearInterval(this.#periodicTimer);
      this.#periodicTimer = null;
    }
  }

  #reflect() {
    const reflectionsDir = this.#paths.reflectionsDir;
    if (!reflectionsDir) return;
    fs.mkdirSync(reflectionsDir, { recursive: true });

    const recent = this.#recentEpisodes();
    if (recent.length === 0) return;

    const patterns = this.#extractPatterns(recent);
    const incidents = this.#recentIncidents();
    const instabilityZones = this.#detectInstabilityZones(patterns);
    const docGaps = this.#detectDocumentationGaps();
    const regressions = this.#detectRegressions(recent);

    const reflection = {
      id: `reflection-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      at: new Date().toISOString(),
      source: "periodic",
      episodes: recent.length,
      patterns,
      incidents: incidents.length,
      instabilityZones,
      recurringFailures: this.#findRecurringFailures(incidents),
      regressions,
      docGaps,
      recommendations: this.#generateRecommendations(patterns, incidents, instabilityZones, docGaps)
    };

    const refFile = path.join(reflectionsDir, `${reflection.id}.json`);
    fs.writeFileSync(refFile, JSON.stringify(reflection, null, 2) + "\n");

    this.#bus.emit("reflection:complete", { reflection });

    return reflection;
  }

  #compact(envelope) {
    const { episodeCount } = envelope.data;
    const summariesDir = this.#paths.summariesDir;
    if (!summariesDir) return;
    fs.mkdirSync(summariesDir, { recursive: true });

    const summary = {
      id: `summary-${Date.now()}`,
      at: new Date().toISOString(),
      compressedEpisodes: episodeCount,
      note: "Memory compaction triggered. Archived episodes are summarized here."
    };

    const summaryFile = path.join(summariesDir, `${summary.id}.json`);
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + "\n");

    this.#bus.emit("memory:compacted", { summary });
  }

  #recentEpisodes() {
    const epDir = this.#paths.episodicDir;
    if (!fs.existsSync(epDir)) return [];

    let files;
    try {
      files = fs.readdirSync(epDir);
    } catch {
      return [];
    }

    return files
      .filter((f) => f.startsWith("ep-") && f.endsWith(".json"))
      .sort()
      .slice(-20)
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(epDir, f), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  #extractPatterns(episodes) {
    const topicCounts = {};

    for (const ep of episodes) {
      const topic = this.#classifyTopic(ep.goal ?? "");
      topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
    }

    return Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([topic, count]) => ({
        topic,
        count,
        frequency: `${((count / episodes.length) * 100).toFixed(0)}%`
      }));
  }

  #generateRecommendations(patterns, incidents, instabilityZones, docGaps) {
    const recs = [];

    for (const p of patterns) {
      if (p.topic === "bug-fix" && p.count > 3) {
        recs.push("High bug frequency detected. Consider adding a static analysis step to the pipeline.");
      }
      if (p.topic === "testing" && p.count < 2) {
        recs.push("Insufficient testing tasks. Consider requiring tests as part of all changes.");
      }
      if (p.topic === "documentation" && p.count < 1) {
        recs.push("No documentation tasks detected. Consider documenting changes as part of completion.");
      }
      if (p.topic === "refactoring" && p.count > 3) {
        recs.push("Frequent refactoring detected. Consider a dedicated technical debt reduction sprint.");
      }
    }

    for (const zone of instabilityZones) {
      recs.push(`Architecture instability detected in ${zone}. Consider subsystem review.`);
    }

    for (const gap of docGaps) {
      recs.push(`Documentation gap: ${gap}`);
    }

    if (incidents.length >= 3) {
      const recurring = this.#findRecurringFailures(incidents);
      if (recurring.length > 0) {
        recs.push(`Recurring failures detected: ${recurring.join(", ")}. Root cause analysis recommended.`);
      }
    }

    return recs;
  }

  #recentIncidents() {
    const incidentsDir = this.#paths.incidentsDir;
    if (!incidentsDir || !fs.existsSync(incidentsDir)) return [];
    let files;
    try {
      files = fs.readdirSync(incidentsDir);
    } catch {
      return [];
    }
    return files
      .filter((f) => f.endsWith(".json"))
      .sort()
      .slice(-20)
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(incidentsDir, f), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  #detectInstabilityZones(patterns) {
    const zones = [];
    const topicFiles = [];
    if (!this.#paths || !this.#paths.semanticDir) return zones;
    let files;
    try {
      files = fs.readdirSync(this.#paths.semanticDir);
    } catch {
      return zones;
    }
    for (const f of files) {
      if (f.endsWith(".json")) {
        topicFiles.push(f.replace(".json", ""));
      }
    }
    if (patterns.some((p) => p.topic === "bug-fix" && p.count > 5)) {
      zones.push("multiple-subsystems");
    }
    return zones;
  }

  #detectDocumentationGaps() {
    const gaps = [];
    const docsDir = this.#paths.docsDir;
    if (!docsDir || !fs.existsSync(docsDir)) return ["No documentation directory found"];
    let files;
    try {
      files = fs.readdirSync(docsDir);
    } catch {
      return ["Unable to read documentation directory"];
    }
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    if (mdFiles.length === 0) {
      gaps.push("No documentation files found");
    }
    return gaps;
  }

  #detectRegressions(episodes) {
    const regressions = [];
    for (const ep of episodes) {
      if ((ep.summary || "").toLowerCase().includes("regression")) {
        regressions.push(ep);
      }
    }
    return regressions;
  }

  #findRecurringFailures(incidents) {
    const topicCount = {};
    for (const inc of incidents) {
      const topic = this.#classifyTopic(inc.title || "");
      topicCount[topic] = (topicCount[topic] || 0) + 1;
    }
    return Object.entries(topicCount)
      .filter(([, count]) => count >= 2)
      .map(([topic]) => topic);
  }

  #checkRecurringFailures() {
    const incidents = this.#recentIncidents();
    if (incidents.length >= 3) {
      const recurring = this.#findRecurringFailures(incidents);
      if (recurring.length > 0) {
        this.#bus.emit("reflection:trigger", {
          source: "recurring-failure",
          recurring,
          at: new Date().toISOString()
        });
      }
    }
  }

  #classifyTopic(goal) {
    const g = (goal ?? "").toLowerCase();
    if (/test|spec|coverage/.test(g)) return "testing";
    if (/bug|fix|error|broken/.test(g)) return "bug-fix";
    if (/refactor|clean|improve/.test(g)) return "refactoring";
    if (/doc|readme|comment/.test(g)) return "documentation";
    if (/api|endpoint|route/.test(g)) return "api";
    if (/auth|login|session/.test(g)) return "authentication";
    if (/deploy|ci|cd/.test(g)) return "deployment";
    if (/perf|performance/.test(g)) return "performance";
    return "general";
  }
}
