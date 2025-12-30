# MCP Testing Framework

Objective validation of MCP effectiveness across models.

> [!WARNING]
> ## Methodological Limitations
> - **Temperature variance**: Addressed via 3-run protocol (see §2.3)
> - **Single-codebase bias**: Tests limited to SSP_Portal patterns
> - **Directional evidence**: Findings indicate trends, not proof

---

## 1. Test Infrastructure

### 1.1 Folder Structure

```
/tests/
  /TEMPLATE/              # Reusable templates
    TEST_SESSION.md
    TOOL_CALLS.md
  /scripts/               # Automation
    score-component.js
  /SSP_Portal_MMDD/       # Actual test sessions
    TEST_SESSION.md
    TOOL_CALLS.md
    /artifacts/           # Generated code (optional)
  TESTING_FRAMEWORK.md    # This file
  TEST_RESULTS_SUMMARY.md # Aggregated findings
```

### 1.2 Standard Models

To control for model variance, test these models only:

| Model | Environment | Justification |
|-------|-------------|---------------|
| **GPT 5.2 High** | Codex CLI or Cursor | Flagship OpenAI model |
| **Gemini 3 Pro** | Gemini CLI | Google flagship |
| **Claude Haiku 4.5** | Cursor | Anthropic fast model |

**Rationale**: Limit to 3 flagship models to avoid data explosion.

---

## 2. Testing Protocol

### 2.1 Standard Prompt

Use this exact prompt for all tests:

```
Create an Angular component for user settings with these fields:
- Display name (text input with validation)
- Email notifications toggle
- Basic form validation

Requirements:
- Create component with unit tests (cover basic cases)
- Use codebase patterns for DI, state management, and testing
- DO NOT run build/test commands
- DO NOT add routing, navigation, or i18n (component only)
- DO NOT stop until component + tests are complete
```

**Prompt Design**:
- Generic task (avoids bias)
- No framework hints (forces tool usage)
- Clear scope boundaries

### 2.2 Configuration Matrix

Each model needs **2 configurations** × **3 runs** = **6 data points**:

| Config | MCP | AGENTS.md | Purpose |
|--------|-----|-----------|---------|
| **+MCP** | ✅ | ✅ | Full stack (MCP + static) |
| **-MCP** | ❌ | ✅ | Baseline (static only) |

**Run 3 times per config** to measure temperature variance.

### 2.3 Temperature Variance Protocol

**Problem**: Cannot control temperature on most platforms.

**Solution**: Run each config **3 times**, report mean ± standard deviation.

**Example**:
```
GPT 5.2 High +MCP: 5.3 ± 0.5 patterns (n=3)
```

**Interpretation**:
- **Low variance** (SD < 0.5): Stable, reliable
- **High variance** (SD ≥ 1.0): Temperature effects significant

---

## 3. Independent Verification

**Problem**: LLMs evaluating their own code = bias.

**Solution**: Automated scoring via `score-component.js`.

### 3.1 Pattern Scorecard (7 Metrics)

| # | Pattern | Verification Method |
|---|---------|---------------------|
| 1 | `inject()` DI | Search for `inject(` in .ts file |
| 2 | Signals | Search for `signal(`, `computed(`, `effect(` |
| 3 | Standalone | Search for `standalone: true` |
| 4 | Jest | Check file extension `.spec.ts` |
| 5 | `@codeblue/prime` wrappers | Check imports, reject `primeng` direct |
| 6 | OnPush | Search for `ChangeDetectionStrategy.OnPush` |
| 7 | Design tokens | Check for `var(--`, reject hardcoded `#` colors |

### 3.2 Automated Scoring

```bash
node tests/scripts/score-component.js <path-to-component>
# Output: Score: 5/7
```

**Advantages**:
- Objective (no human bias)
- Fast (seconds per component)
- Reproducible (same script, same result)

**Limitations**:
- Cannot assess code quality (only pattern presence)
- May miss edge cases (e.g., inline styles)

### 3.3 Build Verification

Always run build to confirm TypeScript validity:

