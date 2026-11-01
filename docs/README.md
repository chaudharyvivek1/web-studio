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
| [api/README.md](api/README.md) | Index of all 23 endpoints, one document each |

## Reading order

If you are new to the project, read `01` → `02` → `06`, then dip into
`api/` for whichever endpoint you are touching. Read `04` before you deploy
anything publicly. Read `05` if you intend to rewrite rather than maintain.
