# Constitution

## Core Principles

- **filesystem-first**: all state lives in `.agent/` as plain text files — markdown, JSON, YAML. No database dependency.
- **provider-agnostic**: any provider (Claude Code, OpenCode, Codex CLI, Gemini, OpenHands) can execute tasks through adapters. No provider lock-in.
- **CLI-native**: the primary interface is the terminal. Shell-native, automation-friendly, composable, SSH/Docker/CI-CD compatible.
- **memory travels with the repo**: `.agent/` is checked into version control. Project cognition is portable.
- **event-driven**: agents communicate through the event bus. No direct coupling between components.
- **self-improving**: reflection agents continuously analyze patterns and generate recommendations.

## Architecture Layers

1. **Runtime Daemon** — persistent background process (`cogd`). Owns the event bus, task pipeline, memory system, and provider routing.
2. **Agent Registry** — autonomous workers triggered by events. Each agent is a narrow specialist.
3. **Provider Adapters** — CLI wrappers that translate universal tasks into provider-native execution.
4. **Task Pipeline** — lifecycle management: created → queued → planned → executing → reviewing → completed/failed.
5. **Memory System** — episodic (full task records) + semantic (topic-classified insights) + reflection (self-improvement).
6. **Inbox System** — `.agent/inbox/` is the universal entry point. CLI, UI, webhooks, GitHub Actions, Slack bots all write here.

## Memory Model

- **Episodic**: what happened. Full task records with goal, provider, result, patches, duration.
- **Semantic**: what was learned. Topic-classified insights extracted from completed tasks.
- **Reflection**: what to improve. Pattern analysis and recommendations for workflow optimization.

## Provider Protocol

Every provider adapter MUST:
1. Accept a universal task object with goal and context
2. Invoke the provider's native CLI with injected context
3. Allow the provider to execute autonomously using its own tools and reasoning
4. Return structured results: status, summary, patches, artifacts
5. Never modify shared memory directly — emit events for the memory agent

## Task Lifecycle

```
created → queued → planned → executing → reviewing → completed
                                                      → failed → queued (retry)
                                                      → failed → escalated (after 3 retries)
```
