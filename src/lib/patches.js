import fs from "node:fs";
import path from "node:path";

export class PatchManager {
  constructor(patchesDir) {
    this.patchesDir = patchesDir;
    fs.mkdirSync(patchesDir, { recursive: true });
  }

  store(taskId, patches, author) {
    const record = {
      id: `patch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      taskId,
      author: author || "unknown",
      patches: patches || [],
      createdAt: new Date().toISOString()
    };
    this.#save(record);
    return record;
  }

  get(patchId) {
    const filePath = path.join(this.patchesDir, `${patchId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  findByTask(taskId) {
    let files;
    try {
      files = fs.readdirSync(this.patchesDir);
    } catch {
      return [];
    }
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.patchesDir, f), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((p) => p.taskId === taskId);
  }

  list(limit = 20) {
    let files;
    try {
      files = fs.readdirSync(this.patchesDir);
    } catch {
      return [];
    }
    return files
      .filter((f) => f.endsWith(".json"))
      .sort()
      .slice(-limit)
      .map((f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(this.patchesDir, f), "utf8"));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  #save(record) {
    const filePath = path.join(this.patchesDir, `${record.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + "\n");
  }
}
