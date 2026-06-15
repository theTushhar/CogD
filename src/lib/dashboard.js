import http from "node:http";
import fs from "node:fs";
import path from "node:path";

export class DashboardServer {
  constructor(paths, runtime) {
    this.paths = paths;
    this.runtime = runtime;
    this.server = null;
    this.port = 3737;
  }

  start() {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      
      // Serve API endpoints
      if (url.pathname.startsWith("/api/")) {
        res.setHeader("Content-Type", "application/json");
        try {
          const data = this.handleApiRequest(url.pathname);
          res.writeHead(200);
          res.end(JSON.stringify(data));
        } catch (err) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // Serve Task Trigger
      if (req.method === "POST" && url.pathname === "/trigger-task") {
        let body = "";
        req.on("data", chunk => body += chunk.toString());
        req.on("end", () => {
          try {
            const { goal } = JSON.parse(body);
            if (!goal) throw new Error("Goal is required");
            
            // Create task in inbox
            const inboxTaskPath = path.join(this.paths.inboxDir, "tasks", `task-${Date.now()}.json`);
            fs.writeFileSync(inboxTaskPath, JSON.stringify({ goal, at: new Date().toISOString() }, null, 2) + "\n");
            
            res.setHeader("Content-Type", "application/json");
            res.writeHead(200);
            res.end(JSON.stringify({ success: true, message: "Task dropped in inbox successfully" }));
          } catch (err) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: err.message }));
          }
        });
        return;
      }

      // Serve Frontend Dashboard HTML
      if (url.pathname === "/" || url.pathname === "/index.html") {
        res.setHeader("Content-Type", "text/html");
        res.writeHead(200);
        res.end(this.getHtmlContent());
        return;
      }

      // Fallback 404
      res.writeHead(404);
      res.end("Not Found");
    });

    this.server.listen(this.port, () => {
      console.log(`[dashboard] Web UI dashboard running at http://localhost:${this.port}`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
    }
  }

  countTasks() {
    const counts = { completed: 0, failed: 0, active: 0, total: 0 };
    const tasks = this.runtime.pipeline.list();
    counts.total = tasks.length;
    for (const t of tasks) {
      if (t.status === "completed") counts.completed++;
      else if (t.status === "failed") counts.failed++;
      else counts.active++;
    }
    return counts;
  }

  handleApiRequest(pathname) {
    switch (pathname) {
      case "/api/status": {
        const counts = this.countTasks();
        const ws = this.runtime.continuity.getWorkState();
        return {
          status: "running",
          project: path.basename(this.paths.rootDir),
          projectPath: this.paths.rootDir,
          branch: ws.branch || "unknown",
          dirty: ws.dirty || false,
          sessions: this.runtime.sessions.listActive(),
          locks: this.runtime.locks.list(),
          taskCounts: counts
        };
      }
      case "/api/tasks": {
        return this.runtime.pipeline.list();
      }
      case "/api/continuity": {
        return {
          workState: this.runtime.continuity.getWorkState(),
          decisions: this.runtime.continuity.getDecisions(15),
          failures: this.runtime.continuity.getFailurePatterns(15),
          quality: this.runtime.continuity.getContinuityQuality()
        };
      }
      case "/api/graph": {
        return this.runtime.graph.getGraphData ? this.runtime.graph.getGraphData() : { nodes: [], edges: [] };
      }
      case "/api/memory": {
        return {
          recent: this.runtime.memory.recentEpisodes(10)
        };
      }
      default:
        throw new Error(`Unknown endpoint: ${pathname}`);
    }
  }

  getHtmlContent() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cog Repository Cognition Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Space+Mono&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0d19;
      --panel: rgba(18, 22, 41, 0.7);
      --border: rgba(255, 255, 255, 0.08);
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.15);
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Outfit', sans-serif;
      background: var(--bg);
      background-image: 
        radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.1) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(217, 70, 239, 0.1) 0px, transparent 50%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }

    header {
      backdrop-filter: blur(12px);
      background: rgba(11, 13, 25, 0.8);
      border-bottom: 1px solid var(--border);
      padding: 1.25rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .logo {
      width: 2.25rem;
      height: 2.25rem;
      background: linear-gradient(135deg, var(--accent), #d946ef);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      color: white;
      box-shadow: 0 0 15px rgba(99, 102, 241, 0.5);
    }

    .brand-title {
      font-size: 1.5rem;
      font-weight: 600;
      letter-spacing: -0.025em;
      background: linear-gradient(135deg, #fff, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .workspace-info {
      display: flex;
      align-items: center;
      gap: 1.5rem;
    }

    .badge {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid var(--border);
      padding: 0.35rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.875rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .badge-glowing::before {
      content: '';
      width: 0.5rem;
      height: 0.5rem;
      background: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--success);
    }

    .container {
      max-width: 1440px;
      margin: 0 auto;
      padding: 2rem;
      width: 100%;
      flex-grow: 1;
    }

    .tabs {
      display: flex;
      gap: 1rem;
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 0.75rem;
    }

    .tab {
      background: none;
      border: none;
      color: var(--text-muted);
      font-family: inherit;
      font-size: 1rem;
      font-weight: 500;
      padding: 0.5rem 1rem;
      cursor: pointer;
      border-radius: 0.5rem;
      transition: all 0.2s ease;
      position: relative;
    }

    .tab:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.02);
    }

    .tab.active {
      color: white;
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid rgba(99, 102, 241, 0.2);
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
    }

    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2.5rem;
    }

    .stat-card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 1rem;
      padding: 1.5rem;
      backdrop-filter: blur(16px);
      box-shadow: var(--shadow);
      transition: transform 0.3s ease, border-color 0.3s ease;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      border-color: rgba(99, 102, 241, 0.3);
    }

    .stat-label {
      font-size: 0.875rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: 700;
    }

    .dashboard-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 2rem;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 1.25rem;
      padding: 1.75rem;
      box-shadow: var(--shadow);
      backdrop-filter: blur(16px);
      margin-bottom: 2rem;
    }

    .panel-title {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* Tasks Kanban styling */
    .kanban-board {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
    }

    .kanban-col {
      background: rgba(255, 255, 255, 0.01);
      border: 1px dashed var(--border);
      border-radius: 0.75rem;
      padding: 1rem;
      min-height: 300px;
    }

    .kanban-col-header {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-bottom: 1rem;
      display: flex;
      justify-content: space-between;
    }

    .task-card {
      background: rgba(18, 22, 41, 0.9);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 0.85rem;
      margin-bottom: 0.75rem;
      cursor: pointer;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      transition: all 0.2s ease;
    }

    .task-card:hover {
      border-color: var(--accent);
      transform: scale(1.02);
    }

    .task-goal {
      font-size: 0.925rem;
      font-weight: 500;
      margin-bottom: 0.5rem;
      line-height: 1.4;
    }

    .task-meta {
      font-size: 0.75rem;
      color: var(--text-muted);
      display: flex;
      justify-content: space-between;
    }

    /* Form styling */
    .trigger-form {
      display: flex;
      gap: 0.75rem;
    }

    .input-text {
      flex-grow: 1;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--border);
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      color: white;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }

    .input-text:focus {
      border-color: var(--accent);
    }

    .btn {
      background: var(--accent);
      color: white;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 0.5rem;
      font-family: inherit;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s, transform 0.2s;
    }

    .btn:hover {
      background: #4f46e5;
      transform: translateY(-1px);
    }

    /* Lists styling */
    .list-item {
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.95rem;
    }

    .list-item:last-child {
      border-bottom: none;
    }

    .mono {
      font-family: 'Space Mono', monospace;
      font-size: 0.85rem;
    }

    .indicator {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      display: inline-block;
    }

    .indicator-active { background: var(--success); box-shadow: 0 0 6px var(--success); }
    .indicator-failed { background: var(--danger); box-shadow: 0 0 6px var(--danger); }

    .empty-state {
      text-align: center;
      color: var(--text-muted);
      padding: 2rem 0;
      font-size: 0.95rem;
    }

    /* Graph Visualizer styling */
    .graph-view {
      display: flex;
      flex-wrap: wrap;
      gap: 1.5rem;
    }

    .graph-node {
      background: rgba(99, 102, 241, 0.05);
      border: 1px solid rgba(99, 102, 241, 0.2);
      border-radius: 0.75rem;
      padding: 1rem 1.25rem;
      width: 250px;
    }

    .node-header {
      font-weight: 600;
      margin-bottom: 0.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      padding-bottom: 0.25rem;
      display: flex;
      justify-content: space-between;
    }

    .node-meta {
      font-size: 0.8rem;
      color: var(--text-muted);
    }
  </style>
