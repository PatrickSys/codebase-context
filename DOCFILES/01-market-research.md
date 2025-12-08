<!-- INTERNAL DOCUMENT - Market fragmentation analysis -->
<!-- Not for public release. See README.md for external documentation. -->

# Second Research: Challenging the "AGENTS.md as Universal Standard" Narrative

**Date**: December 5, 2025
**Author**: Research conducted via multiple source analysis
**Purpose**: Critical examination of the claim that AGENTS.md has become "the industry standard"

---

## Executive Summary

**My previous conclusion was overstated.** After deeper investigation, the reality is:

> **The AI coding agent context landscape is FRAGMENTED, not standardized.**

Each major player has developed their OWN proprietary format, and AGENTS.md adoption—while growing—is far from universal.

---

## The Reality: Competing Standards (Not a Universal One)

### 1. The Major Players Each Have Their OWN Format

| Tool                      | Primary Format                    | AGENTS.md Support    | Notes                                                                               |
| ------------------------- | --------------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| **GitHub Copilot**        | `.github/copilot-instructions.md` | Yes (as alternative) | Has 3 types: repository-wide, path-specific, and agent instructions                 |
| **Anthropic Claude Code** | `CLAUDE.md`                       | No                   | Uses CLAUDE.md exclusively, hierarchical (root, parent, child directories)          |
| **Cursor**                | `.cursorrules`                    | Limited              | 35.9k stars on awesome-cursorrules, cursor.directory has 65.9k members              |
| **Windsurf**              | `.windsurf/rules/*.md`            | No                   | Uses glob patterns and "activation modes" (Manual, Always On, Model Decision, Glob) |
| **Aider**                 | `CONVENTIONS.md`                  | No                   | Uses `--read` flag for conventions, separate community conventions repo             |
| **OpenAI**                | `AGENTS.md`                       | Yes (author)         | 8.8k stars, but adoption varies                                                     |

### 2. GitHub Copilot's Actual Documentation (Source: docs.github.com)

GitHub Copilot's official documentation reveals they support **three different formats**:

1. **`.github/copilot-instructions.md`** - Their PRIMARY format for repository-wide instructions
2. **`NAME.instructions.md`** in `.github/instructions/` - Path-specific instructions with `applyTo` frontmatter
3. **`AGENTS.md`** - Supported as ALTERNATIVE, with this important caveat:

> "You can create one or more `AGENTS.md` files, stored anywhere within the repository... **Alternatively**, you can use a single `CLAUDE.md` or `GEMINI.md` file stored in the root of the repository."
> — GitHub Copilot Documentation

**Key revelation**: GitHub explicitly supports CLAUDE.md and GEMINI.md as equals to AGENTS.md—they're not converging on a single standard.

### 3. Anthropic's Deliberate Divergence with CLAUDE.md

From Anthropic's official "Claude Code Best Practices" documentation:

> "CLAUDE.md is a special file that Claude automatically pulls into context when starting a conversation."

**CLAUDE.md features NOT in AGENTS.md:**

- Auto-generation via `/init` command
- Hierarchical location support: repo root → parent directories → child directories → home folder (`~/.claude/CLAUDE.md`)
- Tuning recommendations: "run CLAUDE.md files through the prompt improver"
- Team sharing: Press `#` to add instructions that get incorporated automatically

**Anthropic built a completely different system, not an AGENTS.md-compatible one.**

### 4. Cursor's Massive Ecosystem (.cursorrules)

**Hard Numbers:**

- `awesome-cursorrules` repository: **35.9k stars**, 3.1k forks
- cursor.directory community: **65.9k+ members**
- 100+ different `.cursorrules` files for different frameworks

**Cursor's format features:**

- `.cursorrules` file in project root
- Team Commands from Cursor dashboard (centralized, not file-based)
- Custom slash commands in `.cursor/commands/*.md`

**Cursor has NOT adopted AGENTS.md as primary format.** Their massive community has built around `.cursorrules`.

### 5. Windsurf's Completely Different Approach

From Windsurf documentation:

```
Rules Storage Locations:
- .windsurf/rules in your current workspace directory
- .windsurf/rules in any sub-directory of your workspace
- .windsurf/rules in parent directories up to the git root
```

**Unique Windsurf features:**

- **4 Activation Modes**: Manual, Always On, Model Decision, Glob
- **Auto-generated Memories**: "Cascade can automatically generate and store memories"
- **Glob-based targeting**: Similar to GitHub's `applyTo`, but with different syntax

**Windsurf built an entirely separate system with no AGENTS.md support.**

### 6. Aider's Independent Conventions System

Aider uses:

- `CONVENTIONS.md` loaded via `--read` flag or `.aider.conf.yml`
- Community conventions repository: `github.com/Aider-AI/conventions`
- No mention of AGENTS.md support in their documentation

---

## Why AGENTS.md Adoption Claims Are Inflated

### 1. The "20k+ repos" Claim Needs Context

- Total GitHub repositories: **420+ million** (as of 2024)
- AGENTS.md usage: 20,000 repos
- **That's 0.0047%** of all repositories

Compare to:

- `.cursorrules` ecosystem: 35.9k stars just on the awesome-list, suggesting potentially larger actual usage
- GitHub Copilot's own format: Ships with every Copilot Enterprise installation

### 2. Tool-Specific Formats Have Captive Audiences

