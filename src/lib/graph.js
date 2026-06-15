import fs from "node:fs";
import path from "node:path";

/**
 * Unified Knowledge Graph
 * 
 * Consolidates architecture, dependencies, ownership, and risks into a single 
 * high-performance graph structure persisted in .agent/graph/graph.json.
 * 
 * Supports typed nodes and edges for better reasoning by AI providers.
 */
export class KnowledgeGraph {
  #graphDir;
  #nodes;
  #edges;
  #graphFilePath;

  constructor(graphDir) {
    this.#graphDir = graphDir;
    this.#nodes = new Map();
    this.#edges = [];
    this.#graphFilePath = path.join(graphDir, "graph.json");
    
    if (!fs.existsSync(graphDir)) {
      fs.mkdirSync(graphDir, { recursive: true });
    }
    
    this.#load();
  }

  /**
   * Core Graph Operations
   */

  addNode(id, label, type = "concept", meta = {}) {
    this.#nodes.set(id, { 
      id, 
      label, 
      type, 
      meta, 
      updatedAt: new Date().toISOString() 
    });
    this.#persist();
    return this.#nodes.get(id);
  }

  addEdge(source, target, relation, meta = {}) {
    // Prevent duplicate edges
    const exists = this.#edges.find(e => 
      e.source === source && 
      e.target === target && 
      e.relation === relation
    );
    
    if (!exists) {
      this.#edges.push({
        source,
        target,
        relation,
        meta,
        createdAt: new Date().toISOString()
      });
      this.#persist();
    }
  }

  getNode(id) {
    return this.#nodes.get(id) ?? null;
  }

  getNeighbors(id) {
    const neighbors = [];
    for (const edge of this.#edges) {
      if (edge.source === id) {
        const node = this.#nodes.get(edge.target);
        if (node) neighbors.push({ node, edge, direction: "out" });
      }
      if (edge.target === id) {
        const node = this.#nodes.get(edge.source);
        if (node) neighbors.push({ node, edge, direction: "in" });
      }
    }
    return neighbors;
  }

  /**
   * Search & Discovery
   */

  search(query) {
    const q = query.toLowerCase();
    const results = [];
    for (const node of this.#nodes.values()) {
      if (
        node.label.toLowerCase().includes(q) || 
        node.id.toLowerCase().includes(q) ||
        (node.type && node.type.toLowerCase().includes(q))
      ) {
        results.push(node);
      }
    }
    return results;
  }

  /**
   * Legacy Reconciliation & Consolidation
   * Merges old split JSON files into the unified graph.
   */

  reconcile() {
    // 1. Process legacy architecture.json
    const arch = this.#readLegacyFile("architecture.json");
    if (arch?.nodes) {
      arch.nodes.forEach(n => this.addNode(n.id, n.label, n.type || "subsystem", n.meta));
    }

    // 2. Process legacy dependencies.json
    const deps = this.#readLegacyFile("dependencies.json");
    if (deps?.dependencies) {
      for (const [source, targets] of Object.entries(deps.dependencies)) {
        targets.forEach(target => this.addEdge(source, target, "dependsOn"));
      }
    }

    // 3. Process legacy ownership.json
    const ownership = this.#readLegacyFile("ownership.json");
    if (ownership?.ownership) {
      for (const [subsystem, owner] of Object.entries(ownership.ownership)) {
        const ownerId = `owner:${owner.toLowerCase().replace(/\s+/g, "-")}`;
        this.addNode(ownerId, owner, "owner");
        this.addEdge(subsystem, ownerId, "ownedBy");
      }
    }

    // 4. Process legacy risk-map.json
    const risks = this.#readLegacyFile("risk-map.json");
    if (risks?.risks) {
      for (const [id, riskLevel] of Object.entries(risks.risks)) {
        const node = this.#nodes.get(id);
        if (node) {
          node.meta = { ...node.meta, riskLevel };
          this.#nodes.set(id, node);
        }
      }
    }

    this.#persist();
  }

  /**
   * Persistence Helpers
   */

  #load() {
    if (fs.existsSync(this.#graphFilePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.#graphFilePath, "utf8"));
        if (data.nodes) {
          data.nodes.forEach(n => this.#nodes.set(n.id, n));
        }
        if (Array.isArray(data.edges)) {
          this.#edges = data.edges;
        }
      } catch (e) {
        console.error(`[graph] Failed to load graph.json: ${e.message}`);
      }
    } else {
      // If graph.json doesn't exist, try to bootstrap from legacy files
      this.reconcile();
    }
  }

  #persist() {
    const data = {
      version: "1.0",
      updatedAt: new Date().toISOString(),
      nodes: Array.from(this.#nodes.values()),
      edges: this.#edges
    };
    fs.writeFileSync(this.#graphFilePath, JSON.stringify(data, null, 2) + "\n");
  }

  #readLegacyFile(filename) {
    const filePath = path.join(this.#graphDir, filename);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      // Delete legacy file after reading to complete migration
      // fs.unlinkSync(filePath); 
      return data;
    } catch {
      return null;
    }
  }

  /**
   * AI-Friendly Text Representation
   * Returns a concise summary of the graph for provider prompts.
   */
  toHumanString() {
    let out = "# Knowledge Graph Summary\n\n";
    
    out += "## Subsystems\n";
    const subsystems = Array.from(this.#nodes.values()).filter(n => n.type === "subsystem");
    subsystems.forEach(s => {
      out += `- **${s.label}** (${s.id})\n`;
      const neighbors = this.getNeighbors(s.id);
      neighbors.forEach(n => {
        if (n.direction === "out") {
          out += `  └─ ${n.edge.relation} → ${n.node.label}\n`;
        }
      });
    });

    return out;
  }

  getGraphData() {
    return {
      nodes: Array.from(this.#nodes.values()),
      edges: this.#edges
    };
  }
}
