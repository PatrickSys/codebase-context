# Client Setup

Full setup instructions for each AI client. This guide is about transport and wiring, not a different product mode: each client gets the same bounded conventions map first and local-pattern discovery second. For the quick-start summary, see [README.md](../README.md).

After client setup, run the CLI once from the project root to prepare the local index, then use `map` and `search` as described in the [CLI gallery](./cli.md). The first index may take a while. This CLI preparation step is separate from client registration and does not establish that an MCP client connected successfully.

## Transport modes

| Mode | How it runs | When to use |
| ---- | ----------- | ------------ |
| **stdio** (default) | Process spawned by the client | One AI client, simple setup |
| **HTTP** | Loopback-only server at `http://127.0.0.1:3100/mcp` | Multiple local clients sharing one server |

Start the HTTP server:

```bash
npx -y codebase-context --http            # default port 3100
npx -y codebase-context --http --port 4000
```

Copy-pasteable templates: [`templates/mcp/stdio/.mcp.json`](../templates/mcp/stdio/.mcp.json) and [`templates/mcp/http/.mcp.json`](../templates/mcp/http/.mcp.json).

## Project routing contract

Automatic multi-project routing is available when the client opens the optional standalone GET/SSE stream and the host announces workspace roots. The HTTP server is loopback-only by default.

A POST-only HTTP client cannot receive `roots/list`, so it must select a project explicitly. If the host does not send roots, or still cannot tell which project is active, use one of these fallbacks:

- start the server with a single bootstrap path
- set `CODEBASE_ROOT`
- retry tool calls with `project` or `project_directory`

If multiple projects are available and no active project can be inferred safely, the server returns `selection_required` instead of guessing.

## Claude Code

```bash
claude mcp add codebase-context -- npx -y codebase-context
```

Claude Code only supports stdio. HTTP is not available for this client.

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context"]
    }
  }
}
```

Claude Desktop only supports stdio.

## Cursor

**Stdio** — add to `.cursor/mcp.json` in your project (copy from [`templates/mcp/stdio/.mcp.json`](../templates/mcp/stdio/.mcp.json)):

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context"]
    }
  }
}
```

**HTTP** — start the server first, then add to `.cursor/mcp.json` (copy from [`templates/mcp/http/.mcp.json`](../templates/mcp/http/.mcp.json)):

```json
{
  "mcpServers": {
    "codebase-context": {
      "type": "http",
      "url": "http://127.0.0.1:3100/mcp"
    }
  }
}
```

## Windsurf

Open Settings > MCP and add (stdio only — HTTP is not documented for Windsurf yet):

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context"]
    }
  }
}
```

## Codex

**Stdio:**

```bash
codex mcp add codebase-context npx -y codebase-context
```

**HTTP** — start the server first (`npx -y codebase-context --http`), then save a config file and pass it:

```json
{
  "mcpServers": {
    "codebase-context": {
      "type": "http",
      "url": "http://127.0.0.1:3100/mcp"
    }
  }
}
```

```bash
codex --mcp-config /path/to/mcp-http.json
```

This HTTP path is local and loopback-only. If the client sends POST requests without a standalone GET/SSE stream, pass `project` or `project_directory` on tool calls; automatic workspace-root routing is not available for that client shape.

## Codex Desktop (source candidate)

The non-interactive Codex Desktop setup flow is currently an unreleased source candidate. npm `latest` is `2.2.0` and does not include `init --client codex --yes`; do not use this command with the published package yet.

From the source checkout, build the candidate, then run its absolute `dist/index.js` path from the project you want to configure:

```powershell
# In the codebase-context source checkout
npm run build

# In the target project, using the built CLI path
node C:\path\to\codebase-context\dist\index.js init --client codex --yes
```

Use `--root C:\path\to\project` when the command is run from elsewhere. The command writes the project-scoped `<project>/.codex/config.toml`, preserves unrelated Codex settings, prepares the index for that root, and does not write `AGENTS.md` or global client configuration. After it reports success, trust the project in Codex Desktop if prompted, restart or reopen Codex, start a new task in that project, and ask a small project question. A written config and ready index do not prove that Codex loaded or queried the server.

Before release, the generated `npx` server command still resolves the published package unless the candidate is installed in the target project's `node_modules`. Our packaged test installs the candidate in a disposable project and checks its file hash. Running the built setup command alone does not prove that Codex will launch that same candidate.

**Historical receipt (2026-09-15):** the packed candidate installed and indexed an isolated Windows project, and a fresh Codex Desktop task then called the actual `search_codebase` MCP tool for that prepared project. The current bounded retry against final archive `codebase-context-2.3.0-final.tgz` (SHA-256 `29CF5C8767900587071DDDCBB6E12EE72D2B58642E136E7BDAF5E61E894ADDAC`) returned `ChartRow` from `src/components/BenchmarkCharts.tsx:6-51` at confidence `0.82`. This proves the prepared local project path only; it does not cover a cold-machine install, the published npm package, or broad Desktop behavior. The initial retry turn exposed no tool and remains recorded separately; the successful retry required no restart, trust, or config edit.

If you stay on the published npm package, keep using the manual project config above and run the separate CLI preparation flow from the project root:

```powershell
npx -y codebase-context reindex
```

The interactive `codebase-context init` command remains available in the CLI help; the non-interactive Codex flags documented here are source-candidate behavior pending release.

## VS Code (Copilot)

Add `.vscode/mcp.json` to your project root. VS Code uses `servers` instead of `mcpServers`:

```json
{
  "servers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context"]
    }
  }
}
```

## OpenCode

Add `opencode.json` to your project root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "codebase-context": {
      "type": "local",
      "command": ["npx", "-y", "codebase-context"],
      "enabled": true
    }
  }
}
```

OpenCode also supports interactive setup via `opencode mcp add`.

## Single-project fallback

If you only use one repo, append a project path:

```bash
codex mcp add codebase-context npx -y codebase-context "/path/to/your/project"
```

Or set an environment variable:

```bash
CODEBASE_ROOT=/path/to/your/project
```

## Test a local build

Build the local branch first:

```bash
pnpm build
```

Then point your MCP client at the local build:

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "node",
      "args": ["<path-to-local-build>/dist/index.js"]
    }
  }
}
```

If the default setup is not enough for your client, pass a project path explicitly:

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "node",
      "args": ["<path-to-local-build>/dist/index.js", "/path/to/your/project"]
    }
  }
}
```

Check these three flows:

1. **Single project** — call `search_codebase` or `metadata`. Routing is automatic.

2. **Multiple projects on a roots-capable host** — open two repos or a monorepo. Call `codebase://context`. Expected: workspace overview, then automatic routing once a project is active.

3. **Ambiguous or no-roots selection** — start without a bootstrap path, call `search_codebase`. Expected: `selection_required`. Retry with `project` set to `apps/dashboard` or `/repos/customer-portal`.

For monorepos, test all three selector forms:

- relative subproject path: `apps/dashboard`
- repo path: `/repos/customer-portal`
- file path: `/repos/monorepo/apps/dashboard/src/auth/guard.ts`
