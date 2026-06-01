import fs from "node:fs";
import path from "node:path";

const LOCK_TTL = 30 * 60 * 1000; // 30 minutes

export class LockManager {
  constructor(locksDir) {
    this.locksDir = locksDir;
    fs.mkdirSync(locksDir, { recursive: true });
  }

  claim(lockName, owner, task, scope) {
    const existing = this.get(lockName);
    if (existing && !this.#isStale(existing)) {
      return { success: false, error: `Lock held by ${existing.owner}`, lock: existing };
    }
    const lock = {
      owner,
      task,
      scope: scope || [],
      createdAt: new Date().toISOString()
    };
    const filePath = path.join(this.locksDir, `${lockName}.lock`);
    fs.writeFileSync(filePath, JSON.stringify(lock, null, 2) + "\n");
    return { success: true, lock };
  }

  release(lockName, owner) {
    const existing = this.get(lockName);
    if (!existing) return { success: false, error: "Lock not found" };
    if (existing.owner !== owner) return { success: false, error: "Not lock owner" };
    const filePath = path.join(this.locksDir, `${lockName}.lock`);
    if (fs.existsSync(filePath)) fs.rmSync(filePath);
    return { success: true };
  }

  get(lockName) {
    const filePath = path.join(this.locksDir, `${lockName}.lock`);
    if (!fs.existsSync(filePath)) return null;
    try {
      const lock = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (this.#isStale(lock)) {
        fs.rmSync(filePath, { force: true });
        return null;
      }
      return lock;
    } catch {
      return null;
    }
  }

  list() {
    let files;
    try {
      files = fs.readdirSync(this.locksDir);
    } catch {
      return [];
    }
    const locks = [];
    for (const f of files) {
      if (!f.endsWith(".lock")) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(this.locksDir, f), "utf8"));
        locks.push({ name: f.replace(".lock", ""), ...data });
      } catch {
        continue;
      }
    }
    return locks;
  }

  isLocked(scope) {
    const locks = this.list();
    for (const lock of locks) {
      for (const s of lock.scope) {
        if (scope.startsWith(s)) return lock;
      }
    }
    return null;
  }

  forceRelease(lockName) {
    const filePath = path.join(this.locksDir, `${lockName}.lock`);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
      return { success: true };
    }
    return { success: false, error: "Lock not found" };
  }

  #isStale(lock) {
    if (!lock.createdAt) return true;
    const age = Date.now() - new Date(lock.createdAt).getTime();
    return age > LOCK_TTL;
  }
}
