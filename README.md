# Cog

A small shared-agent runtime for `.agent/` workspaces.

## What it does

- Initializes a shared `.agent/` workspace in any project
- Generates provider discovery files for provider-specific adapters
- Runs a daemon that manages tasks, memory, context, and workflows
- Supports `opencode`, `claude`, `openclaude`, `gemini`, and `copilot`

## Quick start

```bash
npm install
npm link
cog init
cog init copilot
cogd start
```

> Provider API keys are managed outside this runtime. This project only initializes the workspace and provider files.

## `cog` commands

- `cog init` — create or sync the `.agent/` workspace
- `cog init <provider>` — generate provider instruction file for a supported provider
- `cog remove` — remove the `.agent/` workspace and provider discovery files
- `cog task list [status]` — list recent tasks, optionally filtered by status
- `cog task show <id>` — show a specific task
- `cog status` — show workspace and daemon status
- `cog doctor` — validate the local setup
- `cog events [n]` — show recent events (default 10)
- `cog event emit <type>` — emit a custom event
- `cog memory` — show recent episodic memory
- `cog memory semantic` — show semantic memory topics
- `cog agents` — list registered agents
- `cog providers` — list available providers
- `cog plan` — show the most recent plan
- `cog inspect` — inspect the full `.agent/` workspace
- `cog lock list` — show active locks
- `cog lock claim <name>` — claim a lock
- `cog lock release <name>` — release a lock
- `cog session list` — list active sessions
- `cog review list` — list reviews
- `cog review show <id>` — show review details
- `cog patch list` — list recent patches
- `cog workflow list` — list available workflows
- `cog workflow show <name>` — show workflow details
- `cog resume [task]` — show continuity resume capsule
- `cog finalize [status] [summary]` — save execution summary
- `cog work-state start <goal>` — start a work state
- `cog work-state update <json|text>` — update a work state
- `cog work-state close [status]` — close the active work state
- `cog decision record <title> <decision> [context]` — record a decision
- `cog continuity-view` — generate continuity report and map

## `cogd` commands

- `cogd start` — start the runtime daemon
- `cogd stop` — stop the daemon

## Notes

- `cog init` only initializes the workspace and provider template files.
- Set provider credentials and keys externally; this runtime does not manage them.
- Keep `.agent/` in the project root and do not commit local runtime artifacts.