```bash
cd SSP_Portal
pnpm nx build admin
# Log result: ✅ Pass / ⚠️ Warnings / ❌ Errors
```

---

## 4. Test Session Template

Use `TEMPLATE/TEST_SESSION.md` for all new sessions.

**Key sections**:
1. **Protocol**: Prompt + config
2. **Summary Table**: 3-run aggregated scores
3. **Detailed Results**: Per-run breakdowns
4. **Variance Analysis**: Cross-run comparison
5. **Raw Data**: Links to tool logs, code

**See template for full structure.**

---

## 5. Data Collection Checklist

For each test run:

- [ ] Record exact model name + version
- [ ] Save raw MCP tool call logs to `TOOL_CALLS.md`
- [ ] Run `score-component.js` for pattern score
- [ ] Run `pnpm nx build admin` for build status
- [ ] Count LOC, file count
- [ ] Note any unexpected behavior

---

## 6. Test Results Summary

After completing a session, update `TEST_RESULTS_SUMMARY.md`:

**Add row**:
```markdown
| MMDD | Model | MCP | Score | LOC | Build | Notes |
|------|-------|-----|-------|-----|-------|-------|
| 1230 | Grok  | ✅  | 5.3±0.5 | 204±9 | ✅ | Variance run |
```

**This creates a comparison matrix across all sessions.**

---

## 7. Future Enhancements

**For later consideration** (not now):

- [ ] **AGENTS.md variants**: Test with degraded static docs
- [ ] **Multi-codebase**: Test on non-SSP codebases
- [ ] **API-based testing**: Control temperature=0 via OpenAI API
- [ ] **Cross-model comparison**: Statistical significance tests

---

*Last updated: December 30, 2025*


---

## Test Matrix

### Required Models

| Model | Environment | Tier | Status |
|-------|-------------|------|--------|
| **GPT 5.1-High** | Codex CLI | Flagship | ✅ Tested (1207, 1208) |
| **Gemini 3 Pro** | Gemini CLI | Flagship | ✅ Tested (1207) |
| **Claude Sonnet 4.5** | GitHub Copilot Chat | Flagship | Pending |

### Test Sessions

| Session | Version | Focus | Status |
|---------|---------|-------|--------|
| SSP_Portal_1207 | v1.1 | Pattern conformance, search contamination | ✅ Complete |
| SSP_Portal_1208 | v1.1 | Tool usage patterns, AGENTS.md vs MCP | ✅ Complete |
| SSP_Portal_v1.2 | v1.2 | Anti-pattern guidance, trend awareness | 📋 Planned |

---

## 1. Agent Task Prompt (Standard)

TODO: How to make LLM temperature less of a factor?

Use this prompt for controlled comparison:

```
Create an Angular component for user settings with these fields:
- Display name (text input with validation)
- Email notifications toggle
- Basic form validation

Requirements:
- Create component with unit tests (cover basic cases)
- Use codebase patterns for DI, state management, and testing
- DO NOT run build/test commands
- DO NOT add routing, navigation, or i18n (component only)
- DO NOT stop until component + tests are complete
```

**Configuration Variants**:
- **-MCP**: Disable MCP server, AGENTS.md present (tests static instructions alone)
- **+MCP**: Enable MCP server, AGENTS.md present (tests MCP + static synergy)

### AGENTS.md Quality Variants (v1.2+)

To test MCP value in realistic conditions where static documentation varies:

| Variant ID | MCP | AGENTS.md | Purpose |
|------------|-----|-----------|---------|
| `+MCP+Curated` | ✅ | Full SSP_Portal AGENTS.md | Best-case: MCP with good static instructions |
| `+MCP+Minimal` | ✅ | Minimal (3 lines) | Real-world: MCP must carry the load |
| `-MCP+Minimal` | ❌ | Minimal (3 lines) | Baseline: Model alone with poor instructions |

**Minimal AGENTS.md** (use `TEMPLATE/AGENTS.minimal.md`):
```markdown
# Project Rules
- This is an Angular project
- Use TypeScript
```

