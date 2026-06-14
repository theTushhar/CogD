import fs from "node:fs";
import path from "node:path";

export class Planner {
  #paths;
  #bus;
  #providers;

  constructor(paths, bus, providers) {
    this.#paths = paths;
    this.#bus = bus;
    this.#providers = providers;
  }

  register() {
    this.#bus.on("inbox:task", (envelope) => this.#onInboxTask(envelope));
    this.#bus.on("goal:created", (envelope) => this.#onGoalCreated(envelope));
  }

  #onInboxTask(envelope) {
    const { content, meta } = envelope.data;
    this.#bus.emit("goal:created", {
      goal: content,
      meta: meta || {},
      at: new Date().toISOString()
    });
  }

  async #onGoalCreated(envelope) {
    const { goal, meta } = envelope.data;
    
    let plan = null;

    if (this.#providers) {
      plan = await this.#decomposeWithLLM(goal, meta);
    }

    if (!plan) {
      // Fallback to simple plan
      plan = {
        id: `plan-${Date.now()}`,
        goal,
        tasks: [
          {
            id: `task-${Date.now()}-1`,
            goal: goal,
            requires: [],
            ...meta
          }
        ],
        at: new Date().toISOString()
      };
    }

    this.#bus.emit("plan:ready", plan);
  }

  async #decomposeWithLLM(goal, meta) {
    const provider = this.#providers.resolve(meta.provider);
    if (!provider || provider.name === "internal") return null;

    const prompt = `You are an AI Planner. Decompose the following goal into a sequence of atomic tasks.
Goal: ${goal}

Output your plan in JSON format:
{
  "tasks": [
    { "goal": "task description", "requires": ["previous task goal"] }
  ]
}

Only output the JSON.`;

    try {
      const result = await provider.execute({ goal: prompt }, { architecture: "Cog Persistence Runtime" }, {});
      if (result.status === "completed") {
        const match = result.summary.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          return {
            id: `plan-${Date.now()}`,
            goal,
            tasks: parsed.tasks.map((t, i) => ({
              id: `task-${Date.now()}-${i}`,
              ...t,
              ...meta
            })),
            at: new Date().toISOString()
          };
        }
      }
    } catch (err) {
      console.error("[planner] decomposition failed:", err.message);
    }
    return null;
  }
}