| Tool           | Monthly Active Users (Estimated) | Default Format                    |
| -------------- | -------------------------------- | --------------------------------- |
| GitHub Copilot | 1.8 million+ paid subscribers    | `.github/copilot-instructions.md` |
| Cursor         | 1M+ users (based on $1B ARR)     | `.cursorrules`                    |
| Claude Code    | Unknown, but 44.7k stars         | `CLAUDE.md`                       |
| Windsurf       | Unknown                          | `.windsurf/rules/`                |

Users of these tools default to the tool's native format, not AGENTS.md.

### 3. Cross-Tool Compatibility Is Limited

A developer using Cursor who creates `.cursorrules` gets:

- Full Cursor support ✓
- GitHub Copilot support: ✗
- Claude Code support: ✗
- Windsurf support: ✗

The same is true for every format. **There IS no universal format that works everywhere.**

---

## The Real Landscape: Fragmentation, Not Standardization

### Current State (December 2025)

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI CODING CONTEXT FORMATS                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   GitHub Copilot ────→ .github/copilot-instructions.md          │
│                        .github/instructions/*.instructions.md   │
│                        (+ supports AGENTS.md, CLAUDE.md,        │
│                         GEMINI.md as alternatives)              │
│                                                                 │
│   Anthropic ─────────→ CLAUDE.md (hierarchical)                 │
│                        ~/.claude/CLAUDE.md (global)             │
│                        .claude/commands/*.md (slash commands)   │
│                                                                 │
│   Cursor ────────────→ .cursorrules                             │
│                        .cursor/commands/*.md                    │
│                        Team Commands (dashboard)                │
│                                                                 │
│   Windsurf ──────────→ .windsurf/rules/*.md                     │
│                        global_rules.md                          │
│                        Auto-generated Memories                  │
│                                                                 │
│   Aider ─────────────→ CONVENTIONS.md                           │
│                        .aider.conf.yml (read: [...])            │
│                                                                 │
│   OpenAI ────────────→ AGENTS.md                                │
│                        (Adopted by: Factory, Warp, RooCode,     │
│                         Amp, UiPath, some others)               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Why No Universal Standard Has Emerged

1. **Business Incentives**: Each vendor benefits from lock-in to their ecosystem
2. **Feature Differentiation**: Unique capabilities (Windsurf memories, CLAUDE.md hierarchy) require proprietary formats
3. **First-Mover Advantage**: Cursor had `.cursorrules` before AGENTS.md existed; massive community inertia
4. **Enterprise Requirements**: GitHub Copilot has enterprise-specific features tied to their format

---

## What This Means for Codebase-Context MCP

### The Opportunity

The fragmentation actually **strengthens** the case for codebase-context MCP:

1. **Format-Agnostic**: MCP works alongside ANY static instruction file—it doesn't compete with AGENTS.md, CLAUDE.md, or .cursorrules

2. **Fills the Real Gap**: Static files (all formats) = developer preferences
   MCP = dynamic codebase intelligence

3. **Works Everywhere**: Since there's no universal format anyway, an MCP that provides runtime context is equally valuable to users of ALL tools

### Positioning Statement (Revised)

> "While the industry remains fragmented on static instruction formats (AGENTS.md, CLAUDE.md, .cursorrules, .windsurf/rules), codebase-context MCP provides **dynamic architectural intelligence** that works alongside ANY of these formats, filling the gap none of them address."

---

## Sources

1. **GitHub Copilot Official Documentation** - https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot

   - Direct quotes on copilot-instructions.md, AGENTS.md, CLAUDE.md, GEMINI.md support

2. **Anthropic Claude Code Best Practices** - https://www.anthropic.com/engineering/claude-code-best-practices

   - CLAUDE.md specification, hierarchical locations, tuning recommendations

3. **Windsurf Documentation** - https://docs.windsurf.com/windsurf/cascade/memories

   - .windsurf/rules format, activation modes, memories system

4. **Awesome Cursorrules Repository** - https://github.com/PatrickJS/awesome-cursorrules

   - 35.9k stars, 68 contributors, extensive .cursorrules ecosystem

5. **Cursor Directory** - https://cursor.directory/

   - 65.9k+ members, community rules repository

6. **Aider Documentation** - https://aider.chat/docs/usage/conventions.html

   - CONVENTIONS.md format, --read flag usage

7. **OpenAI AGENTS.md Repository** - https://github.com/openai/agents.md

   - 8.8k stars, specification details

8. **Claude Code GitHub** - https://github.com/anthropics/claude-code
   - 44.7k stars, 1.2k dependents

---

## Conclusion

**My original claim that AGENTS.md is "becoming THE industry standard" was incorrect.**

The accurate assessment is:

- AGENTS.md is **one of several competing formats**, primarily adopted by smaller tools
- The **largest players** (GitHub Copilot, Anthropic, Cursor, Windsurf) each maintain their OWN formats
- GitHub Copilot explicitly supports CLAUDE.md and GEMINI.md as equals to AGENTS.md
- The Cursor ecosystem around `.cursorrules` is arguably **larger** than AGENTS.md adoption
- There is **no convergence** happening—each vendor continues to develop their proprietary format

This fragmentation is actually **good news for codebase-context MCP**, as it means the solution should be format-agnostic and focus on what none of these static formats provide: **dynamic, runtime codebase intelligence**.
