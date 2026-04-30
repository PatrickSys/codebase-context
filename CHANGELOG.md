# Changelog

## [2.3.0](https://github.com/PatrickSys/codebase-context/compare/v2.2.0...v2.3.0) (2026-04-30)


### Features

* **02-03:** implement keyword-index symbol reference lookup ([ccfc564](https://github.com/PatrickSys/codebase-context/commit/ccfc5649a3f4e321bbd3770e5945f83213e103a6))
* **02-03:** register get_symbol_references MCP tool ([6f6bc3a](https://github.com/PatrickSys/codebase-context/commit/6f6bc3ae3bfa9af13c404028c1307d774b69291c))
* **03-01:** add frozen controlled eval fixture and local codebase ([46736ed](https://github.com/PatrickSys/codebase-context/commit/46736ed4c4681767164682a774e1ddf08ee81768))
* **03-03:** add multi-codebase eval runner command ([b065042](https://github.com/PatrickSys/codebase-context/commit/b065042f9a689d82485532872009af571d22db44))
* **03-03:** centralize eval harness scoring logic ([5c5319b](https://github.com/PatrickSys/codebase-context/commit/5c5319b4a3c9caf30f7b31de3ee210bc153ee58c))
* **04-01:** add curated grammar manifest, sync script, and publish inclusion ([908f39a](https://github.com/PatrickSys/codebase-context/commit/908f39a2c82a9630150262299ec8ae1f25c269ab))
* **04-01:** update tree-sitter loader to resolve packaged grammars and fail closed ([458520f](https://github.com/PatrickSys/codebase-context/commit/458520ff3d24bd9ff6399b6bedfe1b6776fc6579))
* **04-02:** add manifest-driven grammar CI test with fail-closed fallback ([2559405](https://github.com/PatrickSys/codebase-context/commit/2559405007e17bad6fffcf6ea61b97475f0da1e6))
* **05-01:** create AST-aligned chunking engine with symbol tree builder ([f865abc](https://github.com/PatrickSys/codebase-context/commit/f865abc0a3877441b492695c02ddca12fe9b36c6))
* **05-01:** wire AST-aligned chunker into GenericAnalyzer with 21 unit tests ([68a2d6d](https://github.com/PatrickSys/codebase-context/commit/68a2d6da844a9ffdb6104670c565f338487d2199))
* **05-02:** add scope-aware prefix generation to AST chunks ([3dbd43e](https://github.com/PatrickSys/codebase-context/commit/3dbd43eec1d6cdf63ec4d5094c870bf2ee6b164d))
* **06-01:** add index format metadata and headers ([a216c6d](https://github.com/PatrickSys/codebase-context/commit/a216c6dd2c7614b705525bc30ba8fddf918c7cf3))
* **06-01:** gate index consumers on IndexMeta validation ([6a52c0d](https://github.com/PatrickSys/codebase-context/commit/6a52c0d33d408a7463e036eac8a650c461c86a43))
* **06-02:** implement staging directory build and atomic swap for full rebuild ([d719801](https://github.com/PatrickSys/codebase-context/commit/d71980128795bdf8e7c7ab16beb350729a85e306))
* add HTTP transport mode alongside stdio ([8e97d0f](https://github.com/PatrickSys/codebase-context/commit/8e97d0f115c8b5e0b4f2a7f0f1ddcf2d996fe7a0))
* add HTTP transport mode and server config file support ([3c8c273](https://github.com/PatrickSys/codebase-context/commit/3c8c27357c658b72bcfa1d5dc6044152a5e64e2a))
* add react and nextjs analyzers ([1ac4671](https://github.com/PatrickSys/codebase-context/commit/1ac4671f878c72792539957cc76f5fbc80cc61bb))
* add react and nextjs analyzers ([3da89f9](https://github.com/PatrickSys/codebase-context/commit/3da89f98a6ba3f8f784a9a46b526bdbb14f48331))
* add server config file support for pre-registering projects ([08539c6](https://github.com/PatrickSys/codebase-context/commit/08539c680a9f6f9b5f39f991a85686ad35f2dd7c))
* add workspace-aware multi-project routing ([#67](https://github.com/PatrickSys/codebase-context/issues/67)) ([edb1350](https://github.com/PatrickSys/codebase-context/commit/edb13507369c8d06a579a470665fe4449408d183))
* **AST indexing:** Implement relationship index  ([#38](https://github.com/PatrickSys/codebase-context/issues/38)) ([5b05092](https://github.com/PatrickSys/codebase-context/commit/5b05092b4d5a4a08b117fdc06a3292afdcc8764e))
* Auto-heal for silent semantic search failure ([9fde6c0](https://github.com/PatrickSys/codebase-context/commit/9fde6c0e5df5d3ca602147e00ff5b10262ca6c75))
* CLI formatters + response types + debug gating ([#48](https://github.com/PatrickSys/codebase-context/issues/48)) ([7a6cd7b](https://github.com/PatrickSys/codebase-context/commit/7a6cd7b61e27adb62861d6a264c2ac1feba4d96d))
* **cli:** status formatter + CLI gallery docs ([#56](https://github.com/PatrickSys/codebase-context/issues/56)) ([b7bc5cc](https://github.com/PatrickSys/codebase-context/commit/b7bc5cc078635a5f0a4f33e47d431d21cdb83ccc))
* consolidate launch readiness improvements ([db80888](https://github.com/PatrickSys/codebase-context/commit/db80888098a636652511f2a3d30c70222995beab))
* consolidate launch readiness improvements ([0fb8b3f](https://github.com/PatrickSys/codebase-context/commit/0fb8b3f9167e5341c0033c5a0b7487df54bbd8bc))
* **docs, mcp:** Improve the progress logging and documentation. ([10045bd](https://github.com/PatrickSys/codebase-context/commit/10045bdc93472e615bb47f22c9d32420f06559c4))
* **eval:** add 5-comparator benchmark harness with timing and output flag ([999faf7](https://github.com/PatrickSys/codebase-context/commit/999faf707313ce60d1af16ceead446ad29a95a6f))
* **eval:** add edit-preflight discovery lane ([8a21806](https://github.com/PatrickSys/codebase-context/commit/8a21806502d145e7562fb4833f612f38d80afc9e))
* **eval:** add edit-preflight discovery lane ([a9dc26a](https://github.com/PatrickSys/codebase-context/commit/a9dc26a9cda1cfd4a95b36ff727c113f32d219eb))
* expose all 10 MCP tools via CLI + document them ([#42](https://github.com/PatrickSys/codebase-context/issues/42)) ([7581fba](https://github.com/PatrickSys/codebase-context/commit/7581fbac5b4fd5bc52abc56d946bf55962870566))
* freeze discovery benchmark contract ([66824f9](https://github.com/PatrickSys/codebase-context/commit/66824f9efd433c2858ea00972cd554b74ec9bf3d))
* freeze discovery benchmark contract ([1c78171](https://github.com/PatrickSys/codebase-context/commit/1c7817161f04bfc033e682f289865eb11c5769c8))
* **health:** surface file risk in search ([5e4a00d](https://github.com/PatrickSys/codebase-context/commit/5e4a00d51faa165130e45bb303c8b343461f35b5))
* HTTP transport mode (--http flag) ([c9bf17f](https://github.com/PatrickSys/codebase-context/commit/c9bf17f59cdd07b86d0a047cccb1aec2f735195e))
* **impact:** persist import edge details + 2-hop impact candidates ([f296e30](https://github.com/PatrickSys/codebase-context/commit/f296e30834777770c70f9c20998576e123ea7592))
* **impact:** persist import edge details and 2-hop candidates ([5bd84a1](https://github.com/PatrickSys/codebase-context/commit/5bd84a1c6174c2ae6a413579c471e68ccc30f377))
* implement DISC-01 compact/full search modes and SAFE-01 freshness-aware edit gating ([059aa0c](https://github.com/PatrickSys/codebase-context/commit/059aa0cda1e96363444aff1558bfc84907ef23bd))
* **indexing:** OpenAI embeddings + broader language coverage ([#57](https://github.com/PatrickSys/codebase-context/issues/57)) ([3c1c53b](https://github.com/PatrickSys/codebase-context/commit/3c1c53b15381640e96b2e62794436ca21a545ce4))
* **map:** bound default output and full context ([2e02165](https://github.com/PatrickSys/codebase-context/commit/2e02165b8fc540375f075efdbcf59627e1044b36))
* **map:** bound default output and full context ([fda679b](https://github.com/PatrickSys/codebase-context/commit/fda679beb32c6da663a2ab5a316633d9a2d838e1))
* **map:** promote codebase map as primary first-call surface (Phase 7) ([328d03b](https://github.com/PatrickSys/codebase-context/commit/328d03b23a27e32027dbc64ab52c243dac70b96a))
* **memory:** add scoped memory retrieval ([cbd1fde](https://github.com/PatrickSys/codebase-context/commit/cbd1fdec9d4c848121263659aef0a5966d118d16))
* **memory:** v1.4.0 Memory System  ([#9](https://github.com/PatrickSys/codebase-context/issues/9)) ([3da3439](https://github.com/PatrickSys/codebase-context/commit/3da34392a119b21c286b67d26b25aec72ecdfc49))
* Pattern Momentum - detect migration direction via git history (v1.1.0) ([ced0e18](https://github.com/PatrickSys/codebase-context/commit/ced0e18038e6c692aa42a3943f5320971ab1187e))
* **phase-6:** add codebase-context init wizard ([#90](https://github.com/PatrickSys/codebase-context/issues/90)) ([e52cf0d](https://github.com/PatrickSys/codebase-context/commit/e52cf0db48aeb9e582784d585074b7ace8950731))
* prepare v1.5.0 trust and indexing foundation ([#21](https://github.com/PatrickSys/codebase-context/issues/21)) ([a6b65f1](https://github.com/PatrickSys/codebase-context/commit/a6b65f134c32a35de1e305839ef294be9f97a7d0))
* references confidence, remove get_component_usage, ranked search hints ([#39](https://github.com/PatrickSys/codebase-context/issues/39)) ([33616aa](https://github.com/PatrickSys/codebase-context/commit/33616aa48b165d5cfd95c44bc416cb74c4fd5cbf))
* **refs:** tree-sitter identifier-aware symbol references ([2aa0831](https://github.com/PatrickSys/codebase-context/commit/2aa08315103fa1b87b20d4f212ab271caeee670c))
* **refs:** Tree-sitter identifier-aware symbol references ([c23ffec](https://github.com/PatrickSys/codebase-context/commit/c23ffecf4174a6d683d4b985a754ca2ad840cfe1))
* rework decision-card to make it based on AST parsing ([#41](https://github.com/PatrickSys/codebase-context/issues/41)) ([ac4389d](https://github.com/PatrickSys/codebase-context/commit/ac4389d6cc55b7f8efc310a6e020bcd184a70adc))
* support per-project analyzer hints ([#83](https://github.com/PatrickSys/codebase-context/issues/83)) ([4441b41](https://github.com/PatrickSys/codebase-context/commit/4441b41de8953c830e59c9373555ba94dcb4f339))
* symbol ranking, smart snippets, and edit decision card ([#40](https://github.com/PatrickSys/codebase-context/issues/40)) ([03964b3](https://github.com/PatrickSys/codebase-context/commit/03964b3f40cc0fa0caf9768747a39fb559daaa8e))
* tighten search contract (Phase 8 - DISC-01 + SAFE-01) ([164ff14](https://github.com/PatrickSys/codebase-context/commit/164ff1447bb3bde7815c0490ac6f8507ee478918))
* use tree-sitter symbols in generic analyzer ([b470709](https://github.com/PatrickSys/codebase-context/commit/b470709aa77f02325ed5a4e2b0710017020565da))
* **v1.2.0:** testing patterns detection, golden files extraction, wrapper libraries detection, file watcher for incrementalish indexing ([8f3bf68](https://github.com/PatrickSys/codebase-context/commit/8f3bf6831c6197f168a9744526f6d42f1fc78ccb))
* v1.3.0 foundation (workspace utils, metadata fix, testing) ([#4](https://github.com/PatrickSys/codebase-context/issues/4)) ([fc8eb35](https://github.com/PatrickSys/codebase-context/commit/fc8eb3543854fc57c20f2f8d34948ade5c566c9a))
* v1.6.0 search quality improvements ([#26](https://github.com/PatrickSys/codebase-context/issues/26)) ([8207787](https://github.com/PatrickSys/codebase-context/commit/8207787db45c9ee3940e22cb3fd8bc88a2c6a63b))
* **v2.1:** map structural skeleton + search metadata surface ([#95](https://github.com/PatrickSys/codebase-context/issues/95)) ([8650c0a](https://github.com/PatrickSys/codebase-context/commit/8650c0aa63c6eaf2ea0cc0050caf0642d792823e))
* **watcher:** chokidar auto-refresh with debounced incremental reindex ([59e3686](https://github.com/PatrickSys/codebase-context/commit/59e36867cd4048c858b08d2c551ca94adb6738ac))
* **watcher:** chokidar auto-refresh with debounced incremental reindex ([f300961](https://github.com/PatrickSys/codebase-context/commit/f300961b73b1ee867bfc43f0b2925d3f7c055447))


### Bug Fixes

* **02-01:** fall back when tree-sitter parse has errors ([8a7cd92](https://github.com/PatrickSys/codebase-context/commit/8a7cd92cab25b045b5108b1cba04773f644eab10))
* **02-tree-sitter-02:** prevent symbol-aware chunk merging ([fd02625](https://github.com/PatrickSys/codebase-context/commit/fd0262516e262eff0c17646eaca021d6288c6647))
* **03-02:** add regression guardrails for extraction and large-file safety ([a1c71de](https://github.com/PatrickSys/codebase-context/commit/a1c71de070b434f326dc80e627964c1540eea93f))
* **03-02:** harden tree-sitter extraction against byte-offset and parser failures ([375a48f](https://github.com/PatrickSys/codebase-context/commit/375a48f231c85d72157aa74ea964db27bf9a983e))
* address greptile P2 review comments ([41c252a](https://github.com/PatrickSys/codebase-context/commit/41c252a644baf230ee0d1efb34387fad9d85e8eb))
* align discovery protocol metrics ([21c3e43](https://github.com/PatrickSys/codebase-context/commit/21c3e43323a29aad2894a56933255cb3417d969d))
* **benchmarks:** make all comparator lanes cross-platform on Windows ([#97](https://github.com/PatrickSys/codebase-context/issues/97)) ([#97](https://github.com/PatrickSys/codebase-context/issues/97)) ([6c19628](https://github.com/PatrickSys/codebase-context/commit/6c19628d5d1691c999b07a4532643f0d4ce7016d))
* **ci:** allow manual release publish recovery ([cf31aca](https://github.com/PatrickSys/codebase-context/commit/cf31aca69a575e036e2d73e0e0d4ff1922ab73b1))
* **ci:** build before release tests ([01e8c1b](https://github.com/PatrickSys/codebase-context/commit/01e8c1bb860f908867e142121f5100cfd0d8a72c))
* **ci:** replace retired pnpm audit endpoint ([b8c525d](https://github.com/PatrickSys/codebase-context/commit/b8c525da7b8670ec442e1b43b780ae62168d4fcf))
* **ci:** unblock functional tests ([77ae70b](https://github.com/PatrickSys/codebase-context/commit/77ae70b1fd32858b983b6502a075b263bcedbbdf))
* clean up benchmark MCP sessions ([ad5db8b](https://github.com/PatrickSys/codebase-context/commit/ad5db8b18911814fde8061638ecaf5b2b9ae99c6))
* clean up benchmark MCP sessions ([408c248](https://github.com/PatrickSys/codebase-context/commit/408c248933c08d5c1868522d10d1715fa6091c9d))
* **cli:** formatter audit — render missing metadata fields, README callers qualifier ([d273729](https://github.com/PatrickSys/codebase-context/commit/d273729d16ffff3432b663b76db4964f5dce9822))
* **cli:** lazy-load mcp runtime for direct commands ([f5c3d3b](https://github.com/PatrickSys/codebase-context/commit/f5c3d3b29c6644e12a3a0449b014dee172b50dd5))
* **cli:** lazy-load mcp runtime for direct commands ([c629a11](https://github.com/PatrickSys/codebase-context/commit/c629a114016b2918cd0f7b4ff42e7cd6a50469a3))
* **cli:** remove unused MetadataDependency import ([3f08f0e](https://github.com/PatrickSys/codebase-context/commit/3f08f0ed2ed27c10c2fae3ecf31c81771b22cb88))
* close Phase 8 review follow-ups ([b549be4](https://github.com/PatrickSys/codebase-context/commit/b549be4b6bb470a84c434cf019a64f5efb824db9))
* close v1.8 post-merge integration gaps ([#44](https://github.com/PatrickSys/codebase-context/issues/44)) ([d28460c](https://github.com/PatrickSys/codebase-context/commit/d28460c38bf91e8cb40a76501a03378c2edc11b5))
* **config:** reject empty roots and invalid ports ([912e6f6](https://github.com/PatrickSys/codebase-context/commit/912e6f6af672048f2ac145c7574bac140e503a05))
* **deps:** patch picomatch audit path ([c637bf5](https://github.com/PatrickSys/codebase-context/commit/c637bf58d1614bd7c2e0089e188f5869b17ce1dd))
* **eval:** align ContextBench harness evidence contracts ([4513979](https://github.com/PatrickSys/codebase-context/commit/45139796f4e0cc51854de906b0b40b66beb8b4e3))
* **eval:** deduplicate blocked ContextBench rows ([99c9753](https://github.com/PatrickSys/codebase-context/commit/99c975359ef1af300ae4dbe4f430b734802bcdb9))
* **eval:** deduplicate blocked ContextBench rows ([c41e844](https://github.com/PatrickSys/codebase-context/commit/c41e844b6d85318ff9b30b966a84147430e6c7ad))
* **eval:** harden ContextBench fixture verification ([bed5064](https://github.com/PatrickSys/codebase-context/commit/bed5064c6177f202b24f9564b083bf68068641ba))
* **eval:** harden ContextBench manifest checks ([04a6cfb](https://github.com/PatrickSys/codebase-context/commit/04a6cfbc2a66953420645173df3e6e5d19cd50bf))
* **eval:** preserve ContextBench executor model provenance ([867ac70](https://github.com/PatrickSys/codebase-context/commit/867ac700d98ad141ee180f6353784f9dab1f26fc))
* finalize v2.1.0 token budget advisory ([2df5399](https://github.com/PatrickSys/codebase-context/commit/2df53997dfd43bfa306c99d562a6608afedb5411))
* format discovery benchmark sources ([b4ab479](https://github.com/PatrickSys/codebase-context/commit/b4ab47985f09908ae35ae180834f7c850e05207b))
* **format:** apply prettier formatting to all source files ([049269f](https://github.com/PatrickSys/codebase-context/commit/049269f1afb75df1adcd8948b724272cb74f4976))
* **format:** format ContextBench harness sources ([b2fa208](https://github.com/PatrickSys/codebase-context/commit/b2fa208a4df0579bfdc41d8ffe2a74b2fae6e93e))
* **get-team-patterns:** filter out legacy testing framework categories from patterns ([ed5c858](https://github.com/PatrickSys/codebase-context/commit/ed5c858063493efe328fb2ce03f95404efd34ad4))
* **git:** run tests only on pre-push ([785d28b](https://github.com/PatrickSys/codebase-context/commit/785d28b3adfb4e5bebe946c2af17f958ac0c7022))
* **git:** scope local artifact ignores ([ef42e53](https://github.com/PatrickSys/codebase-context/commit/ef42e53b99f1deed3a7e2107d8124b554b890860))
* **git:** tighten pre-push formatting enforcement ([a6d95fc](https://github.com/PatrickSys/codebase-context/commit/a6d95fc297cd5dcdaba2244b9413cd5353f6f273))
* guard against unhandled rejections and resource leaks in HTTP transport ([e031a56](https://github.com/PatrickSys/codebase-context/commit/e031a56a1fa7a1c18424c5c6d01d2c9cbd03955d))
* guard null chunk.content crash + docs rewrite for v1.6.1 ([6b89778](https://github.com/PatrickSys/codebase-context/commit/6b8977897665ea3207e1bbb0f5d685c61d41bbb8))
* guard startup logs for wide MCP STDIO compatibility ([a72f35b](https://github.com/PatrickSys/codebase-context/commit/a72f35bb480ee86fb9c0498713bf874b0d9574c0))
* harden managed MCP session cleanup ([fcce4b6](https://github.com/PatrickSys/codebase-context/commit/fcce4b6e820e55c085ff933e436c3bc76881ab6b))
* harden search reliability and indexing hygiene ([#22](https://github.com/PatrickSys/codebase-context/issues/22)) ([42a32af](https://github.com/PatrickSys/codebase-context/commit/42a32af626f30dc9c8428419f82a6c03c7312e22))
* **lint:** disable no-explicit-any rule for AST manipulation code ([41547da](https://github.com/PatrickSys/codebase-context/commit/41547da2aa5529dce3d539c296d5e9d79df379fe))
* **lint:** remove useless try/catch in search.ts ([39f777e](https://github.com/PatrickSys/codebase-context/commit/39f777ef85a82fc0cb093dcf1a12f338c985c51e))
* make exclude patterns recursive to prevent index pollution ([#76](https://github.com/PatrickSys/codebase-context/issues/76)) ([a814b24](https://github.com/PatrickSys/codebase-context/commit/a814b2445d3df97ac205073e770399d5caa95214))
* **metadata:** prevent framework misclassification in codebase detection ([#96](https://github.com/PatrickSys/codebase-context/issues/96)) ([ae649dd](https://github.com/PatrickSys/codebase-context/commit/ae649dd803ee1b4146205c1ee4f50c0e7d04ce2a))
* patch vulnerable hono dependencies ([fa79e90](https://github.com/PatrickSys/codebase-context/commit/fa79e90d409a861c1df8fcb759c1f1ee0a91e0b2))
* prevent orphaned processes via stdin/ppid/onclose lifecycle guards ([#77](https://github.com/PatrickSys/codebase-context/issues/77)) ([0b49d7a](https://github.com/PatrickSys/codebase-context/commit/0b49d7a9281b3a215cd920a77613ced1cbc3932d))
* prevent zombie MCP processes via handshake timeout + deferred init ([#89](https://github.com/PatrickSys/codebase-context/issues/89)) ([37fd4b9](https://github.com/PatrickSys/codebase-context/commit/37fd4b98c8bacf8418c97604d932f0149e1e3efc))
* **refs:** prevent out-of-root file reads from index ([1735e3c](https://github.com/PatrickSys/codebase-context/commit/1735e3cb51f808c3bd1c9afed4f1139bad851e8f))
* resolve PR [#98](https://github.com/PatrickSys/codebase-context/issues/98) review blockers ([396dd66](https://github.com/PatrickSys/codebase-context/commit/396dd6687ae3ad33d1d6ca18ef6205ec836b5da4))
* restore npx installs for published package ([107bc14](https://github.com/PatrickSys/codebase-context/commit/107bc14ff3a3b918d39df28703c739b3598b0cd8))
* route MCP requests per project root ([#65](https://github.com/PatrickSys/codebase-context/issues/65)) ([b0c2d04](https://github.com/PatrickSys/codebase-context/commit/b0c2d04bc8a1ce05469697082e1bf5b80207a426))
* satisfy lint in index ([e218859](https://github.com/PatrickSys/codebase-context/commit/e218859875a1a6e27a7f588db4d2c3e022b956d7))
* **search:** durabilize verified search and reranker closure ([0458be8](https://github.com/PatrickSys/codebase-context/commit/0458be8edeedb866f3bd63d6a4d2c62e06493ada))
* **search:** finalize token budget advisory payload ([2d08c89](https://github.com/PatrickSys/codebase-context/commit/2d08c898c89286da4fd6a4c777f588fbb17fbe32))
* **search:** query-aware bestExample, golden file threshold, ONNX thread limits ([9cec82a](https://github.com/PatrickSys/codebase-context/commit/9cec82ab38d63d759648baacba608ca4b578f075))
* **search:** wire SearchResult imports/exports and stabilize map hub selection ([#100](https://github.com/PatrickSys/codebase-context/issues/100)) ([922f9fc](https://github.com/PatrickSys/codebase-context/commit/922f9fc1482f5f35f1e69673fe6cdf8d15f2aee3))
* singleton embedding provider and LanceDB schema validation ([106ee1a](https://github.com/PatrickSys/codebase-context/commit/106ee1aa0f44243a6e3c41c41b171a9827b9eece))
* **test:** harden ContextBench schema cleanup ([c5a74af](https://github.com/PatrickSys/codebase-context/commit/c5a74afb64c65b255a363e31974fa7be6d58242d))
* **test:** isolate ContextBench baseline Git env ([6aed9d1](https://github.com/PatrickSys/codebase-context/commit/6aed9d1a93f540f0d4a17142ab4527769b97cecb))
* **test:** isolate ContextBench git fixtures ([62d3110](https://github.com/PatrickSys/codebase-context/commit/62d3110503b4eca3e4ff65a8403bd0644861d61f))
* **test:** relax slow Windows integration timeouts ([5675ebd](https://github.com/PatrickSys/codebase-context/commit/5675ebdd41f2af784d86c1ec3e25c9e756f80d6b))
* **test:** relax slow Windows search timeouts ([cad646d](https://github.com/PatrickSys/codebase-context/commit/cad646d9d940c00ab96baa0ca806070722cced32))
* **test:** relax zombie guard timeout jitter ([5a5bf68](https://github.com/PatrickSys/codebase-context/commit/5a5bf68302745f90b1dbdfba3ab06cfff961d4d5))
* **test:** tolerate ContextBench runner cleanup races ([c027703](https://github.com/PatrickSys/codebase-context/commit/c027703092a81c90b5c19371873858e5a87ec00c))
* **test:** tolerate ContextBench schema cleanup races ([a155d56](https://github.com/PatrickSys/codebase-context/commit/a155d5646dbb283ffac1e71eef7fb26b8a59fa40))
* **test:** tolerate ContextBench temp cleanup races ([0360cb9](https://github.com/PatrickSys/codebase-context/commit/0360cb97d99337438e1922bf52a76833b9d20fd6))
* **test:** update multi-project routing assertions for new map header ([adfe8d5](https://github.com/PatrickSys/codebase-context/commit/adfe8d521d3dc99468f0f83c4498a73251ca5ecd))
* update prepublishOnly to use pnpm (Greptile audit) ([5197711](https://github.com/PatrickSys/codebase-context/commit/51977119e475f9b376e2c4727b618b765d46e517))
* use cosine distance for vector search scoring ([b41edb7](https://github.com/PatrickSys/codebase-context/commit/b41edb7e4c1969b04d834ec52a9ae43760e796a9))
* **watcher-tests:** await ready + harden Windows cleanup ([#55](https://github.com/PatrickSys/codebase-context/issues/55)) ([9929bb0](https://github.com/PatrickSys/codebase-context/commit/9929bb0cea7d9ad5a41f2719a8b1a48be1dc9909))
* **watcher:** allow debounce 0 and harden test ([070433c](https://github.com/PatrickSys/codebase-context/commit/070433cf79dace7420c26284ceeca7fea41dc8a1))
* **watcher:** queue refresh during indexing ([2d78110](https://github.com/PatrickSys/codebase-context/commit/2d781105f9d56e3b5644abe90ae88978e4d7b0d0))


### Performance Improvements

* **impact:** avoid per-candidate array alloc ([faf6e73](https://github.com/PatrickSys/codebase-context/commit/faf6e73101d1c76f17e755df35d8e34a1783a6fa))
* **impact:** avoid per-candidate array allocation ([04e68eb](https://github.com/PatrickSys/codebase-context/commit/04e68eb3c7d5a2a5aaa45a82ef6823e6f13ce6a9))

## [2.2.0](https://github.com/PatrickSys/codebase-context/compare/v1.10.0...v2.2.0) (2026-04-17)

### Features

* relaunch around a bounded conventions map and local-pattern discovery for `map + find`
* add explicit full-map resources while keeping the default first-call map bounded and action-oriented
* align public proof surfaces to the discovery-only benchmark posture (`pending_evidence`, `claimAllowed: false`)

### Bug Fixes

* make the packaged README tarball-safe by sending benchmark, demo, motivation, and contributing links to stable GitHub URLs
* quarantine historical v1.8.x launch-planning docs so they no longer read as current release guidance
* stop the built CLI entrypoint from eagerly importing MCP server runtime modules before CLI subcommand dispatch

## [1.10.0](https://github.com/PatrickSys/codebase-context/compare/v1.9.0...v1.10.0) (2026-04-14)


### Features

* add HTTP transport mode alongside stdio ([8e97d0f](https://github.com/PatrickSys/codebase-context/commit/8e97d0f115c8b5e0b4f2a7f0f1ddcf2d996fe7a0))
* add HTTP transport mode and server config file support ([3c8c273](https://github.com/PatrickSys/codebase-context/commit/3c8c27357c658b72bcfa1d5dc6044152a5e64e2a))
* add react and nextjs analyzers ([3da89f9](https://github.com/PatrickSys/codebase-context/commit/3da89f98a6ba3f8f784a9a46b526bdbb14f48331))
* add server config file support for pre-registering projects ([08539c6](https://github.com/PatrickSys/codebase-context/commit/08539c680a9f6f9b5f39f991a85686ad35f2dd7c))
* **eval:** add 5-comparator benchmark harness with timing and output flag ([999faf7](https://github.com/PatrickSys/codebase-context/commit/999faf707313ce60d1af16ceead446ad29a95a6f))
* freeze discovery benchmark contract ([1c78171](https://github.com/PatrickSys/codebase-context/commit/1c7817161f04bfc033e682f289865eb11c5769c8))
* implement DISC-01 compact/full search modes and SAFE-01 freshness-aware edit gating ([059aa0c](https://github.com/PatrickSys/codebase-context/commit/059aa0cda1e96363444aff1558bfc84907ef23bd))
* **map:** promote codebase map as primary first-call surface (Phase 7) ([328d03b](https://github.com/PatrickSys/codebase-context/commit/328d03b23a27e32027dbc64ab52c243dac70b96a))
* **phase-6:** add codebase-context init wizard ([#90](https://github.com/PatrickSys/codebase-context/issues/90)) ([e52cf0d](https://github.com/PatrickSys/codebase-context/commit/e52cf0db48aeb9e582784d585074b7ace8950731))
* support per-project analyzer hints ([#83](https://github.com/PatrickSys/codebase-context/issues/83)) ([4441b41](https://github.com/PatrickSys/codebase-context/commit/4441b41de8953c830e59c9373555ba94dcb4f339))
* tighten search contract (Phase 8 - DISC-01 + SAFE-01) ([164ff14](https://github.com/PatrickSys/codebase-context/commit/164ff1447bb3bde7815c0490ac6f8507ee478918))
* surface map structural skeleton and search metadata ([#95](https://github.com/PatrickSys/codebase-context/issues/95)) ([8650c0a](https://github.com/PatrickSys/codebase-context/commit/8650c0aa63c6eaf2ea0cc0050caf0642d792823e))


### Bug Fixes

* address greptile P2 review comments ([41c252a](https://github.com/PatrickSys/codebase-context/commit/41c252a644baf230ee0d1efb34387fad9d85e8eb))
* align discovery protocol metrics ([21c3e43](https://github.com/PatrickSys/codebase-context/commit/21c3e43323a29aad2894a56933255cb3417d969d))
* **benchmarks:** make all comparator lanes cross-platform on Windows ([#97](https://github.com/PatrickSys/codebase-context/issues/97)) ([6c19628](https://github.com/PatrickSys/codebase-context/commit/6c19628d5d1691c999b07a4532643f0d4ce7016d))
* clean up benchmark MCP sessions ([408c248](https://github.com/PatrickSys/codebase-context/commit/408c248933c08d5c1868522d10d1715fa6091c9d))
* close Phase 8 review follow-ups ([b549be4](https://github.com/PatrickSys/codebase-context/commit/b549be4b6bb470a84c434cf019a64f5efb824db9))
* **config:** reject empty roots and invalid ports ([912e6f6](https://github.com/PatrickSys/codebase-context/commit/912e6f6af672048f2ac145c7574bac140e503a05))
* **deps:** patch picomatch audit path ([c637bf5](https://github.com/PatrickSys/codebase-context/commit/c637bf58d1614bd7c2e0089e188f5869b17ce1dd))
* finalize token budget advisory ([2df5399](https://github.com/PatrickSys/codebase-context/commit/2df53997dfd43bfa306c99d562a6608afedb5411))
* format discovery benchmark sources ([b4ab479](https://github.com/PatrickSys/codebase-context/commit/b4ab47985f09908ae35ae180834f7c850e05207b))
* guard against unhandled rejections and resource leaks in HTTP transport ([e031a56](https://github.com/PatrickSys/codebase-context/commit/e031a56a1fa7a1c18424c5c6d01d2c9cbd03955d))
* harden managed MCP session cleanup ([fcce4b6](https://github.com/PatrickSys/codebase-context/commit/fcce4b6e820e55c085ff933e436c3bc76881ab6b))
* **metadata:** prevent framework misclassification in codebase detection ([#96](https://github.com/PatrickSys/codebase-context/issues/96)) ([ae649dd](https://github.com/PatrickSys/codebase-context/commit/ae649dd803ee1b4146205c1ee4f50c0e7d04ce2a))
* patch vulnerable hono dependencies ([fa79e90](https://github.com/PatrickSys/codebase-context/commit/fa79e90d409a861c1df8fcb759c1f1ee0a91e0b2))
* prevent zombie MCP processes via handshake timeout + deferred init ([#89](https://github.com/PatrickSys/codebase-context/issues/89)) ([37fd4b9](https://github.com/PatrickSys/codebase-context/commit/37fd4b98c8bacf8418c97604d932f0149e1e3efc))
* resolve PR [#98](https://github.com/PatrickSys/codebase-context/issues/98) review blockers ([396dd66](https://github.com/PatrickSys/codebase-context/commit/396dd6687ae3ad33d1d6ca18ef6205ec836b5da4))
* satisfy lint in index ([e218859](https://github.com/PatrickSys/codebase-context/commit/e218859875a1a6e27a7f588db4d2c3e022b956d7))
* **search:** finalize token budget advisory payload ([2d08c89](https://github.com/PatrickSys/codebase-context/commit/2d08c898c89286da4fd6a4c777f588fbb17fbe32))
* **search:** query-aware bestExample, golden file threshold, ONNX thread limits ([9cec82a](https://github.com/PatrickSys/codebase-context/commit/9cec82ab38d63d759648baacba608ca4b578f075))
* **search:** wire SearchResult imports/exports and stabilize map hub selection ([#100](https://github.com/PatrickSys/codebase-context/issues/100)) ([922f9fc](https://github.com/PatrickSys/codebase-context/commit/922f9fc1482f5f35f1e69673fe6cdf8d15f2aee3))
* **test:** update multi-project routing assertions for new map header ([adfe8d5](https://github.com/PatrickSys/codebase-context/commit/adfe8d521d3dc99468f0f83c4498a73251ca5ecd))

## [1.9.0](https://github.com/PatrickSys/codebase-context/compare/v1.8.2...v1.9.0) (2026-03-19)


### Features

* add workspace-aware multi-project routing ([#67](https://github.com/PatrickSys/codebase-context/issues/67)) ([edb1350](https://github.com/PatrickSys/codebase-context/commit/edb13507369c8d06a579a470665fe4449408d183))


### Bug Fixes

* make exclude patterns recursive to prevent index pollution ([#76](https://github.com/PatrickSys/codebase-context/issues/76)) ([a814b24](https://github.com/PatrickSys/codebase-context/commit/a814b2445d3df97ac205073e770399d5caa95214))
* prevent orphaned processes via stdin/ppid/onclose lifecycle guards ([#77](https://github.com/PatrickSys/codebase-context/issues/77)) ([0b49d7a](https://github.com/PatrickSys/codebase-context/commit/0b49d7a9281b3a215cd920a77613ced1cbc3932d))
* route MCP requests per project root ([#65](https://github.com/PatrickSys/codebase-context/issues/65)) ([b0c2d04](https://github.com/PatrickSys/codebase-context/commit/b0c2d04bc8a1ce05469697082e1bf5b80207a426))

## [1.8.2](https://github.com/PatrickSys/codebase-context/compare/v1.8.1...v1.8.2) (2026-03-05)

### Bug Fixes

- restore npx installs for published package ([107bc14](https://github.com/PatrickSys/codebase-context/commit/107bc14ff3a3b918d39df28703c739b3598b0cd8))

## [1.8.1](https://github.com/PatrickSys/codebase-context/compare/v1.8.0...v1.8.1) (2026-03-05)

### Bug Fixes

- **get-team-patterns:** filter out legacy testing framework categories from patterns ([ed5c858](https://github.com/PatrickSys/codebase-context/commit/ed5c858063493efe328fb2ce03f95404efd34ad4))
- **git:** run tests only on pre-push ([785d28b](https://github.com/PatrickSys/codebase-context/commit/785d28b3adfb4e5bebe946c2af17f958ac0c7022))
- **git:** tighten pre-push formatting enforcement ([a6d95fc](https://github.com/PatrickSys/codebase-context/commit/a6d95fc297cd5dcdaba2244b9413cd5353f6f273))

## [1.8.0](https://github.com/PatrickSys/codebase-context/compare/v1.7.0...v1.8.0) (2026-03-05)

### Features

- CLI formatters + response types + debug gating ([#48](https://github.com/PatrickSys/codebase-context/issues/48)) ([7a6cd7b](https://github.com/PatrickSys/codebase-context/commit/7a6cd7b61e27adb62861d6a264c2ac1feba4d96d))
- **cli:** status formatter + CLI gallery docs ([#56](https://github.com/PatrickSys/codebase-context/issues/56)) ([b7bc5cc](https://github.com/PatrickSys/codebase-context/commit/b7bc5cc078635a5f0a4f33e47d431d21cdb83ccc))
- **impact:** persist import edge details + 2-hop impact candidates ([f296e30](https://github.com/PatrickSys/codebase-context/commit/f296e30834777770c70f9c20998576e123ea7592))
- **impact:** persist import edge details and 2-hop candidates ([5bd84a1](https://github.com/PatrickSys/codebase-context/commit/5bd84a1c6174c2ae6a413579c471e68ccc30f377))
- **indexing:** OpenAI embeddings + broader language coverage ([#57](https://github.com/PatrickSys/codebase-context/issues/57)) ([3c1c53b](https://github.com/PatrickSys/codebase-context/commit/3c1c53b15381640e96b2e62794436ca21a545ce4))
- **refs:** tree-sitter identifier-aware symbol references ([2aa0831](https://github.com/PatrickSys/codebase-context/commit/2aa08315103fa1b87b20d4f212ab271caeee670c))
- **refs:** Tree-sitter identifier-aware symbol references ([c23ffec](https://github.com/PatrickSys/codebase-context/commit/c23ffecf4174a6d683d4b985a754ca2ad840cfe1))
- **watcher:** chokidar auto-refresh with debounced incremental reindex ([59e3686](https://github.com/PatrickSys/codebase-context/commit/59e36867cd4048c858b08d2c551ca94adb6738ac))
- **watcher:** chokidar auto-refresh with debounced incremental reindex ([f300961](https://github.com/PatrickSys/codebase-context/commit/f300961b73b1ee867bfc43f0b2925d3f7c055447))

### Bug Fixes

- **cli:** formatter audit — render missing metadata fields, README callers qualifier ([d273729](https://github.com/PatrickSys/codebase-context/commit/d273729d16ffff3432b663b76db4964f5dce9822))
- **cli:** remove unused MetadataDependency import ([3f08f0e](https://github.com/PatrickSys/codebase-context/commit/3f08f0ed2ed27c10c2fae3ecf31c81771b22cb88))
- close v1.8 post-merge integration gaps ([#44](https://github.com/PatrickSys/codebase-context/issues/44)) ([d28460c](https://github.com/PatrickSys/codebase-context/commit/d28460c38bf91e8cb40a76501a03378c2edc11b5))
- **refs:** prevent out-of-root file reads from index ([1735e3c](https://github.com/PatrickSys/codebase-context/commit/1735e3cb51f808c3bd1c9afed4f1139bad851e8f))
- **watcher-tests:** await ready + harden Windows cleanup ([#55](https://github.com/PatrickSys/codebase-context/issues/55)) ([9929bb0](https://github.com/PatrickSys/codebase-context/commit/9929bb0cea7d9ad5a41f2719a8b1a48be1dc9909))
- **watcher:** allow debounce 0 and harden test ([070433c](https://github.com/PatrickSys/codebase-context/commit/070433cf79dace7420c26284ceeca7fea41dc8a1))
- **watcher:** queue refresh during indexing ([2d78110](https://github.com/PatrickSys/codebase-context/commit/2d781105f9d56e3b5644abe90ae88978e4d7b0d0))

### Performance Improvements

- **impact:** avoid per-candidate array alloc ([faf6e73](https://github.com/PatrickSys/codebase-context/commit/faf6e73101d1c76f17e755df35d8e34a1783a6fa))
- **impact:** avoid per-candidate array allocation ([04e68eb](https://github.com/PatrickSys/codebase-context/commit/04e68eb3c7d5a2a5aaa45a82ef6823e6f13ce6a9))

## [1.7.0](https://github.com/PatrickSys/codebase-context/compare/v1.6.1...v1.7.0) (2026-02-21)

### Features

- **02-03:** implement keyword-index symbol reference lookup ([ccfc564](https://github.com/PatrickSys/codebase-context/commit/ccfc5649a3f4e321bbd3770e5945f83213e103a6))
- **02-03:** register get_symbol_references MCP tool ([6f6bc3a](https://github.com/PatrickSys/codebase-context/commit/6f6bc3ae3bfa9af13c404028c1307d774b69291c))
- **03-01:** add frozen controlled eval fixture and local codebase ([46736ed](https://github.com/PatrickSys/codebase-context/commit/46736ed4c4681767164682a774e1ddf08ee81768))
- **03-03:** add multi-codebase eval runner command ([b065042](https://github.com/PatrickSys/codebase-context/commit/b065042f9a689d82485532872009af571d22db44))
- **03-03:** centralize eval harness scoring logic ([5c5319b](https://github.com/PatrickSys/codebase-context/commit/5c5319b4a3c9caf30f7b31de3ee210bc153ee58c))
- **04-01:** add curated grammar manifest, sync script, and publish inclusion ([908f39a](https://github.com/PatrickSys/codebase-context/commit/908f39a2c82a9630150262299ec8ae1f25c269ab))
- **04-01:** update tree-sitter loader to resolve packaged grammars and fail closed ([458520f](https://github.com/PatrickSys/codebase-context/commit/458520ff3d24bd9ff6399b6bedfe1b6776fc6579))
- **04-02:** add manifest-driven grammar CI test with fail-closed fallback ([2559405](https://github.com/PatrickSys/codebase-context/commit/2559405007e17bad6fffcf6ea61b97475f0da1e6))
- **05-01:** create AST-aligned chunking engine with symbol tree builder ([f865abc](https://github.com/PatrickSys/codebase-context/commit/f865abc0a3877441b492695c02ddca12fe9b36c6))
- **05-01:** wire AST-aligned chunker into GenericAnalyzer with 21 unit tests ([68a2d6d](https://github.com/PatrickSys/codebase-context/commit/68a2d6da844a9ffdb6104670c565f338487d2199))
- **05-02:** add scope-aware prefix generation to AST chunks ([3dbd43e](https://github.com/PatrickSys/codebase-context/commit/3dbd43eec1d6cdf63ec4d5094c870bf2ee6b164d))
- **06-01:** add index format metadata and headers ([a216c6d](https://github.com/PatrickSys/codebase-context/commit/a216c6dd2c7614b705525bc30ba8fddf918c7cf3))
- **06-01:** gate index consumers on IndexMeta validation ([6a52c0d](https://github.com/PatrickSys/codebase-context/commit/6a52c0d33d408a7463e036eac8a650c461c86a43))
- **06-02:** implement staging directory build and atomic swap for full rebuild ([d719801](https://github.com/PatrickSys/codebase-context/commit/d71980128795bdf8e7c7ab16beb350729a85e306))
- **AST indexing:** Implement relationship index ([#38](https://github.com/PatrickSys/codebase-context/issues/38)) ([5b05092](https://github.com/PatrickSys/codebase-context/commit/5b05092b4d5a4a08b117fdc06a3292afdcc8764e))
- expose all 10 MCP tools via CLI + document them ([#42](https://github.com/PatrickSys/codebase-context/issues/42)) ([7581fba](https://github.com/PatrickSys/codebase-context/commit/7581fbac5b4fd5bc52abc56d946bf55962870566))
- references confidence, remove get_component_usage, ranked search hints ([#39](https://github.com/PatrickSys/codebase-context/issues/39)) ([33616aa](https://github.com/PatrickSys/codebase-context/commit/33616aa48b165d5cfd95c44bc416cb74c4fd5cbf))
- rework decision-card to make it based on AST parsing ([#41](https://github.com/PatrickSys/codebase-context/issues/41)) ([ac4389d](https://github.com/PatrickSys/codebase-context/commit/ac4389d6cc55b7f8efc310a6e020bcd184a70adc))
- symbol ranking, smart snippets, and edit decision card ([#40](https://github.com/PatrickSys/codebase-context/issues/40)) ([03964b3](https://github.com/PatrickSys/codebase-context/commit/03964b3f40cc0fa0caf9768747a39fb559daaa8e))
- use tree-sitter symbols in generic analyzer ([b470709](https://github.com/PatrickSys/codebase-context/commit/b470709aa77f02325ed5a4e2b0710017020565da))

### Bug Fixes

- **02-01:** fall back when tree-sitter parse has errors ([8a7cd92](https://github.com/PatrickSys/codebase-context/commit/8a7cd92cab25b045b5108b1cba04773f644eab10))
- **02-tree-sitter-02:** prevent symbol-aware chunk merging ([fd02625](https://github.com/PatrickSys/codebase-context/commit/fd0262516e262eff0c17646eaca021d6288c6647))
- **03-02:** add regression guardrails for extraction and large-file safety ([a1c71de](https://github.com/PatrickSys/codebase-context/commit/a1c71de070b434f326dc80e627964c1540eea93f))
- **03-02:** harden tree-sitter extraction against byte-offset and parser failures ([375a48f](https://github.com/PatrickSys/codebase-context/commit/375a48f231c85d72157aa74ea964db27bf9a983e))

## [Unreleased]

### Bug Fixes

- restore `npx` / `npm exec` installs by removing the published pnpm-only `preinstall` guard
- harden multi-project MCP routing so configured roots are pre-warmed in the background, `codebase://context` falls back to a workspace overview before selection, and ambiguous sessions now recover through an explicit path-based `project` selector instead of an opaque session ref

### Added

- **Definition-first ranking**: Exact-name searches now show the file that _defines_ a symbol before files that use it. For example, searching `parseConfig` shows the function definition first, then callers.
- **Path-based multi-project routing**: multi-project and monorepo sessions can route explicitly with `project` using an absolute repo path, `file://` URI, or a relative subproject path such as `apps/dashboard`.
- **Project-scoped context resources**: `codebase://context/project/<encoded-project-path>` serves proactive context for a specific configured project and also makes later tool calls deterministic.

### Refactored

- **Eliminated all `any` types**: 68 occurrences across 15 files now use proper TypeScript types. Replaced unsafe `Record<string, any>` with `Record<string, unknown>` and narrowed types using proper type guards. Promoted `@typescript-eslint/no-explicit-any` from `warn` to `error` to enforce strict typing.
- **Consolidated duplicate type definitions**: Single source of truth for shared types:
  - `PatternTrend` canonical location in `types/index.ts` (imported by `usage-tracker.ts`)
  - New `PatternCandidateBase` for shared pattern fields; `PatternCandidate extends PatternCandidateBase`; runtime adds optional internal fields
  - New `UsageLocation` base for both `ImportUsage` and `SymbolUsage` (extends with `preview` field)
  - `GoldenFile extends IntelligenceGoldenFile` to eliminate field duplication (`file`, `score`)
  - Introduced `RuntimePatternPrimary` and `DecisionCard` types for tool-specific outputs
- **Scope headers in code snippets**: When requesting snippets (`includeSnippets: true`), each code block now starts with a comment like `// UserService.login()` so agents know where the code lives without extra file reads.
- **Edit decision card**: When searching with `intent="edit"`, `intent="refactor"`, or `intent="migrate"`, results now include a decision card telling you whether there's enough evidence to proceed safely. The card shows: whether you're ready (`ready: true/false`), what to do next if not (`nextAction`), relevant team patterns to follow, a top example file, how many callers appear in results (`impact.coverage`), and what searches would help close gaps (`whatWouldHelp`).
- **Caller coverage tracking**: The decision card shows how many of a symbol's callers are in your search results. Low coverage (less than 40% when there are lots of callers) triggers an alert so you know to search more before editing.
- **Index versioning**: Index artifacts are versioned via `index-meta.json`. Mixed-version indexes are never served; version mismatches or corruption trigger automatic rebuild.
- **Crash-safe rebuilds**: Full rebuilds write to `.staging/` and swap atomically only on success. Failed rebuilds don't corrupt the active index.
- **Relationship sidecar**: New `relationships.json` artifact containing file import graph, reverse imports, and symbol export index. Updated incrementally alongside the main index.
- **References confidence + hints**: `get_symbol_references` now includes `confidence: "syntactic"` and `isComplete: boolean` to help agents assess result completeness. `search_codebase` results now include a structured `hints` object (capped callers/consumers/tests ranked by frequency) drawn from the relationships sidecar. **`get_component_usage` removed from MCP surface (11→10 tools).** If you previously used `get_component_usage`, use `get_symbol_references` for symbol usage evidence (usageCount, top snippets, callers/consumers).
- Tree-sitter-backed symbol extraction is now used by the Generic analyzer when available (with safe fallbacks).
- Expanded language/extension detection to improve indexing coverage (e.g. `.pyi`, `.php`, `.kt`/`.kts`, `.cc`/`.cxx`, `.cs`, `.swift`, `.scala`, `.toml`, `.xml`).
- New tool: `get_symbol_references` for concrete symbol usage evidence (usageCount + top snippets).
- Multi-codebase eval runner: `npm run eval -- <codebaseA> <codebaseB>` with per-codebase reports and combined summary.
- Shared eval scoring/reporting module (`src/eval/*`) used by both the CLI runner and the test suite.
- Second frozen eval fixture plus an in-repo controlled TypeScript codebase for fully-offline eval runs.
- Regression tests covering Tree-sitter Unicode slicing, parser cleanup/reset behavior, and large/generated file skipping.
- **Tree-sitter symbol references** (PR #49): identifier scan excludes comment/string nodes; `confidence: "syntactic"` returned; `usageCount` reflects real AST occurrences, not regex matches.
- **Import edge details** (PR #50): `importDetails` per edge (line number + imported symbols) persisted in `relationships.json`. Backward-compatible with existing `imports` field.
- **2-hop transitive impact** (PR #50): `search --intent edit` impact now shows direct importers (hop 1) and their importers (hop 2), each labeled with distance. Capped at 20.
- **Chokidar file watcher** (PR #52): index auto-refreshes in MCP server mode on file save (2 s debounce). No manual `reindex` needed during active editing sessions.
- **CLI human formatters** (PR #48): all 9 commands now render as structured human-readable output. `--json` flag on every command for agent/pipe consumption.
- **Multi-project MCP routing**: automatic routing still handles the single-project and already-active-project cases, while ambiguous multi-project sessions now require an explicit path-based `project` selector instead of forcing a selector-first flow.
- **`status` + `reindex` formatters** (PR #56): status box with index health, progress, and last-built time. ASCII fallback via `CODEBASE_CONTEXT_ASCII=1`.
- **`docs/cli.md` gallery** (PR #56): command reference with output previews for all 9 CLI commands.

### Changed

- **Preflight response shape**: Renamed `reason` to `nextAction` for clarity. Removed internal fields (`evidenceLock`, `riskLevel`, `confidence`) so the output is stable and doesn't change shape unexpectedly.

### Fixed

- Null-pointer crash in GenericAnalyzer when chunk content is undefined.
- Tree-sitter symbol extraction now treats node offsets as UTF-8 byte ranges and evicts cached parsers on failures/timeouts.
- **Post-merge integration gaps** (v1.8 audit): Removed orphaned `get_component_usage` source file, deleted phantom allowlist entry, removed dead guidance strings referencing the deleted tool. Added fallback decision card when `intelligence.json` is absent during edit-intent searches, now returns `ready: false` with actionable guidance instead of silently skipping.
- Watcher initialization race: `onReady` hook ensures tests wait for chokidar readiness before asserting (PR #55).
- Windows temp dir cleanup hardened with retry/backoff to fix `ENOTEMPTY`/`EPERM` test flakes (PR #55).
- `--json` output now always pure JSON on stdout; status lines go to stderr (PR #48).

## [1.6.2] - 2026-02-17

Stripped it down for token efficiency, moved CLI code out of the protocol layer, and cleared structural debt.

### Changed

- **Search output**: `trend: "Stable"` is no longer emitted (only Rising/Declining carry signal). Added a compact `type` field (`service:data`) merging componentType and layer into 2 tokens. Removed `lastModified` considered noise.
- **searchQuality**: now includes `hint` (for next-step suggestion) when status is `low_confidence`, so agents get actionable guidance without a second tool call.
- **Tool description**: shortened to 2 actionable sentences, removed reference to `editPreflight` (which didn't exist in output). `intent` parameter is now discoverable on first scan.
- **CLI extraction**: `handleMemoryCli` moved from `src/index.ts` to `src/cli.ts`. Protocol file is routing only.
- **Angular self-registration**: `registerComplementaryPatterns('reactivity', ...)` moved from `src/index.ts` into `AngularAnalyzer` constructor. Framework patterns belong in their analyzer.

### Added

- `AGENTS.md` Lessons Learned section - captures behavioral findings from the 0216 eval: AI fluff loop, self-eval bias, static data as noise, agents don't read past first line.
- Release Checklist in `AGENTS.md`: CHANGELOG + README + capabilities.md + tests before any version bump.

## [1.6.1](https://github.com/PatrickSys/codebase-context/compare/v1.6.0...v1.6.1) (2026-02-15)

Fixed the quality assessment on the search tool bug, stripped search output from 15 fields to 6 reducing token usage by 50%, added CLI memory access, removed Angular patterns from core.

### Bug Fixes

- **Confident Idiot fix**: evidence lock now checks search quality - if retrieval is `low_confidence`, `readyToEdit` is forced `false` regardless of evidence counts.
- **Search output overhaul**: stripped from ~15 fields per result down to 6 (`file`, `summary`, `score`, `trend`, `patternWarning`, `relationships`). Snippets opt-in only.
- **Preflight flattened**: from nested `evidenceLock`/`epistemicStress` to `{ ready, reason }`.
- **Angular framework leakage**: removed hardcoded Angular patterns from `src/core/indexer.ts` and `src/patterns/semantics.ts`. Core is framework-agnostic again.
- **Angular analyzer**: fixed `providedIn: unknown` bug — metadata extraction path was wrong.
- **CLI memory access**: `codebase-context memory list|add|remove` works without any AI agent.
- guard null chunk.content crash ([6b89778](https://github.com/PatrickSys/codebase-context/commit/6b8977897665ea3207e1bbb0f5d685c61d41bbb8))

## [1.6.0](https://github.com/PatrickSys/codebase-context/compare/v1.5.1...v1.6.0) (2026-02-11)

### Features

- v1.6.0 search quality improvements ([#26](https://github.com/PatrickSys/codebase-context/issues/26)) ([8207787](https://github.com/PatrickSys/codebase-context/commit/8207787db45c9ee3940e22cb3fd8bc88a2c6a63b))

## [1.6.0](https://github.com/PatrickSys/codebase-context/compare/v1.5.1...v1.6.0) (2026-02-10)

### Added

- **Search Quality Improvements** — Weighted hybrid search with intent-aware classification
  - Intent-aware query classification (EXACT_NAME, CONCEPTUAL, FLOW, CONFIG, WIRING)
  - Reciprocal Rank Fusion (RRF, k=60) for robust rank-based score combination
  - Hard test-file filtering (eliminates spec contamination in non-test queries)
  - Import-graph proximity reranking (structural centrality boosting)
  - File-level deduplication (one best chunk per file)
- **Evaluation Harness** — Frozen fixture set with reproducible methodology
- **Embedding Upgrade** — Granite model support (47M params, 8192 context)
- **Chunk Optimization** — 100→50 lines, overlap 10→0, merge small chunks

### Changed

- **Dependencies**: `@xenova/transformers` v2 → `@huggingface/transformers` v3
- **Indexing**: Tighter chunks (50 lines) with zero overlap
- **Search**: RRF fusion immune to score distribution differences

### Fixed

- Intent-blind search (conceptual queries now classified and routed correctly)
- Spec file contamination (test files hard-filtered from non-test query results)
- Embedding truncation (granite's 8192 context eliminates previous 512 token limit)

### Note

**Re-indexing recommended** for best results due to chunking changes.
Existing indices remain readable — search still works without re-indexing.
To re-index: `refresh_index(incrementalOnly: false)` or delete `.codebase-context/` folder.

## [1.5.1](https://github.com/PatrickSys/codebase-context/compare/v1.5.0...v1.5.1) (2026-02-08)

### Bug Fixes

- use cosine distance for vector search scoring ([b41edb7](https://github.com/PatrickSys/codebase-context/commit/b41edb7e4c1969b04d834ec52a9ae43760e796a9))

## [1.5.0](https://github.com/PatrickSys/codebase-context/compare/v1.4.1...v1.5.0) (2026-02-08)

### Added

- **Preflight evidence lock**: `search_codebase` edit/refactor/migrate intents now return risk-aware preflight guidance with evidence lock scoring, impact candidates, preferred/avoid patterns, and related memories. ([#21](https://github.com/PatrickSys/codebase-context/issues/21))
- **Trust-aware memory handling**: Git-aware memory pattern support and confidence decay so stale or malformed evidence is surfaced as lower-confidence context instead of trusted guidance. ([#21](https://github.com/PatrickSys/codebase-context/issues/21))

### Changed

- **Search ranking**: Removed framework-specific anchor/query promotion heuristics from core ranking flow to keep retrieval behavior generic across codebases. ([#22](https://github.com/PatrickSys/codebase-context/issues/22))
- **Search transparency**: `search_codebase` now returns `searchQuality` with confidence and diagnostic signals when retrieval looks ambiguous. ([#22](https://github.com/PatrickSys/codebase-context/issues/22))
- **Incremental indexing state**: Persist indexing counters to `indexing-stats.json` and restore them on no-op incremental runs to keep status reporting accurate on large codebases. ([#22](https://github.com/PatrickSys/codebase-context/issues/22))
- **Docs**: Updated README performance section to reflect shipped incremental refresh mode (`incrementalOnly`).

### Fixed

- **No-op incremental stats drift**: Fixed under-reported `indexedFiles` and `totalChunks` after no-change incremental refreshes by preferring persisted stats over capped index snapshots. ([#22](https://github.com/PatrickSys/codebase-context/issues/22))
- **Memory date validation**: Invalid memory timestamps now degrade to stale evidence rather than being surfaced as semi-trusted data. ([#21](https://github.com/PatrickSys/codebase-context/issues/21))

## [1.4.1](https://github.com/PatrickSys/codebase-context/compare/v1.4.0...v1.4.1) (2026-01-29)

### Bug Fixes

- **lint:** disable no-explicit-any rule for AST manipulation code ([41547da](https://github.com/PatrickSys/codebase-context/commit/41547da2aa5529dce3d539c296d5e9d79df379fe))

## [1.4.0] - 2026-01-28

### Added

- **Memory System**: New `remember` and `get_memory` tools capture team conventions, decisions, and gotchas
  - **Types**: `convention` | `decision` | `gotcha`
  - **Categories**: `tooling`, `architecture`, `testing`, `dependencies`, `conventions`
  - **Storage**: `.codebase-context/memory.json` with content-based hash IDs (commit this)
  - **Safety**: `get_memory` truncates unfiltered results to 20 most recent
- **Integration with `get_team_patterns`**: Appends relevant memories when category overlaps
- **Integration with `search_codebase`**: Surfaces `relatedMemories` via keyword match in search results

### Changed

- **File Structure**: All MCP files now organized in `.codebase-context/` folder for cleaner project root
  - Vector DB: `.codebase-index/` → `.codebase-context/index/`
  - Intelligence: `.codebase-intelligence.json` → `.codebase-context/intelligence.json`
  - Keyword index: `.codebase-index.json` → `.codebase-context/index.json`
  - **Migration**: Automatic on server startup (legacy JSON preserved; vector DB directory moved)

### Fixed

- **Startup safety**: Validates `ROOT_PATH` before running migration to avoid creating directories on typo paths

### Why This Feature

Patterns show "what" (97% use inject) but not "why" (standalone compatibility). AGENTS.md can't capture every hard-won lesson. Decision memory gives AI agents access to the team's battle-tested rationale.

**Design principle**: Tool must be self-evident without AGENTS.md rules. "Is this about HOW (record) vs WHAT (don't record)"

**Inspired by**: v1.1 Pattern Momentum (temporal dimension) + memory systems research (Copilot Memory, Gemini Memory)

## [1.3.3] - 2026-01-18

### Fixed

- **Security**: Resolve `pnpm audit` advisories by updating `hono` to 4.11.4 and removing the vulnerable `diff` transitive dependency (replaced `ts-node` with `tsx` for `pnpm dev`).

### Changed

- **Docs**: Clarify private `internal-docs/` submodule setup, add `npx --yes` tip, document `CODEBASE_ROOT`, and list `get_indexing_status` tool.
- **Submodule**: Disable automatic updates for `internal-docs` (`update = none`).

### Removed

- **Dev**: Remove local-only `test-context.cjs` helper script.

## [1.3.2] - 2026-01-16

### Changed

- **Embeddings**: Batch embedding now uses a single Transformers.js pipeline call per batch for higher throughput.
- **Dependencies**: Bump `@modelcontextprotocol/sdk` to 1.25.2.

## [1.3.1] - 2026-01-05

### Fixed

- **Auto-Heal Semantic Search**: Detects LanceDB schema corruption (missing `vector` column), triggers re-indexing, and retries search instead of silently falling back to keyword-only results.

## [1.3.0] - 2026-01-01

### Added

- **Workspace Detection**: Monorepo support for Nx, Turborepo, Lerna, and pnpm workspaces
  - New utility: `src/utils/workspace-detection.ts`
  - Functions: `scanWorkspacePackageJsons()`, `detectWorkspaceType()`, `aggregateWorkspaceDependencies()`
- **Testing Infrastructure**: Vitest smoke tests for core utilities
  - Tests for workspace detection, analyzer registry, and indexer metadata
  - CI/CD workflow via GitHub Actions
- **Dependency Detection**: Added `@nx/` and `@nrwl/` prefix matching for build tools

### Fixed

- **detectMetadata() bug**: All registered analyzers now contribute to codebase metadata (previously only the first analyzer was called)
  - Added `mergeMetadata()` helper with proper array deduplication and layer merging

### Changed

- Updated roadmap: v1.3 is now "Extensible Architecture Foundation"

### Acknowledgements

Thanks to [@aolin480](https://github.com/aolin480) for accelerating the workspace detection roadmap and identifying the detectMetadata() limitation in their fork.

## 1.2.2 (2025-12-31)

### Fixed

- **Critical Startup Crash**: Fixed immediate "Exit Code 1" silent crash on Windows by handling unhandled rejections during startup
- **MCPJam Compatibility**: Removed `logging` capability (which was unimplemented) to support strict MCP clients like MCPJam
- **Silent Failure**: Added global exception handlers to stderr to prevent silent failures in the future

## 1.2.1 (2025-12-31)

### Fixed

- **MCP Protocol Compatibility**: Fixed stderr output during MCP STDIO handshake for strict clients
  - All startup `console.error` calls now guarded with `CODEBASE_CONTEXT_DEBUG` env var
  - Zero stderr output during JSON-RPC handshake (required by Warp, OpenCode, MCPJam)
  - Debug logs available via `CODEBASE_CONTEXT_DEBUG=1` environment variable
  - Minimal implementation: 2 files changed, 46 insertions, 25 deletions
  - Reported by [@aolin480](https://github.com/aolin480) in [#2](https://github.com/PatrickSys/codebase-context/issues/2)

## 1.2.0 (2025-12-29)

### Features

- **Actionable Guidance**: `get_team_patterns` now returns a `guidance` field with pre-computed decisions:
  - `"USE: inject() – 97% adoption, stable"`
  - `"AVOID: constructor DI – 3%, declining (legacy)"`
- **Pattern-Aware Search**: `search_codebase` results now include:
  - `trend`: `Rising` | `Stable` | `Declining` for each result
  - `patternWarning`: Warning message for results using declining patterns
- **Search Boosting**: Results are re-ranked based on pattern modernity:
  - +15% score boost for Rising patterns
  - -10% score penalty for Declining patterns

### Purpose

This release addresses **Search Contamination** — the proven problem where AI agents copy legacy code from search results. By adding trend awareness and actionable guidance, AI agents can now prioritize modern patterns over legacy code.

## 1.1.0 (2025-12-15)

### Features

- **Pattern Momentum**: Detect migration direction via git history. Each pattern in `get_team_patterns` now includes:
  - `newestFileDate`: ISO timestamp of the most recent file using this pattern
  - `trend`: `Rising` (≤60 days), `Stable`, or `Declining` (≥180 days)
- This solves the "3% Problem" — AI can now distinguish between legacy patterns being phased out vs. new patterns being adopted

### Technical

- New `src/utils/git-dates.ts`: Extracts file commit dates via single `git log` command
- Updated `PatternDetector` to track temporal data per pattern
- Graceful fallback for non-git repositories

## 1.0.1 (2025-12-11)

### Fixed

- Added `typescript` as runtime dependency (required by `@typescript-eslint/typescript-estree`)

## 1.0.0 (2025-12-11)

Initial release.

### Features

- **Semantic search**: Hybrid search combining semantic similarity with keyword matching
- **Pattern detection**: Detects team patterns (DI, signals, standalone) with usage frequencies
- **Golden Files**: Surfaces files that demonstrate all team patterns together
- **Internal library discovery**: Tracks usage counts per library, detects wrappers
- **Testing framework detection**: Detects Jest, Jasmine, Vitest, Cypress, Playwright from actual code
- **Angular analyzer**: Components, services, guards, interceptors, pipes, directives
- **Generic analyzer**: Fallback for non-Angular files (32 file extensions supported)
- **Local embeddings**: Transformers.js + BGE model, no API keys required
- **LanceDB vector storage**: Fast, local vector database

### Architecture

- Framework-agnostic core with pluggable analyzers
- Angular as first specialized analyzer (React/Vue extensible)
- tsconfig paths extraction for internal vs external import detection