**Rationale**: Tests whether MCP can compensate for poor static documentation — the reality for most repos.

---

## 2. Evaluation Metrics

### Baseline Metrics (All Versions)

**What AGENTS.md Already Covers** (not MCP credit):
- DI pattern (`inject()` vs constructor) — AGENTS.md says "use inject()"
- Test framework (Jest) — AGENTS.md says "Jest is the framework"
- Component style (standalone) — AGENTS.md says "standalone components"

**What Only MCP Can Provide** (measure these):

| Metric | Evidence | MCP Tool | Pass Criteria |
|--------|----------|----------|---------------|
| **Hallucination Prevention** | No invented services/APIs | `search_codebase`, `get_component_usage` | Used real exports from `@ssp/*` |
| **Import Discovery** | Real types/utils imported | `search_codebase` | Used actual packages, not redefined |
| **Wrapper Verification** | Correct module imports | `get_codebase_metadata` | Imported `@codeblue/prime/*`, not `primeng` |
| **Pattern Contamination Resistance** | Didn't copy legacy patterns | Metadata vs search results | Used dominant pattern over search examples |
| **Token Efficiency** | Reasonable token usage | N/A | Compare +MCP vs -MCP token counts |

---

### v1.2 Specific Metrics (NEW)

These metrics validate v1.2 features specifically:

| Metric | What to Measure | How to Measure | Pass Criteria |
|--------|-----------------|----------------|---------------|
| **Anti-pattern Avoidance** | Model avoids patterns flagged with `guidance: "AVOID"` | Compare deprecated pattern usage: +MCP v1.2 vs 1207 baseline | Fewer deprecated patterns used |
| **Trend Awareness** | Model cites "Rising" or "Declining" in reasoning | Search model output for trend mentions | Model references trend data |
| **Guidance Compliance** | When `guidance` says "USE X", model uses X | Compare pattern usage to guidance fields | Model follows guidance |
| **Search Contamination v2** | Model avoids copying from `trend: "Declining"` results | Check if copied code comes from declining files | No legacy code copied from flagged results |
| **Tool Eagerness** | MCP tools called without explicit prompting | Count tool calls per session | Similar or higher tool usage vs 1208 |
| **Tool Confusion** | Model misinterprets responses or calls wrong tools | Review tool call logs for errors | No misinterpretation observed |
| **detect_circular_dependencies Usage** | Model calls tool during import creation | Check tool call logs | Tool called at least once (if useful) |

---

## 3. Evaluation Template

Use this template for each test run:

