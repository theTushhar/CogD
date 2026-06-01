import fs from "node:fs";
import path from "node:path";

const TRIGGER_MARKER = "---";

const INBOX_TYPES = {
  task: { dir: path.join("inbox", "tasks"), event: "inbox:task" },
  request: { dir: path.join("inbox", "requests"), event: "inbox:request" },
  event: { dir: path.join("inbox", "events"), event: "inbox:event" }
};

export class InboxWatcher {
  #paths;
  #bus;
  #watcher;
  #digests;

  constructor(paths, bus) {
    this.#paths = paths;
    this.#bus = bus;
    this.#digests = new Map();
  }

  start() {
    for (const [type, cfg] of Object.entries(INBOX_TYPES)) {
      const dir = path.join(this.#paths.agentRoot, cfg.dir);
      fs.mkdirSync(dir, { recursive: true });

      if (cfg.file) {
        this.#recordDigest(type, cfg, dir);
      } else {
        this.#recordDirDigest(type, cfg, dir);
      }
    }

    const inboxRoot = path.join(this.#paths.agentRoot, "inbox");
    this.#watcher = fs.watch(inboxRoot, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const full = path.resolve(inboxRoot, filename);
      if (!fs.existsSync(full)) return;

      for (const [type, cfg] of Object.entries(INBOX_TYPES)) {
        const watchDir = path.join(this.#paths.agentRoot, cfg.dir);
        if (!full.startsWith(watchDir)) continue;

        if (cfg.file && filename.endsWith(cfg.file)) {
          this.#onFileEvent(type, cfg, full);
        } else if (!cfg.file) {
          this.#onDirEvent(type, cfg, full);
        }
      }
    });
  }

  stop() {
    this.#watcher?.close();
  }

  #digestFile(type, cfg, dir) {
    const filePath = path.join(dir, cfg.file);
    if (!fs.existsSync(filePath)) return;
    this.#processFile(type, cfg, filePath);
  }

  #recordDigest(type, cfg, dir) {
    const filePath = path.join(dir, cfg.file);
    if (!fs.existsSync(filePath)) return;
    this.#digests.set(filePath, this.#getDigest(filePath));
  }

  #recordDirDigest(type, cfg, dir) {
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const file of files) {
      if (!file.endsWith(".md") && !file.endsWith(".json")) continue;
      const full = path.join(dir, file);
      this.#digests.set(full, this.#getDigest(full));
    }
  }

  #digestDir(type, cfg, dir) {
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const file of files) {
      if (!file.endsWith(".md") && !file.endsWith(".json")) continue;
      const full = path.join(dir, file);
      if (this.#digests.has(full)) continue;
      this.#processFile(type, cfg, full);
    }
  }

  #onFileEvent(type, cfg, filePath) {
    const content = fs.readFileSync(filePath, "utf8");
    const trimmed = content.trim();

    if (!trimmed.endsWith(TRIGGER_MARKER)) {
      this.#digests.set(filePath, this.#getDigest(filePath));
      return;
    }

    this.#processFile(type, cfg, filePath);
  }

  #onDirEvent(type, cfg, filePath) {
    this.#processFile(type, cfg, filePath);
  }

  #processFile(type, cfg, filePath) {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return;

    const digest = this.#getDigest(filePath);
    if (this.#digests.get(filePath) === digest) return;
    this.#digests.set(filePath, digest);

    const content = fs.readFileSync(filePath, "utf8").trim();
    if (!content) return;

    const finalContent = cfg.file
      ? content.replace(new RegExp(`\\s*${escapeRegex(TRIGGER_MARKER)}\\s*$`), "")
      : content;

    if (!finalContent) return;

    const relPath = path.relative(this.#paths.agentRoot, filePath);
    this.#bus.emit(cfg.event, {
      type,
      path: relPath,
      fullPath: filePath,
      content: finalContent,
      meta: this.#parseMeta(finalContent)
    });
  }

  #getDigest(filePath) {
    try {
      const stat = fs.statSync(filePath);
      return `${stat.mtimeMs}-${stat.size}`;
    } catch {
      return `${Date.now()}`;
    }
  }

  #parseMeta(content) {
    const meta = {};
    const lines = content.split("\n");
    let inMeta = false;
    for (const line of lines) {
      if (line.trim() === TRIGGER_MARKER) { inMeta = !inMeta; continue; }
      if (!inMeta) continue;
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return meta;
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
