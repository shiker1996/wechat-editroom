---
name: jianzi-project-onboarding
description: Install and initialize a local Jianzi Workbench project from Codex, then configure its account profile and collection sources. Use when setting up a fresh checkout or preparing a new local workspace.
---

# Jianzi project onboarding

Use this workflow when the user asks Codex to install or initialize the workbench, set up its account profile, or configure collection sources.

## Install the project

1. Ask for or infer a target directory. Never clone over a non-empty directory. The default source is `https://github.com/shiker1996/wechat-editroom.git`; use the requested branch/ref when provided.
2. Check that Git and the platform shell are available. Clone the repository into the target directory, then run `setup-workbench.cmd` on Windows or `./setup-workbench.sh` on macOS/Linux without `--yes`; these entry points select or bootstrap Node before running setup. Ask whether the user wants RSSHub. If yes, let the first setup pass skip RSSHub, read `RSSHUB_INSTALL_MANIFEST.revision` from `server/platform/integrations/rsshub-installer.mjs`, fetch that exact commit into the configured RSSHub directory (`git init`, add the official remote, fetch the SHA at depth 1, then checkout `FETCH_HEAD`), and rerun setup to install its dependencies. Do not change the generic setup code or replace an existing RSSHub installation.
3. Start the workbench with `start-workbench.cmd` on Windows or `./start-workbench.sh` on macOS/Linux. If the default port is occupied, inspect `config.local.json`, choose an available local port, and keep the service bound to loopback. Do not stop another process to free a port.
4. Run `npm run jianzi -- doctor --json --server http://127.0.0.1:<port>`. Confirm that the service is reachable and report unavailable optional collectors.
5. Run `npm run jianzi -- install --agent codex` in the new project. Continue the initial setup through the project's `jianzi` CLI while Codex has terminal access; the MCP connection becomes available after the new project is trusted and reloaded.

## Configure the account

Interview the user for the public account name, short description, core readers, ongoing content pillars, editorial categories, and any writing boundaries. Reuse their existing `account-context.json` or ask before replacing an existing profile. Do not invent account facts. Prepare a draft and show it for confirmation, then save it with `jianzi_account_profile_update` or `npm run jianzi -- account update --file <json-file> --server http://127.0.0.1:<port>`.

Read the saved profile back and confirm that it is configured. The profile is local project data; do not put API keys or other credentials in it.

## Configure collection sources

1. Read `jianzi_collectors_list`, `jianzi_collection_capabilities`, `jianzi_collection_sources_list`, and `jianzi_collector_configuration_catalog` before recommending sources. During bootstrap, the equivalent commands are `npm run jianzi -- collectors list`, `sources capabilities`, `sources list`, and `collectors config-list`.
2. Ask which source families the user wants (for example direct RSS/Atom, RSSHub routes, Reddit, GitHub, X, or a web page). Explain prerequisite services and credentials before enabling a source.
3. For collector-wide settings, read the collector configuration schema first. Present the fields that need user input, save only after confirmation, and never echo secret values. Use `jianzi_collector_configuration_save` and then `jianzi_collector_configuration_test` where applicable; during bootstrap, use `collectors config-get/config-set/config-test`.
4. For source instances, show the proposed label, collector, route/URL, and enabled state. Create only after user confirmation with `jianzi_collection_source_create`; test it with `jianzi_collection_source_test`. During bootstrap, use `sources add --plugin <id> --file <json-file> --server http://127.0.0.1:<port>` and `sources test --id <id>`. Do not start a batch collection unless the user asks.
5. Read the source list and capabilities again. Report which sources are enabled, which tested successfully, and what remains optional or unavailable.

## Boundaries

- Use the workbench's setup wizard and APIs so the project retains its validation, secret storage, and source normalization.
- Do not write to the workbench database directly, expose credentials in logs or chat, or guess configuration fields that are absent from the schema.
- Keep generated project data, model configuration, and API keys in the selected local project/workbench only.
- The Codex MCP server is project-scoped and connects to loopback; remote Codex sessions cannot operate the user's local workbench.
