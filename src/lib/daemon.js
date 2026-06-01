import fs from "node:fs";
import path from "node:path";
import { appendJsonl, readJson, writeJson } from "./state.js";

export function getDaemonStatePath(paths) {
  return path.join(paths.runtimeDir, "daemon.json");
}

export function getDaemonPidPath(paths) {
  return path.join(paths.runtimeDir, "daemon.pid");
}

export function loadDaemonState(paths) {
  return readJson(getDaemonStatePath(paths), {
    status: "stopped",
    startedAt: null,
    pid: null,
    projectRoot: paths.rootDir
  });
}

export function saveDaemonState(paths, state) {
  writeJson(getDaemonStatePath(paths), state);
}

export function markEvent(paths, event) {
  appendJsonl(path.join(paths.runtimeDir, "events.jsonl"), event);
}

export function isPidAlive(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function cleanupStalePid(paths) {
  const pidPath = getDaemonPidPath(paths);
  if (!fs.existsSync(pidPath)) {
    return null;
  }

  const pid = Number(fs.readFileSync(pidPath, "utf8"));
  if (Number.isFinite(pid) && isPidAlive(pid)) {
    return pid;
  }

  fs.rmSync(pidPath, { force: true });
  return null;
}
