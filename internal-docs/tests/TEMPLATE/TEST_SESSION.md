# Test Session: [Repo]_[MMDD]

**Date**: YYYY-MM-DD  
**MCP Version**: vX.Y  
**Focus**: [What this session validates]

---

## 1. Test Configuration

| Variable | Value |
|----------|-------|
| **Agent** | |
| **Model** | |
| **Target Repo** | |

### Run Matrix
| # | Config | MCP | AGENTS.md | Priority |
|---|--------|-----|-----------|----------|
| 1 | -MCP/Min | ❌ | Minimal | **Compulsory** |
| 2 | +MCP/Min | ✅ | Minimal | **Compulsory** |
| 3 | -MCP/Full | ❌ | Full | Optional |
| 4 | +MCP/Full | ✅ | Full | Optional |

---

## 2. Prompts

### Implementing Agent
```text
You are a Senior Angular Developer joining the team.

**Instructions:**
1. **Discovery**: Use MCP tools (`get_codebase_metadata`, `get_team_patterns`, `search_codebase`) to discover patterns.
2. **Implementation**: Create component in [TARGET_PATH].
3. **Standards**: Match existing patterns for DI, Signals, UI Wrappers.

**Feature Request:** [DESCRIPTION]

Requirements:
- Component + unit tests
- DO NOT run build/test commands
- DO NOT stop until complete
```

### Evaluator Agent
```text
Evaluate code against 6 MCP-attributable patterns:
1. inject() - not constructor DI
2. Signals - signal(), computed()
3. Standalone - standalone: true
4. Jest syntax - .spec.ts with Jest
5. @codeblue/prime/* - not primeng direct
6. Design tokens - var(--clr-*) not hardcoded

Report: Score X/6 | Component LOC | Test LOC | Build ✅/❌
```

---

## 3. Results

### Compulsory: -MCP/Min vs +MCP/Min
| Run | Config | Score | Comp LOC | Test LOC | Build |
|-----|--------|-------|----------|----------|-------|
| 1.1 | -MCP/Min | /6 | | | |
| 1.2 | -MCP/Min | /6 | | | |
| 1.3 | -MCP/Min | /6 | | | |
| **Mean** | - | ± | ± | ± | /3 |
| 2.1 | +MCP/Min | /6 | | | |
| 2.2 | +MCP/Min | /6 | | | |
| 2.3 | +MCP/Min | /6 | | | |
| **Mean** | - | ± | ± | ± | /3 |

### Optional: -MCP/Full vs +MCP/Full
| Run | Config | Score | Comp LOC | Test LOC | Build |
|-----|--------|-------|----------|----------|-------|
| 3.x | -MCP/Full | /6 | | | |
| 4.x | +MCP/Full | /6 | | | |

---

## 4. Run Details

### Run X.Y: [Config]
**Duration**: Xm | **Component LOC**: X | **Test LOC**: X

#### Pattern Scorecard
| Pattern | MCP Shows | Used? |
|---------|-----------|-------|
| inject() | 97% | ✅/❌ |
| Signals | 41% rising | ✅/❌ |
| Standalone | 100% | ✅/❌ |
| Jest | Detected | ✅/❌ |
| @codeblue/prime | 847:3 | ✅/❌ |
| Design tokens | Guidance | ✅/❌ |

**Score**: X/6 | **Build**: ✅/❌

---

## 5. Comparison

| Metric | -MCP/Min | +MCP/Min | Delta |
|--------|----------|----------|-------|
| Score | ± | ± | |
| Build | /3 | /3 | |

---

## 6. Artifacts
- [TOOL_CALLS.md](./TOOL_CALLS.md)
- `./artifacts/`
