# WebStudio documentation

This folder is the specification for WebStudio. The code is the implementation;
these documents are the contract it is expected to keep.

| document | what it covers |
|---|---|
| [01-architecture.md](01-architecture.md) | System layers, the four execution strategies, why the design is shaped this way |
| [02-crawl-lifecycle.md](02-crawl-lifecycle.md) | What happens from "paste a URL" to "download a ZIP", step by step |
| [03-data-model.md](03-data-model.md) | On-disk layout, in-memory job store, SQLite schema, manifest format |
| [04-security.md](04-security.md) | SSRF/DNS guards, path traversal, rate limits, and the known gaps |
| [05-recreation-guide.md](05-recreation-guide.md) | How to rebuild this system from scratch, in dependency order |
| [06-project-structure.md](06-project-structure.md) | Every directory and what belongs in it |
| [07-auth-emulation.md](07-auth-emulation.md) | Cloning the login and sign-up journey so a mirrored app can be entered offline |
| [08-endpoint-discovery.md](08-endpoint-discovery.md) | Finding every endpoint a site uses, including ones the crawler never reached |
| [09-agent-build-guide.md](09-agent-build-guide.md) | **Build guide for an AI agent**: invariants, build order, module contracts, verification |
| [10-troubleshooting.md](10-troubleshooting.md) | Install failures (including the Windows `node-gyp` trap), native modules, preview and crawl problems |
| [11-live-proxy.md](11-live-proxy.md) | Snapshot vs Live: rendering the real site through the proxy, and signing in to it |
| [12-deployment.md](12-deployment.md) | Sizing, persistent storage, required environment, and a deployment smoke test |
| [api/README.md](api/README.md) | Index of all 27 endpoints, one document each |

## Reading order

If you are new to the project, read `01` → `02` → `06`, then dip into
`api/` for whichever endpoint you are touching. Read `04` before you deploy
anything publicly. Read `05` if you intend to rewrite rather than maintain.

**If you are an AI agent asked to build, extend or repair this project, read
[09-agent-build-guide.md](09-agent-build-guide.md) before touching anything.**
It lists the invariants that break the app when violated, the order to build in,
the contract each module must honour, and how to verify work without a browser.