</head>
<body>

  <header>
    <div class="brand">
      <div class="logo">C</div>
      <div class="brand-title">Cog Dashboard</div>
    </div>
    <div class="workspace-info">
      <div class="badge badge-glowing" id="daemon-badge">Daemon Running</div>
      <div class="badge" id="project-badge">Project: loading...</div>
      <div class="badge" id="branch-badge">Branch: loading...</div>
    </div>
  </header>

  <div class="container">
    <div class="tabs">
      <button class="tab active" onclick="switchTab('overview')">Overview</button>
      <button class="tab" onclick="switchTab('tasks')">Task Pipeline</button>
      <button class="tab" onclick="switchTab('continuity')">Session Continuity</button>
      <button class="tab" onclick="switchTab('graph')">Knowledge Graph</button>
    </div>

    <!-- OVERVIEW TAB -->
    <div id="overview-tab" class="tab-content active">
      <div class="stats-row">
        <div class="stat-card">
          <div class="stat-label">Active Sessions</div>
          <div class="stat-value" id="stat-sessions">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active Locks</div>
          <div class="stat-value" id="stat-locks">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Completed Tasks</div>
          <div class="stat-value" id="stat-completed" style="color: var(--success);">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Failed Tasks</div>
          <div class="stat-value" id="stat-failed" style="color: var(--danger);">0</div>
        </div>
      </div>

      <div class="dashboard-grid">
        <div class="main-column">
          <div class="panel">
            <div class="panel-title">Trigger New Task</div>
            <form id="task-form" onsubmit="triggerTask(event)" class="trigger-form">
              <input type="text" id="task-goal" class="input-text" placeholder="Type a task/goal for the agents (e.g. 'run tests', 'refactor math module')..." required>
              <button type="submit" class="btn">Deploy Task</button>
            </form>
          </div>

          <div class="panel">
            <div class="panel-title">Active Git Work State</div>
            <div id="workstate-details">
              <div class="empty-state">No active work state details.</div>
            </div>
          </div>
        </div>

        <div class="sidebar">
          <div class="panel">
            <div class="panel-title">Active Provider Sessions</div>
            <div id="active-sessions-list">
              <div class="empty-state">No active agent sessions.</div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-title">Active Resource Locks</div>
            <div id="active-locks-list">
              <div class="empty-state">No active resource locks.</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TASKS TAB -->
    <div id="tasks-tab" class="tab-content">
      <div class="panel">
        <div class="panel-title">Task Pipeline</div>
        <div class="kanban-board">
          <div class="kanban-col">
            <div class="kanban-col-header">Queued <span id="col-count-queued">0</span></div>
            <div id="col-queued"></div>
          </div>
          <div class="kanban-col">
            <div class="kanban-col-header">Executing <span id="col-count-executing">0</span></div>
            <div id="col-executing"></div>
          </div>
          <div class="kanban-col">
            <div class="kanban-col-header">Reviewing <span id="col-count-reviewing">0</span></div>
            <div id="col-reviewing"></div>
          </div>
          <div class="kanban-col">
            <div class="kanban-col-header">Completed/Failed <span id="col-count-done">0</span></div>
            <div id="col-done"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- CONTINUITY TAB -->
    <div id="continuity-tab" class="tab-content">
      <div class="dashboard-grid">
        <div class="main-column">
          <div class="panel">
            <div class="panel-title">Recent Architectural Decisions</div>
            <div id="decisions-list">
              <div class="empty-state">No decisions logged.</div>
            </div>
          </div>
        </div>
        <div class="sidebar">
          <div class="panel">
            <div class="panel-title">Failure Patterns & Fingerprints</div>
            <div id="failures-list">
              <div class="empty-state">No failure patterns logged.</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- GRAPH TAB -->
    <div id="graph-tab" class="tab-content">
      <div class="panel">
        <div class="panel-title">Knowledge Graph Nodes</div>
        <div id="graph-visualizer" class="graph-view">
          <div class="empty-state">No graph nodes found. Run 'cog inspect' to build graph metadata.</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Tab switching
    function switchTab(tabId) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      event.target.classList.add('active');
      document.getElementById(tabId + '-tab').classList.add('active');
    }

    // Task triggering
    async function triggerTask(e) {
      e.preventDefault();
      const goalInput = document.getElementById('task-goal');
      const goal = goalInput.value;
      
      try {
        const res = await fetch('/trigger-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal })
        });
        const data = await res.json();
        if (data.success) {
          alert('Task successfully deployed to inbox!');
          goalInput.value = '';
          fetchStatus();
          fetchTasks();
        } else {
          alert('Failed to trigger task: ' + data.error);
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }

    // Fetch workspace status info
    async function fetchStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        document.getElementById('project-badge').innerText = 'Project: ' + data.project;
        document.getElementById('branch-badge').innerText = 'Branch: ' + data.branch + (data.dirty ? ' *' : '');
        
        document.getElementById('stat-sessions').innerText = data.sessions.length;
        document.getElementById('stat-locks').innerText = data.locks.length;
        document.getElementById('stat-completed').innerText = data.taskCounts.completed;
        document.getElementById('stat-failed').innerText = data.taskCounts.failed;

        // Render sessions list
        const sessionsDiv = document.getElementById('active-sessions-list');
        if (data.sessions.length > 0) {
          sessionsDiv.innerHTML = data.sessions.map(s => \`
            <div class="list-item">
              <div>
                <span class="indicator indicator-active"></span>
                <strong>\${s.provider}</strong> (\${s.mode})
              </div>
              <div class="text-muted mono">\${s.task}</div>
            </div>
          \`).join('');
        } else {
          sessionsDiv.innerHTML = '<div class="empty-state">No active agent sessions.</div>';
        }

        // Render locks list
        const locksDiv = document.getElementById('active-locks-list');
        if (data.locks.length > 0) {
          locksDiv.innerHTML = data.locks.map(l => \`
            <div class="list-item">
              <div><strong>\${l.name}</strong></div>
              <div class="text-muted font-size: 0.8rem">owner: \${l.owner}</div>
            </div>
          \`).join('');
        } else {
          locksDiv.innerHTML = '<div class="empty-state">No active resource locks.</div>';
        }

      } catch (err) {
        console.error('Error fetching status:', err);
      }
    }

    // Fetch tasks list
    async function fetchTasks() {
      try {
        const res = await fetch('/api/tasks');
        const tasks = await res.json();

        const cols = { queued: [], executing: [], reviewing: [], done: [] };
        
        for (const t of tasks) {
          const cardHtml = \`
            <div class="task-card">
              <div class="task-goal">\${t.goal || t.description}</div>
              <div class="task-meta">
                <span class="mono">\${t.id.slice(0, 12)}</span>
                <span>\${t.status}</span>
              </div>
            </div>
          \`;
          
          if (t.status === 'queued' || t.status === 'planned') cols.queued.push(cardHtml);
          else if (t.status === 'executing') cols.executing.push(cardHtml);
          else if (t.status === 'reviewing') cols.reviewing.push(cardHtml);
          else if (t.status === 'completed' || t.status === 'failed') cols.done.push(cardHtml);
        }

        document.getElementById('col-count-queued').innerText = cols.queued.length;
        document.getElementById('col-count-executing').innerText = cols.executing.length;
        document.getElementById('col-count-reviewing').innerText = cols.reviewing.length;
        document.getElementById('col-count-done').innerText = cols.done.length;

        document.getElementById('col-queued').innerHTML = cols.queued.join('') || '<div class="empty-state">Empty</div>';
        document.getElementById('col-executing').innerHTML = cols.executing.join('') || '<div class="empty-state">Empty</div>';
        document.getElementById('col-reviewing').innerHTML = cols.reviewing.join('') || '<div class="empty-state">Empty</div>';
        document.getElementById('col-done').innerHTML = cols.done.join('') || '<div class="empty-state">Empty</div>';

      } catch (err) {
        console.error('Error fetching tasks:', err);
      }
    }

    // Fetch continuity details (decisions/failures)
    async function fetchContinuity() {
      try {
        const res = await fetch('/api/continuity');
        const data = await res.json();

        // Render decisions list
        const decDiv = document.getElementById('decisions-list');
        if (data.decisions.length > 0) {
          decDiv.innerHTML = data.decisions.map(d => \`
            <div class="list-item" style="flex-direction: column; align-items: flex-start; gap: 0.25rem;">
              <div style="font-weight: 600; font-size: 1rem;">\${d.title}</div>
              <div style="color: var(--text-muted);">\${d.decision}</div>
              \${d.context ? \`<div style="font-size: 0.8rem; color: rgba(255,255,255,0.3)">\${d.context}</div>\` : ''}
            </div>
          \`).join('');
        } else {
          decDiv.innerHTML = '<div class="empty-state">No decisions logged.</div>';
        }

        // Render failure patterns
        const failDiv = document.getElementById('failures-list');
        if (data.failures.length > 0) {
          failDiv.innerHTML = data.failures.map(f => \`
            <div class="list-item" style="flex-direction: column; align-items: flex-start; gap: 0.25rem;">
              <div>
                <span class="indicator indicator-failed"></span>
                <strong>[\${f.toolchain}]</strong> \${f.message}
              </div>
              <div class="mono" style="font-size: 0.75rem; color: var(--text-muted)">fingerprint: \${f.fingerprint}</div>
            </div>
          \`).join('');
        } else {
          failDiv.innerHTML = '<div class="empty-state">No failure patterns logged.</div>';
        }

        // Render active work state details
        const ws = data.workState;
        const wsDiv = document.getElementById('workstate-details');
        if (ws && ws.active) {
          wsDiv.innerHTML = \`
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; padding: 0.5rem 0;">
              <div><strong>Goal:</strong> \${ws.goal || '—'}</div>
              <div><strong>Status:</strong> \${ws.status || '—'}</div>
              <div><strong>Next Action:</strong> \${ws.nextAction || '—'}</div>
              <div><strong>Hypothesis:</strong> \${ws.hypothesis || '—'}</div>
              <div><strong>Active Files:</strong> \${ws.activeFiles?.join(', ') || 'none'}</div>
              <div><strong>Git Branch:</strong> \${ws.branch || '—'}</div>
            </div>
          \`;
        } else {
          wsDiv.innerHTML = '<div class="empty-state">No active work state details.</div>';
        }

      } catch (err) {
        console.error('Error fetching continuity:', err);
      }
    }

    // Fetch knowledge graph
    async function fetchGraph() {
      try {
        const res = await fetch('/api/graph');
        const data = await res.json();
        
        const graphDiv = document.getElementById('graph-visualizer');
        if (data.nodes && data.nodes.length > 0) {
          graphDiv.innerHTML = data.nodes.map(n => \`
            <div class="graph-node">
              <div class="node-header">
                <span>\${n.label}</span>
                <span class="mono" style="font-size: 0.7rem; color: var(--accent);">\${n.type}</span>
              </div>
              <div class="node-meta">
                ID: \${n.id}<br>
                Risk: \${n.meta?.riskLevel || 'none'}<br>
                Updated: \${n.updatedAt ? n.updatedAt.slice(11, 19) : '—'}
              </div>
            </div>
          \`).join('');
        } else {
          graphDiv.innerHTML = '<div class="empty-state">No graph nodes found. Run \\'cog inspect\\' to build graph metadata.</div>';
        }
      } catch (err) {
        console.error('Error fetching graph:', err);
      }
    }

    // Auto update loop
    function updateLoop() {
      fetchStatus();
      fetchTasks();
      fetchContinuity();
      fetchGraph();
    }

    updateLoop();
    setInterval(updateLoop, 2000);
  </script>
</body>
</html>`;
  }
}
