# 见字 · WeChat Editorial Workbench

[中文](./README.md) · [English](./README.en.md)

> **A local-first editorial workbench that takes a WeChat story from signal to publishable output.**

见字 is not another “type a topic and wait for an article” chat box. It is a focused workflow for real content production:

**Discover → investigate → decide → write → review → format → deliver.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?logo=windows&logoColor=white)](./docs/user-guide.md#1-安装与启动)
[![Latest Release](https://img.shields.io/github/v/release/shiker1996/wechat-newsroom-workbench?label=latest%20release)](https://github.com/shiker1996/wechat-newsroom-workbench/releases/latest)

<p align="center">
  <img src="docs/screenshots/ui-demo.gif" alt="见字 workbench: from signals to topics, articles, and deliverables" width="760">
</p>

<p align="center">
  <a href="https://github.com/shiker1996/wechat-newsroom-workbench/releases/latest">Download the Windows app</a> ·
  <a href="https://wechat-newsroom-guide.vercel.app/">Take the online tour</a> ·
  <a href="https://github.com/shiker1996/wechat-newsroom-workbench/issues">Report an issue</a>
</p>

## Who is it for?

- Creators who publish regularly and want more than one-off AI drafts.
- Small editorial teams that need sources, decisions, drafts, and deliverables in one place.
- Writers who want articles, covers, social cards, and formatting in one repeatable flow.

## What can it do?

### Start with signals, not a blank prompt

Connect RSS, RSSHub, Reddit, GitHub, or web sources and bring useful signals into one workspace. Sources can be tested, paused, and tracked.

### Let AI help with judgment while you keep editorial control

Labels, events, fact cards, audience relevance, and candidate topics are kept as separate steps. You can see why a topic was selected, what it is based on, and where to change direction.

### Go from topic to deliverable

Writing, review, SEO, WeChat HTML, covers, charts, and paged social cards live in the same workspace. Outputs, versions, and failed stages remain inspectable.

### Work like a desktop app

The Windows app provides a native window, menus, shortcuts, a first-run guide, and a selectable runtime data directory. Your workspace stays local by default; large external dependencies such as RSSHub are enabled when needed.

## Why not just ChatGPT plus a formatting tool?

ChatGPT and other editors can still be part of the workflow. 见字 provides the missing editorial desk between them:

| Typical workflow | 见字 |
|---|---|
| Copy signals and sources between websites | Keep sources, events, facts, and topics together |
| Rely on chat history to remember decisions | Preserve editorial reasoning by stage |
| Find separate tools for formatting and visuals | Keep HTML, covers, and social cards in one cabinet |
| Start over when something fails | Trace runs, versions, and failure stages |

## Start in five minutes

1. Download the latest Windows installer from [GitHub Releases](https://github.com/shiker1996/wechat-newsroom-workbench/releases/latest).
2. Choose the application directory and runtime data directory.
3. Follow the in-app guide to connect an OpenAI-compatible model.
4. Add one source, test it, and create today’s batch.
5. Move from collection to a first article or social-card deliverable.

Normal users do not need to install Node.js separately. RSSHub, Chrome, and other optional capabilities can be configured when they are actually needed.

> The desktop installer currently targets Windows 10/11 x64. macOS and Linux can run the source workflow experimentally, but desktop installers are not published yet.

## See it before installing

Open the [online tutorial and read-only tour](https://wechat-newsroom-guide.vercel.app/) to see the dashboard, topic pools, article editor, and social-card workspace first.

The tour uses reviewed, de-identified demo data. It does not need a model key and does not connect to your local workspace.

## Local-first, not “completely offline”

Workspace data, articles, images, logs, and run records stay on your machine by default. Data is sent to a configured model, search, collection, image, or CDN service only when the corresponding task needs it.

见字 is designed for a trusted local user, not public multi-user hosting. AI output still needs human review for facts, sources, copyright, and publishing risk.

## Project status

- Windows desktop app: primary release and validation platform.
- Writing, WeChat formatting, covers, and social-card production: actively evolving.
- macOS / Linux: experimental source support; no desktop installers yet.

## For contributors

If you want to run the source workflow or contribute to the project, start with:

- [User guide](./docs/user-guide.md): setup, configuration, collection, writing, social cards, and troubleshooting.
- [Desktop guide](./docs/desktop.md): Electron development, packaging, and release.
- [Documentation index](./docs/README.md): configuration, architecture, plugins, data flow, and security.

Source development requires Node.js 24+. Those commands are kept in the documentation so they do not become a prerequisite for normal users.

## License

MIT. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for third-party materials and licenses.
