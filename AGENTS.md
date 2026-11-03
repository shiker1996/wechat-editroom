# Agent instructions

## Change-time impact analysis

Apply a lightweight impact scan before every project change, including code, UI, configuration, prompts, Skills, tools, packaging, and documentation. Scale the depth to the change: a local visual fix needs a local trace; a behavior or contract change needs a cross-layer trace. Do not force unrelated surfaces into scope.

Before editing, identify the user-visible behavior or defect, find its source of truth, and trace the relevant callers and consumers. Search by route/API, capability, prompt ID, Skill ID, stage ID, configuration key, persisted field, artifact name, and CLI/MCP tool name as applicable; do not infer impact from filenames alone.

Share a compact impact map before implementation. Mark each applicable surface `change`, `no change` with a reason, or `not applicable`:

| Surface | Examples to inspect when relevant |
| --- | --- |
| User entry and presentation | Browser UI, navigation, forms, local client, rendered output |
| Interfaces and integrations | HTTP routes/API docs, MCP schemas/descriptions/handlers, CLI commands, external services |
| Business behavior | Feature application/domain services, pipelines, state transitions, validation and error recovery |
| Agent behavior | Prompts and manifest, Skills/references/manifests, model/tool routing, packaged Codex/WorkBuddy copies |
| Data and operations | SQLite schema/migrations/repositories, config/env examples, jobs, logs, artifacts, backup/restore |
| Project guidance | Architecture, setup/usage docs, examples, install/build/package scripts |
| Verification | Existing tests, snapshots, validators, build checks that encode the affected behavior |

Inspect actual call paths and update all impacted consumers before reporting completion. If a surface is intentionally unchanged, give the concrete reason. When identical guidance is copied into multiple packages, find and synchronize every active copy. Never claim two execution paths share behavior unless their inputs, gates, state updates, and outputs have been checked.

## Workflow contracts

Create or update a current-state workflow contract only when a capability crosses multiple layers or entry points, contains multiple stateful stages/gates, or has materially different internal and external Agent paths. Use `docs/workflows/<capability>.md` and the structure in [docs/workflows/TEMPLATE.md](docs/workflows/TEMPLATE.md). Small single-boundary fixes do not need a new contract.

Keep contracts concise and linked to implementation paths. They describe current behavior, not a proposed design. Update a contract in the same change when stage order, inputs/outputs, state transitions, gates, recovery, or artifact delivery changes. Do not copy full prompts or schemas into contracts; link to their source of truth.

At completion, report the impact map: changed surfaces, unchanged surfaces with reasons, and any remaining divergence between execution paths.
