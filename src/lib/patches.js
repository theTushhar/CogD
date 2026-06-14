import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

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

  apply(patchId) {
    const record = this.get(patchId);
    if (!record) return { success: false, error: "Patch record not found" };

    const results = [];
    for (const patch of record.patches) {
      if (!patch.file) {
        results.push({ file: "unknown", success: false, error: "Missing file field" });
        continue;
      }
      const filePath = path.resolve(process.cwd(), patch.file);
      if (!patch.diff || !patch.diff.trim()) {
        results.push({ file: patch.file, success: false, error: "Empty diff" });
        continue;
      }

      const isUnifiedDiff = patch.diff.includes("@@") || (patch.diff.includes("---") && patch.diff.includes("+++"));

      if (isUnifiedDiff) {
        const tempPath = path.join(this.patchesDir, `temp-${Date.now()}.patch`);
        try {
          fs.writeFileSync(tempPath, patch.diff);
          execSync(`git apply --whitespace=fix "${tempPath}"`, { stdio: "pipe" });
          results.push({ file: patch.file, success: true, method: "git apply" });
        } catch (err) {
          results.push({ file: patch.file, success: false, error: `Git apply failed: ${err.message}` });
        } finally {
          if (fs.existsSync(tempPath)) fs.rmSync(tempPath);
        }
      } else {
        try {
          fs.mkdirSync(path.dirname(filePath), { recursive: true });
          fs.writeFileSync(filePath, patch.diff);
          results.push({ file: patch.file, success: true, method: "overwrite" });
        } catch (err) {
          results.push({ file: patch.file, success: false, error: `Overwrite failed: ${err.message}` });
        }
      }
    }

    return { success: results.every(r => r.success), results };
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
