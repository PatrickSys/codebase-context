# Client Setup

Full setup instructions for each AI client. This guide is about transport and wiring, not a different product mode: each client gets the same bounded conventions map first and local-pattern discovery second. For the quick-start summary, see [README.md](../README.md).

## Recommended first use

For a released package, use the manual client registration below. To exercise
the setup wizard in this source candidate, build it first:

```bash
pnpm build && node dist/index.js init
```

Choose **stdio** unless you specifically need several clients to share one
server. The wizard puts the current repository's absolute path in the stdio
registration. It registers the Node executable and server entrypoint from the
running installation, not unversioned npm latest. Keep that installation path
available; rerun setup after moving it. That makes project attribution deterministic when a client does
not announce MCP workspace roots. The client owns the stdio process and starts
it when the connection is used.

The setup has five separate steps:

1. **Obtain** the package with `npx -y codebase-context` (or build it locally).
2. **Register** the connection in the client using the command or config below.
3. **Start** the server: stdio is client-owned; HTTP must be started separately.
4. **Select and index** the repository: an MCP map request can start deferred indexing; the CLI `map` command only reads existing artifacts, so use `reindex` when you need to build the index explicitly.
5. **Query and reuse** the connection; stop the HTTP process when you are finished.

Registration alone does not prove that a server is running, and a successful
transport handshake does not prove that the intended repository was indexed.

### Returning to an existing setup

An exact older generated memory-first instruction block can be upgraded after
its replacement preview and your explicit confirmation. Surrounding text stays
intact. Customized or malformed blocks are preserved for manual review; they
are not silently treated as current. Unreadable instruction/config files and
malformed JSON configurations are refused rather than replaced.

The wizard previews shell-quoted commands. Windows previews target PowerShell,
not cmd.exe. Automatic Windows executable/shim resolution still needs validation
in the installed desktop client; Linux argument-array execution does not prove it.

## Transport modes

| Mode                | How it runs                                            | When to use                         |
| ------------------- | ------------------------------------------------------ | ----------------------------------- |
| **stdio** (default) | Process spawned by the client with one repository path | One client, deterministic first use |
| **HTTP**            | Long-lived server at `http://127.0.0.1:3100/mcp`       | Multiple clients sharing one server |

For the advanced shared-server route, start HTTP first:

```bash
npx -y codebase-context --http "/absolute/path/to/your/project" # default port 3100
npx -y codebase-context --http --port 4000 "/absolute/path/to/your/project"
```

Copy-pasteable templates: [`templates/mcp/stdio/.mcp.json`](../templates/mcp/stdio/.mcp.json) and [`templates/mcp/http/.mcp.json`](../templates/mcp/http/.mcp.json). Replace `/absolute/path/to/your/project` in the stdio template with the repository path before saving it.

## Project routing contract

The recommended first-use path passes one absolute root explicitly. Check the
`project.rootPath` in tool responses before relying on a result.

For stdio, workspace discovery is also available when the host announces MCP
roots. If selection is ambiguous, retry with the absolute `project` path. In a
monorepo, start at its root and select the intended package with `project`.

For HTTP, configure the server's roots using a bootstrap path or
`~/.codebase-context/config.json`. Do not rely on a client's initial roots
announcement: that route is not working reliably in the current source.
Connected clients share server routing state, including the active project;
pass an explicit `project` with each tool call when sharing multiple projects.
This is a trusted local shared service, not isolation between clients.

If no project can be inferred, the server returns `selection_required`.
Use an absolute project path rather than guessing from the client's working
directory. Registration scope and repository scope are separate.

## Query, return, and stop

After connecting, read `codebase://context`. Use `get_indexing_status` to check
whether indexing is still running or failed. A first index uses local embeddings
and may download the model. When ready, query `get_symbol_references` for a known
symbol, or `search_codebase` for a concept; inspect the returned source and project.
A connection handshake alone does not establish this flow.

The index lives in the repository's `.codebase-context/` directory. Reconnecting
can reuse it; each stdio connection still owns a separate process. Concurrent
first-time indexing by separate processes has not been validated here. For the
first run, finish indexing in one session before opening another.

Closing the client connection ends its stdio process. For HTTP, disconnecting one
client leaves the shared server running; stop the terminal's server with Ctrl+C.

On Linux CPU-only installations, an optional ONNX GPU download can fail behind
restricted networks. The dependency supports `ONNXRUNTIME_NODE_INSTALL=skip` to
skip unbundled GPU files while retaining its bundled CPU runtime. For example:
`ONNXRUNTIME_NODE_INSTALL=skip npx -y codebase-context "/absolute/repo"`.
This does not remove the embedding model download.

