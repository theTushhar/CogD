import fs from "node:fs";
import path from "node:path";

export class MCPServer {
  constructor(paths, runtime) {
    this.paths = paths;
    this.runtime = runtime;
  }

  getResources() {
    return {
      "memory://semantic": { path: this.paths.semanticDir },
      "memory://episodic": { path: this.paths.episodicDir },
      "memory://reflections": { path: this.paths.reflectionsDir },
      "memory://incidents": { path: this.paths.incidentsDir },
      "task://active": { path: this.paths.tasksActiveDir },
      "graph://architecture": { path: path.join(this.paths.graphDir, "architecture.json") },
      "graph://dependencies": { path: path.join(this.paths.graphDir, "dependencies.json") },
      "graph://ownership": { path: path.join(this.paths.graphDir, "ownership.json") },
      "graph://risk-map": { path: path.join(this.paths.graphDir, "risk-map.json") },
      "context://current": { path: path.join(this.paths.contextDir, "current.md") },
      "context://architecture": { path: path.join(this.paths.contextDir, "architecture.md") },
      "context://conventions": { path: path.join(this.paths.contextDir, "conventions.md") },
      "continuity://work-state": { path: path.join(this.paths.workStateDir, "active.json") },
      "continuity://handoff": { path: path.join(this.paths.handoffsDir, "latest.json") },
      "continuity://decisions": { path: path.join(this.paths.decisionsDir, "decisions.jsonl") },
      "continuity://failures": { path: path.join(this.paths.failureMemoryDir, "failure_patterns.jsonl") },
      "continuity://view": { path: path.join(this.paths.continuityDir, "continuity-view.md") },
      "continuity://resume-capsule": { path: path.join(this.paths.continuityDir, "resume-capsule.md") }
    };
  }

  getTools() {
    return {
      create_task: { description: "Create a new task" },
      update_task: { description: "Update an existing task" },
      store_memory: { description: "Store data into memory" },
      query_memory: { description: "Query memory stores" },
      claim_lock: { description: "Claim a lock on scope" },
      release_lock: { description: "Release a held lock" },
      emit_event: { description: "Emit an event" },
      search_graph: { description: "Search the knowledge graph" },
      run_reflection: { description: "Trigger a reflection cycle" },
      register_session: { description: "Register a provider session" },
      archive_session: { description: "Archive an active session" },
      resume_continuity: { description: "Get continuity resume capsule for a task" },
      finalize_continuity: { description: "Save execution summary as continuity handoff" },
      record_decision: { description: "Record an architecture/project decision" },
      record_failure: { description: "Record a failure pattern" },
      get_work_state: { description: "Get current active work state" },
      update_work_state: { description: "Update active work state fields" },
      get_continuity_quality: { description: "Get continuity freshness quality score" },
      generate_continuity_view: { description: "Generate continuity view report" }
    };
  }

  getPrompts() {
    return [
      { name: "diagnosis-agent", description: "Systematic root cause analysis" },
      { name: "review-agent", description: "Code review and quality assurance" },
      { name: "planner-agent", description: "Goal decomposition and task orchestration" },
      { name: "security-agent", description: "Security vulnerability assessment" },
      { name: "refactor-agent", description: "Structural code improvement" },
      { name: "continuity-resume", description: "Resume from prior session continuity" },
      { name: "continuity-finalize", description: "Finalize current session for next agent" }
    ];
  }

  resolveUri(uri) {
    const resources = this.getResources();
    for (const [key, val] of Object.entries(resources)) {
      if (uri.startsWith(key)) {
        const p = val.path;
        if (!fs.existsSync(p)) return null;
        try {
          const stat = fs.statSync(p);
          if (stat.isDirectory()) {
            return { uri, type: "directory", path: p };
          }
          return { uri, type: "file", path: p, content: fs.readFileSync(p, "utf8") };
        } catch {
          return null;
        }
      }
    }
    return null;
  }
}
