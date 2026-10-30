Agent: cursor-cloud/cbc-integration

| PR | Merge result | Tests after | Conflicts and fixes |
| --- | --- | --- | --- |
| [#154](https://github.com/PatrickSys/codebase-context/pull/154) | fast-forward | pass (131 files, build, `pnpm pack`) | none |
| [#145](https://github.com/PatrickSys/codebase-context/pull/145) | merged | pass | auto-merge `docs/capabilities.md` only |
| [#142](https://github.com/PatrickSys/codebase-context/pull/142) | merged (PR closed, branch merged) | pass | none |
| [#146](https://github.com/PatrickSys/codebase-context/pull/146) | merged | pass | `capabilities.md` (OpenAI + Ollama bullets); `types.ts` (`resolveDefaultApiEndpoint`, dedupe); embedding env + OpenAI tests |
| [#147](https://github.com/PatrickSys/codebase-context/pull/147) | merged | pass | none |
| [#153](https://github.com/PatrickSys/codebase-context/pull/153) | merged | pass | none |
| [#155](https://github.com/PatrickSys/codebase-context/pull/155) | merged | pass | none |
| [#156](https://github.com/PatrickSys/codebase-context/pull/156) | merged | pass | `docs/benchmark.md`: kept front-end matrix (#155) + niche benchmark (#156) |
| [#148](https://github.com/PatrickSys/codebase-context/pull/148) | merged | pass | README/cli/capabilities release copy; **README/CHANGELOG aligned to `docs/benchmark.md` after #156** (see below) |

**Integration checks (final):** `pnpm test` (1348 passed), `pnpm run build`, `pnpm pack --dry-run`, MCP stdio `search_codebase` on `/tmp/vite-react-smoke` (Vite React template).

**#148 follow-up (not applied on #148 branch):** add to README Evidence / Limits and CHANGELOG 2.3.0 Docs bullet:

- README (after 25.7% retrieval sentence): *The reproducible niche prior-art slice (18 tasks, `npm run benchmark:niche`) scored **50.0%** top-3 file hit rate overall but **0/6** top-3 file hits on team-convention lookup (pattern signals matched; ranked paths did not).*
- CHANGELOG Docs bullet append: *…and the separate niche prior-art run (**50.0%** top-3 overall, **0/6** team-convention file hits) per docs/benchmark.md…*
- README Evidence paragraph: note niche table is a **separate frozen family**, not pooled with 25.7%.

**Recommended merge order to master:** #154 → #145 → #142 → #146 → #147 → #153 → #155 → #156 → #148 (with #148 doc patch above).

**Do not merge this PR.** Integration preview only.