## Claude Code

```bash
claude mcp add --transport stdio codebase-context -- npx -y codebase-context "/absolute/path/to/your/project"
```

Claude Code supports both transports. For HTTP, start the server first and
register the endpoint explicitly:

```bash
npx -y codebase-context --http "/absolute/path/to/your/project"
claude mcp add --transport http codebase-context http://127.0.0.1:3100/mcp
```

`claude mcp add` uses local scope by default: the registration is private to
the current project. Use `--scope project` to write a shareable `.mcp.json`, or
`--scope user` to make it available across your projects. Scope controls where
the registration is stored; it does not start the server or choose which repo
the server indexes.

## Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context", "/absolute/path/to/your/project"]
    }
  }
}
```

This guide documents Claude Desktop's stdio configuration. Verify the current
desktop client documentation before using another transport.

## Cursor

**Stdio** — add to `.cursor/mcp.json` in your project (copy from [`templates/mcp/stdio/.mcp.json`](../templates/mcp/stdio/.mcp.json)):

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context", "/absolute/path/to/your/project"]
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

Open Settings > MCP and add (stdio):

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context", "/absolute/path/to/your/project"]
    }
  }
}
```

This guide documents Windsurf's stdio configuration. Verify current HTTP
support in the client before using the shared-server route.

## Codex

**Stdio:**

```bash
codex mcp add codebase-context -- npx -y codebase-context "/absolute/path/to/your/project"
```

**HTTP** — start the server first (`npx -y codebase-context --http "/absolute/path/to/your/project"`), then register the URL:

```bash
codex mcp add codebase-context --url http://127.0.0.1:3100/mcp
```

`codex mcp add` writes user-level configuration in `~/.codex/config.toml`
(or the selected `CODEX_HOME`). It has no project-scope flag in the checked
0.155.1 CLI. Reusing the same server name for another repository replaces the
first registration; reopening the first repository still resolves the second
root. The wizard now checks existing entries: identical entries are reused,
differing entries are preserved and automatic registration is refused.

For an isolated candidate trial, set `CODEX_HOME` to a new directory for **both**
registration and the subsequent Codex session. Register the built candidate:

```bash
# POSIX shell; use your shell's equivalent environment syntax on Windows.
export CODEX_HOME="/absolute/path/to/new-isolated-codex-home"
mkdir -p "$CODEX_HOME"
codex mcp add codebase-context -- node "/absolute/candidate/dist/index.js" "/absolute/repo"
codex
```

This tests your built candidate. The earlier `npx` recipe resolves the published
package; it does not prove source-candidate behavior. Login/client configuration
in the isolated home is a separate local step; do not copy credentials into a
handoff.

Official Codex documentation also supports `.codex/config.toml` in trusted
projects. A manual project entry has this form (merge it deliberately with an
existing file):

```toml
[mcp_servers.codebase-context]
command = "node"
args = ["/absolute/candidate/dist/index.js", "/absolute/repo"]
```

Normal trusted-project session behavior must be checked in the actual client.
The installed `codex mcp list/get` inspection path did not expose the project
entry in the isolated check; it is not proof that this project setup works.
Registration remains separate from HTTP startup and repository indexing.

## VS Code (Copilot)

Add `.vscode/mcp.json` to your project root. VS Code uses `servers` instead of `mcpServers`:

```json
{
  "servers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context", "/absolute/path/to/your/project"]
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
      "command": ["npx", "-y", "codebase-context", "/absolute/path/to/your/project"],
      "enabled": true
    }
  }
}
```

OpenCode also supports interactive setup via `opencode mcp add`.

## Explicit repository scope

The stdio recipe already passes one absolute repository path. For a manually
written config, append that path as the final argument to `codebase-context`,
or set `CODEBASE_ROOT` in the server environment. HTTP uses its configured
project list and roots or an explicit `project` tool argument for routing.

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
      "args": ["<path-to-local-build>/dist/index.js", "/path/to/your/project"]
    }
  }
}
```

Check these three flows:

1. **Single project** — with an explicit server root, call `get_codebase_metadata` then a useful source query. Check the returned project path.

2. **Multiple projects on a roots-capable stdio host** — open two repos or a monorepo. Call `codebase://context`. Expected: workspace overview, then automatic routing once a project is active.

3. **Ambiguous or no-roots selection** — start without a bootstrap path, call `search_codebase`. Expected: `selection_required`. Retry with `project` set to `apps/dashboard` or `/repos/customer-portal`.

For monorepos, test all three selector forms:

- relative subproject path: `apps/dashboard`
- repo path: `/repos/customer-portal`
- file path: `/repos/monorepo/apps/dashboard/src/auth/guard.ts`
