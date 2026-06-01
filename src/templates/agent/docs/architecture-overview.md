## Architecture

This project uses the Cogd runtime — a persistent autonomous cognition layer.

### Layers

1. **Runtime Daemon** — orchestrates agents, routes tasks, manages memory
2. **Event Bus** — asynchronous agent communication
3. **Task Pipeline** — lifecycle management (created → queued → planned → executing → reviewing → completed)
4. **Provider Adapters** — CLI wrappers that invoke provider-native intelligence
5. **Memory System** — episodic + semantic persistence in .agent/memory/

### Flow

```
User writes goal → Inbox watcher detects → Planner decomposes → Tasks created
→ Provider executes → Memory stores → Reflection improves
```
