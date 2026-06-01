import fs from "node:fs";
import path from "node:path";

export class WorkflowEngine {
  constructor(workflowsDir, bus) {
    this.workflowsDir = workflowsDir;
    this.bus = bus;
    fs.mkdirSync(workflowsDir, { recursive: true });
  }

  load(name) {
    const filePath = path.join(this.workflowsDir, `${name}.yaml`);
    if (!fs.existsSync(filePath)) return null;
    return this.#parse(fs.readFileSync(filePath, "utf8"));
  }

  loadAll() {
    let files;
    try {
      files = fs.readdirSync(this.workflowsDir);
    } catch {
      return [];
    }
    return files
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => this.load(f.replace(".yaml", "")))
      .filter(Boolean);
  }

  #parse(content) {
    const lines = content.split("\n");
    const workflow = { name: "", steps: [] };
    let inSteps = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("name:")) {
        workflow.name = trimmed.slice(5).trim();
      }
      if (trimmed.startsWith("steps:")) {
        inSteps = true;
        continue;
      }
      if (inSteps && trimmed.startsWith("- ")) {
        workflow.steps.push(trimmed.slice(2).trim());
      }
    }
    return workflow;
  }

  async execute(workflowName, context) {
    const workflow = typeof workflowName === "string" ? this.load(workflowName) : workflowName;
    if (!workflow) throw new Error(`Workflow not found: ${workflowName}`);

    const results = [];
    for (const step of workflow.steps) {
      this.bus.emit("workflow:step", { workflow: workflow.name, step, context });
      try {
        const result = await this.#runStep(step, context);
        results.push({ step, status: "completed", result });
      } catch (err) {
        results.push({ step, status: "failed", error: err.message });
        this.bus.emit("workflow:failed", { workflow: workflow.name, step, error: err.message });
        break;
      }
    }

    this.bus.emit("workflow:completed", {
      workflow: workflow.name,
      results,
      context
    });

    return results;
  }

  async #runStep(step, context) {
    this.bus.emit(`step:${step}`, { step, context });
    return { step, note: `${step} step executed` };
  }
}
