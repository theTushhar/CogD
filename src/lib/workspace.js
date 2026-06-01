import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const AGENT_DIR = ".agent";

export function getProjectRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);

  while (true) {
    const candidate = path.join(current, ".git");
    if (fs.existsSync(candidate)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(startDir);
    }

    current = parent;
  }
}

export function getTemplateDir() {
  return path.resolve(__dirname, "..", "templates", "agent");
}

export function getAgentPaths(rootDir = getProjectRoot()) {
  const agentRoot = path.join(rootDir, AGENT_DIR);
  return {
    rootDir,
    agentRoot,
    agentsDir: path.join(agentRoot, "agents"),
    inboxDir: path.join(agentRoot, "inbox"),
    tasksDir: path.join(agentRoot, "tasks"),
    tasksActiveDir: path.join(agentRoot, "tasks", "active"),
    tasksCompletedDir: path.join(agentRoot, "tasks", "completed"),
    tasksFailedDir: path.join(agentRoot, "tasks", "failed"),
    tasksBacklogDir: path.join(agentRoot, "tasks", "backlog"),
    memoryDir: path.join(agentRoot, "memory"),
    episodicDir: path.join(agentRoot, "memory", "episodic"),
    semanticDir: path.join(agentRoot, "memory", "semantic"),
    reflectionsDir: path.join(agentRoot, "memory", "reflections"),
    summariesDir: path.join(agentRoot, "memory", "summaries"),
    incidentsDir: path.join(agentRoot, "memory", "incidents"),
    graphDir: path.join(agentRoot, "graph"),
    contextDir: path.join(agentRoot, "context"),
    workflowsDir: path.join(agentRoot, "workflows"),
    sessionsDir: path.join(agentRoot, "sessions"),
    sessionsActiveDir: path.join(agentRoot, "sessions", "active"),
    sessionsArchivedDir: path.join(agentRoot, "sessions", "archived"),
    eventsDir: path.join(agentRoot, "events"),
    locksDir: path.join(agentRoot, "locks"),
    reviewsDir: path.join(agentRoot, "reviews"),
    patchesDir: path.join(agentRoot, "patches"),
    runtimeDir: path.join(agentRoot, "runtime"),
    logsDir: path.join(agentRoot, "logs"),
    docsDir: path.join(agentRoot, "docs"),
    docsArchDir: path.join(agentRoot, "docs", "architecture"),
    docsIncidentsDir: path.join(agentRoot, "docs", "incidents"),
    docsDecisionsDir: path.join(agentRoot, "docs", "decisions"),
    docsSubsystemsDir: path.join(agentRoot, "docs", "subsystems"),
    continuityDir: path.join(agentRoot, "continuity"),
    workStateDir: path.join(agentRoot, "continuity", "work-state"),
    handoffsDir: path.join(agentRoot, "continuity", "handoffs"),
    decisionsDir: path.join(agentRoot, "continuity", "decisions"),
    failureMemoryDir: path.join(agentRoot, "continuity", "failures")
  };
}

export function ensureWorkspace(rootDir = getProjectRoot()) {
  const paths = getAgentPaths(rootDir);

  if (!fs.existsSync(paths.agentRoot)) {
    const templateDir = getTemplateDir();
    if (fs.existsSync(templateDir)) {
      copyTemplate(templateDir, paths.agentRoot);
    } else {
      createEmptyDirs(paths);
    }
  } else {
    createEmptyDirs(paths);
    syncTemplate(paths);
  }

  return paths;
}

export function loadConfig(rootDir = getProjectRoot()) {
  const filePath = path.join(rootDir, "cog.json");
  const defaultConfig = {
    autoDetect: true,
    providers: {},
    preferences: [],
    agents: {}
  };
  if (!fs.existsSync(filePath)) return defaultConfig;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return defaultConfig;
  }
}

export function saveConfig(rootDir, config) {
  const filePath = path.join(rootDir, "cog.json");
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
}

export function ensureConfig(rootDir = getProjectRoot()) {
  const config = loadConfig(rootDir);
  saveConfig(rootDir, config);
  return config;
}

function interpolateProtocol(paths) {
  const protocolPath = path.join(paths.agentRoot, "PROTOCOL.md");
  if (!fs.existsSync(protocolPath)) return;

  const project = path.basename(paths.rootDir);
  let content = fs.readFileSync(protocolPath, "utf8");
  content = content
    .replace(/\{\{PROJECT_NAME\}\}/g, project)
    .replace(/\{\{LANGUAGES\}\}/g, "typescript, javascript")
    .replace(/\{\{RUNTIME\}\}/g, "node");
  
  fs.writeFileSync(protocolPath, content);
}

function syncTemplate(paths) {
  const templateDir = getTemplateDir();
  if (!fs.existsSync(templateDir)) return;
  syncDir(templateDir, paths.agentRoot);
  interpolateProtocol(paths);
}

function syncDir(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true });
      }
      syncDir(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyTemplate(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyTemplate(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function createEmptyDirs(paths) {
  const directories = [
    paths.agentRoot,
    paths.agentsDir,
    paths.inboxDir,
    paths.tasksDir,
    paths.tasksActiveDir,
    paths.tasksCompletedDir,
    paths.tasksFailedDir,
    paths.tasksBacklogDir,
    paths.memoryDir,
    paths.episodicDir,
    paths.semanticDir,
    paths.reflectionsDir,
    paths.summariesDir,
    paths.incidentsDir,
    paths.graphDir,
    paths.contextDir,
    paths.workflowsDir,
    paths.sessionsDir,
    paths.sessionsActiveDir,
    paths.sessionsArchivedDir,
    paths.eventsDir,
    paths.locksDir,
    paths.reviewsDir,
    paths.patchesDir,
    paths.runtimeDir,
    paths.logsDir,
    paths.docsDir,
    paths.docsArchDir,
    paths.docsIncidentsDir,
    paths.docsDecisionsDir,
    paths.docsSubsystemsDir,
    paths.continuityDir,
    paths.workStateDir,
    paths.handoffsDir,
    paths.decisionsDir,
    paths.failureMemoryDir
  ];

  for (const directory of directories) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

export function writeIfMissing(filePath, content) {
  if (!fs.existsSync(filePath)) {
    const value = typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
    fs.writeFileSync(filePath, value);
    return true;
  }

  return false;
}
