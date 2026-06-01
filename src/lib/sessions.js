import fs from "node:fs";
import path from "node:path";

export class SessionManager {
  constructor(activeDir, archivedDir) {
    this.activeDir = activeDir;
    this.archivedDir = archivedDir;
    fs.mkdirSync(activeDir, { recursive: true });
    fs.mkdirSync(archivedDir, { recursive: true });
  }

  register(provider, mode, task, scope) {
    const session = {
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      provider,
      mode: mode || "general",
      task: task || "",
      scope: scope || [],
      startedAt: new Date().toISOString()
    };
    const filePath = path.join(this.activeDir, `${provider}-${mode}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2) + "\n");
    return session;
  }

  archive(sessionId) {
    let session = null;
    let files;
    try {
      files = fs.readdirSync(this.activeDir);
    } catch {
      return null;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(this.activeDir, f), "utf8"));
        if (data.id === sessionId) {
          session = data;
          fs.rmSync(path.join(this.activeDir, f));
          break;
        }
      } catch {
        continue;
      }
    }
    if (!session) return null;
    session.archivedAt = new Date().toISOString();
    const archPath = path.join(this.archivedDir, `${session.id}.json`);
    fs.writeFileSync(archPath, JSON.stringify(session, null, 2) + "\n");
    return session;
  }

  listActive() {
    let files;
    try {
      files = fs.readdirSync(this.activeDir);
    } catch {
      return [];
    }
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.activeDir, f), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  findByProvider(provider) {
    return this.listActive().filter((s) => s.provider === provider);
  }

  get(sessionId) {
    let files;
    try {
      files = fs.readdirSync(this.activeDir);
    } catch {
      return null;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(this.activeDir, f), "utf8"));
        if (data.id === sessionId) return data;
      } catch {
        continue;
      }
    }
    try {
      files = fs.readdirSync(this.archivedDir);
    } catch {
      return null;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(this.archivedDir, f), "utf8"));
        if (data.id === sessionId) return data;
      } catch {
        continue;
      }
    }
    return null;
  }
}
