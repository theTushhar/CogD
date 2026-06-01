# Cog Repository Cognition Protocol

## Project Profile
- **Project**: {{PROJECT_NAME}}
- **Languages**: {{LANGUAGES}}
- **Runtime**: {{RUNTIME}}

This document defines how autonomous agents (Gemini, Claude, OpenClaude, Opencode, etc.) must interact with this repository to ensure persistent cognition and cross-agent continuity.

## Core Mandate
**Never create isolated memory outside the `.agent/` directory.** All findings, decisions, and state updates must be persisted to the shared brain so other agents can stay in sync.

---

## 1. Pre-Flight Check (Read)
Before performing any action, you MUST synchronize with the current state:
1.  **Work State**: Read `.agent/context/current.md` for active work state and recent decisions.
2.  **Memory**: Search `.agent/memory/semantic/` for topic-classified learnings.
3.  **Architecture**: Review `.agent/context/architecture.md` and the Knowledge Graph summary in `current.md`.
4.  **Locks**: Check `.agent/locks/` to ensure you aren't modifying a subsystem currently held by another agent.
5.  **Continuity**: Use `cog resume` (if available) to load the most recent resume capsule.

---

## 2. In-Flight Protocol (Write)
During execution, maintain the audit trail:
1.  **Register Session**: Create a record in `.agent/sessions/active/` so others know you are working.
2.  **Log Decisions**: Record architectural or strategic choices in `.agent/continuity/decisions/` or via `cog decision record`.
3.  **Emit Events**: For every significant milestone, append an event to `.agent/events/`.
4.  **Check-ins**: Update the "Findings" section of the active task in `.agent/tasks/active/`.

---

## 3. Post-Flight (Handoff)
Before ending your session, ensure the next agent can pick up where you left off:
1.  **Finalize**: Run `cog finalize <status> <summary>` to create a handoff capsule.
2.  **Persist Memory**: Save new insights to `.agent/memory/semantic/` as JSON files.
3.  **Summarize Episodes**: Create a Markdown summary in `.agent/memory/episodic/`.
4.  **Update Current**: Ensure `.agent/context/current.md` reflects the final state of your work.
5.  **Clear Locks**: Release any locks held in `.agent/locks/`.

---

## Shared Brain Structure
- `.agent/context/`: High-level state (Architecture, Conventions, Current Work).
- `.agent/memory/`: Knowledge (Episodic, Semantic, Reflections).
- `.agent/tasks/`: Execution (Active, Completed, Backlog).
- `.agent/graph/`: Relationships (Unified graph.json).
- `.agent/continuity/`: Flow (Decisions, Failures, Handoffs).
