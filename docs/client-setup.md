# Client Setup

Full setup instructions for each AI client. For the quick-start summary, see [README.md](../README.md).

## Transport modes

| Mode | How it runs | When to use |
| ---- | ----------- | ------------ |
| **stdio** (default) | Process spawned by the client | One AI client, simple setup |
| **HTTP** | Long-lived server at `http://127.0.0.1:3100/mcp` | Multiple clients sharing one server |

Start the HTTP server:

```bash
npx -y codebase-context --http            # default port 3100
npx -y codebase-context --http --port 4000
```

Copy-pasteable templates: [`templates/mcp/stdio/.mcp.json`](../templates/mcp/stdio/.mcp.json) and [`templates/mcp/http/.mcp.json`](../templates/mcp/http/.mcp.json).

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

2. **Multiple projects, one server entry** — open two repos or a monorepo. Call `codebase://context`. Expected: workspace overview, then automatic routing once a project is active.

3. **Ambiguous selection** — start without a bootstrap path, call `search_codebase`. Expected: `selection_required`. Retry with `project` set to `apps/dashboard` or `/repos/customer-portal`.

For monorepos, test all three selector forms:

- relative subproject path: `apps/dashboard`
- repo path: `/repos/customer-portal`
- file path: `/repos/monorepo/apps/dashboard/src/auth/guard.ts`