```markdown
## Evaluation: [MODEL_NAME] [±MCP] [VERSION]

**Context**:
- Model: [MODEL_NAME]
- Environment: [ENVIRONMENT]
- MCP Version: [v1.1 | v1.2]
- Configuration: [+MCP | -MCP]
- Time: [X] minutes
- Tokens: Input [X] | Output [X]
- Repo: [REPO_PATH]

---

### Build Verification

- Run: `pnpm nx build admin`
- Result: [✅ Pass | ⚠️ Warnings | ❌ Errors]
- TypeScript errors: [count]

---

### MCP Tool Usage

| Tool | Called? | Query/Notes |
|------|---------|-------------|
| `get_codebase_metadata` | [Yes/No] | |
| `get_team_patterns` | [Yes/No] | Did model cite `guidance` field? |
| `search_codebase` | [Yes/No] | What queries? Did results have `trend` flags? |
| `get_component_usage` | [Yes/No] | |
| `detect_circular_dependencies` | [Yes/No] | Was this useful? |

---

### Baseline Metrics

**1. Hallucination Prevention**
- [ ] Check .ts imports: Did model invent non-existent services?
- Verdict: [PREVENTED | NO EFFECT | NOT APPLICABLE]

**2. Import Discovery**
- [ ] Check for real type imports from `@ssp/*`
- Verdict: [DISCOVERED | REDEFINED | NO IMPORTS NEEDED]

**3. Wrapper Verification**
- [ ] Check .ts imports: `@codeblue/prime/*` not `primeng/*`
- Verdict: [CORRECT WRAPPERS | WRONG IMPORTS | NATIVE HTML]

**4. Pattern Contamination**
- [ ] If search returned legacy examples: Did model copy old patterns?
- Verdict: [RESISTED | CONTAMINATED | NO LEGACY IN SEARCH]

**5. Token Efficiency**
- Compare to -MCP baseline
- Verdict: [EFFICIENT | INEFFICIENT]

---

### v1.2 Specific Metrics

**6. Anti-pattern Avoidance**
- [ ] Did model see `guidance: "AVOID"` warnings?
- [ ] Did model avoid flagged patterns in generated code?
- Count of deprecated patterns used: [X]
- Compare to 1207 baseline: [Better | Same | Worse]
- Verdict: [AVOIDED | IGNORED | NOT APPLICABLE]

**7. Trend Awareness**
- [ ] Did model cite "Rising" or "Declining" in reasoning?
- [ ] Did model prefer Rising patterns when choosing?
- Evidence: [quote from model output]
- Verdict: [AWARE | UNAWARE]

**8. Guidance Compliance**
- [ ] Check patterns used vs `guidance` field recommendations
- Compliance rate: [X/Y patterns correct]
- Verdict: [COMPLIANT | PARTIAL | IGNORED]

**9. Search Contamination v2**
- [ ] Did search results include `trend: "Declining"` items?
- [ ] Did model copy code from declining results?
- Verdict: [RESISTED | CONTAMINATED | NO DECLINING RESULTS]

**10. Tool Eagerness**
- Total MCP tool calls: [X]
- Comparison to 1208 baseline: [Higher | Same | Lower]
- Did model need prompting to use tools? [Yes | No]

**11. detect_circular_dependencies**
- [ ] Was tool called during session?
- [ ] If called, was result useful?
- [ ] Did model act on the result?
- Verdict: [USEFUL | CALLED BUT IGNORED | NOT CALLED]

---

### MCP Value Judgment

Compare to 1207/1208 baseline:

**MCP Impact**: [HIGH | MEDIUM | LOW | NEGATIVE]
- **HIGH**: Clear improvement in contamination resistance + guidance compliance
- **MEDIUM**: Some improvement but baseline also good
- **LOW**: MCP tools called but minimal observable impact
- **NEGATIVE**: v1.2 features confused model or made things worse

**Evidence** (2-3 specific examples):
1. [Example of what v1.2 did or didn't do]
2. [Comparison to 1207/1208 behavior]
3. [Unexpected observation]

---

### Decision Input for v1.3

- Should `detect_circular_dependencies` become `verify_compliance`? [Yes | No | Need more data]
- Is `guidance` field effective? [Yes | Partially | No]
- Is search ranking by trend effective? [Yes | Partially | No]
```

---

## 4. Test Session Checklist

Before running v1.2 test:

- [ ] v1.2 features implemented (`guidance` field, `trend` in search, ranking boost)
- [ ] SSP_Portal codebase reset to clean state
- [ ] AGENTS.md unchanged from 1208 (for fair comparison)
- [ ] MCP server running with v1.2 code
- [ ] Tool call logging enabled
- [ ] Create `internal-docs/tests/SSP_Portal_v1.2/` directory

After test:

- [ ] Save tool call logs to `TOOL_CALLS.md`
- [ ] Complete evaluation template
- [ ] Compare to 1207/1208 baseline metrics
- [ ] Document decision input for v1.3
- [ ] Update TEST_RESULTS_SUMMARY.md

---

## 5. Success Criteria for v1.2

v1.2 is validated if:

1. **Anti-pattern avoidance improves**: Fewer deprecated patterns used compared to 1207
2. **Trend awareness observed**: Model cites trend data at least once
3. **Guidance compliance ≥ 75%**: Model follows `guidance` recommendations
4. **Search contamination reduced**: Model doesn't copy from `trend: "Declining"` results
5. **Clear signal on detect_circular_dependencies**: Either useful (called + acted on) or not useful (never called)

---

*Last updated: December 2025*