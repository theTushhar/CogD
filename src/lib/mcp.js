import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

export class MCPServer {
  constructor(paths, runtime) {
    this.paths = paths;
    this.runtime = runtime;
  }

  getResources() {
    return {
      "memory://semantic": { name: "Semantic Memory Topic Stores", path: this.paths.semanticDir },
      "memory://episodic": { name: "Episodic Task Memory Records", path: this.paths.episodicDir },
      "memory://reflections": { name: "Self-Improvement Reflection Logs", path: this.paths.reflectionsDir },
      "memory://incidents": { name: "System Incident Logs", path: this.paths.incidentsDir },
      "task://active": { name: "Active Task Definitions", path: this.paths.tasksActiveDir },
      "graph://architecture": { name: "Subsystem Architecture Graph", path: path.join(this.paths.graphDir, "architecture.json") },
      "context://current": { name: "Current Session Context md", path: path.join(this.paths.contextDir, "current.md") },
      "context://architecture": { name: "Architecture Overview md", path: path.join(this.paths.contextDir, "architecture.md") },
      "context://conventions": { name: "Coding Conventions md", path: path.join(this.paths.contextDir, "conventions.md") },
      "continuity://work-state": { name: "Active Git Work State json", path: path.join(this.paths.workStateDir, "active.json") },
      "continuity://handoff": { name: "Latest Handoff Handoff Record", path: path.join(this.paths.handoffsDir, "latest.json") },
      "continuity://decisions": { name: "Project Architectural Decisions", path: path.join(this.paths.decisionsDir, "decisions.jsonl") },
      "continuity://failures": { name: "Failure Patterns Fingerprints", path: path.join(this.paths.failureMemoryDir, "failure_patterns.jsonl") },
      "continuity://view": { name: "Continuity MD Report", path: path.join(this.paths.continuityDir, "continuity-view.md") }
    };
  }

  getTools() {
    return {
      create_task: {
        description: "Create a new task in the pipeline",
        inputSchema: {
          type: "object",
          properties: {
            goal: { type: "string", description: "Goal of the task" },
            requires: { type: "array", items: { type: "string" }, description: "Pre-requisite goals" }
          },
          required: ["goal"]
        }
      },
      update_task: {
        description: "Transition a task to a new status",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Task ID" },
            status: { type: "string", description: "New status (queued, planned, executing, completed, failed)" },
            meta: { type: "object", description: "Metadata/result object" }
          },
          required: ["id", "status"]
        }
      },
      claim_lock: {
        description: "Claim a resource lock on a scope",
        inputSchema: {
          type: "object",
          properties: {
            lockName: { type: "string", description: "Name of lock" },
            owner: { type: "string", description: "Lock owner" },
            task: { type: "string", description: "Associated task ID" },
            scope: { type: "array", items: { type: "string" }, description: "Lock scopes" }
          },
          required: ["lockName", "owner"]
        }
      },
      release_lock: {
        description: "Release a held resource lock",
        inputSchema: {
          type: "object",
          properties: {
            lockName: { type: "string", description: "Name of lock" },
            owner: { type: "string", description: "Lock owner" }
          },
          required: ["lockName", "owner"]
        }
      },
      record_decision: {
        description: "Record an architectural or technical decision",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Decision title" },
            decision: { type: "string", description: "Technical decision details" },
            context: { type: "string", description: "Context background" }
          },
          required: ["title", "decision"]
        }
      },
      get_work_state: {
        description: "Retrieve the current active work state",
        inputSchema: { type: "object", properties: {} }
      },
      update_work_state: {
        description: "Update active work state fields",
        inputSchema: {
          type: "object",
          properties: {
            nextAction: { type: "string" },
            hypothesis: { type: "string" },
            activeFiles: { type: "array", items: { type: "string" } },
            verifiedItems: { type: "array", items: { type: "string" } },
            unverifiedAssumptions: { type: "array", items: { type: "string" } }
          }
        }
      },
      generate_continuity_view: {
        description: "Generate the continuity view markdown file",
        inputSchema: { type: "object", properties: {} }
      }
    };
  }

  getPrompts() {
    return [
      { name: "diagnose", description: "Analyze failure patterns and workspace context to diagnose problems" },
      { name: "handoff", description: "Generate session handoff details" }
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
            const files = fs.readdirSync(p).filter(f => f.endsWith(".json") || f.endsWith(".md"));
            const content = files.map(f => `File: ${f}\n---\n${fs.readFileSync(path.join(p, f), "utf8")}`).join("\n\n");
            return { uri, type: "directory", path: p, content };
          }
          return { uri, type: "file", path: p, content: fs.readFileSync(p, "utf8") };
        } catch {
          return null;
        }
      }
    }
    return null;
  }

  start() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    rl.on("line", async (line) => {
      if (!line.trim()) return;
      try {
        const request = JSON.parse(line);
        const response = await this.handleMessage(request);
        if (response) {
          process.stdout.write(JSON.stringify(response) + "\n");
        }
      } catch (err) {
        process.stdout.write(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32700, message: `Parse error: ${err.message}` },
          id: null
        }) + "\n");
      }
    });
  }

  async handleMessage(msg) {
    if (msg.jsonrpc !== "2.0") return null;

    // Handle notifications (no id)
    if (msg.id === undefined || msg.id === null) {
      return null;
    }

    try {
      const result = await this.dispatch(msg.method, msg.params);
      return {
        jsonrpc: "2.0",
        id: msg.id,
        result
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id: msg.id,
        error: {
          code: err.code || -32603,
          message: err.message || "Internal error"
        }
      };
    }
  }

  async dispatch(method, params) {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: "2024-11-05",
          capabilities: {
            resources: {},
            tools: {},
            prompts: {}
          },
          serverInfo: {
            name: "cog-mcp-server",
            version: "0.2.0"
          }
        };

      case "resources/list": {
        const resources = this.getResources();
        return {
          resources: Object.entries(resources).map(([uri, info]) => ({
            uri,
            name: info.name,
            mimeType: uri.endsWith(".json") ? "application/json" : "text/markdown"
          }))
        };
      }

      case "resources/read": {
        const { uri } = params;
        const resolved = this.resolveUri(uri);
        if (!resolved) {
          throw { code: -32602, message: `Resource not found: ${uri}` };
        }
        return {
          contents: [{
            uri,
            mimeType: "text/plain",
            text: resolved.content
          }]
        };
      }

      case "tools/list": {
        const tools = this.getTools();
        return {
          tools: Object.entries(tools).map(([name, info]) => ({
            name,
            description: info.description,
            inputSchema: info.inputSchema
          }))
        };
      }

      case "tools/call": {
        const { name, arguments: args } = params;
        const resultText = await this.executeTool(name, args);
        return {
          content: [{
            type: "text",
            text: resultText
          }]
        };
      }

      case "prompts/list": {
        return {
          prompts: this.getPrompts()
        };
      }

      case "prompts/get": {
        const { name } = params;
        if (name === "diagnose") {
          const failures = fs.existsSync(path.join(this.paths.failureMemoryDir, "failure_patterns.jsonl"))
            ? fs.readFileSync(path.join(this.paths.failureMemoryDir, "failure_patterns.jsonl"), "utf8")
            : "No failures recorded.";
          return {
            description: "Systematic root cause analysis",
            messages: [{
              role: "user",
              content: {
                type: "text",
                text: `Diagnose repository failures using patterns:\n${failures}`
              }
            }]
          };
        }
        if (name === "handoff") {
          const ws = fs.existsSync(path.join(this.paths.workStateDir, "active.json"))
            ? fs.readFileSync(path.join(this.paths.workStateDir, "active.json"), "utf8")
            : "No active work state.";
          return {
            description: "Generate session handoff details",
            messages: [{
              role: "user",
              content: {
                type: "text",
                text: `Create handoff for state:\n${ws}`
              }
            }]
          };
        }
        throw { code: -32602, message: `Prompt not found: ${name}` };
      }

      default:
        throw { code: -32601, message: `Method not found: ${method}` };
    }
  }

  async executeTool(name, args) {
    switch (name) {
      case "create_task": {
        const task = this.runtime.pipeline.create(args);
        return `Task "${task.goal}" created successfully (ID: ${task.id}).`;
      }
      case "update_task": {
        const task = this.runtime.pipeline.transition(args.id, args.status, args.meta || {});
        return `Task ${args.id} transitioned to "${args.status}".`;
      }
      case "claim_lock": {
        const res = this.runtime.locks.claim(args.lockName, args.owner, args.task, args.scope);
        if (res.success) {
          return `Lock "${args.lockName}" claimed by ${args.owner}.`;
        } else {
          return `Failed to claim lock: ${res.error}`;
        }
      }
      case "release_lock": {
        const res = this.runtime.locks.release(args.lockName, args.owner);
        if (res.success) {
          return `Lock "${args.lockName}" released.`;
        } else {
          return `Failed to release lock: ${res.error}`;
        }
      }
      case "record_decision": {
        const dec = this.runtime.continuity.recordDecision(args.title, args.decision, args.context || "");
        return `Decision "${args.title}" recorded under ID: ${dec.id}.`;
      }
      case "get_work_state": {
        const ws = this.runtime.continuity.getWorkState();
        return JSON.stringify(ws, null, 2);
      }
      case "update_work_state": {
        const ws = this.runtime.continuity.updateWorkState(args);
        return `Work state updated successfully: ${JSON.stringify(ws, null, 2)}`;
      }
      case "generate_continuity_view": {
        const filePath = this.runtime.continuity.generateContinuityView();
        return `Continuity report generated at: ${filePath}`;
      }
      default:
        throw new Error(`Tool not implemented: ${name}`);
    }
  }
}
