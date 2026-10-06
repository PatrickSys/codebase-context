# Client Setup

Codebase Context runs as a local MCP server: a tool your AI editor or command-line client can call while it works. Register it without a fixed folder, then let the agent supply its current repository through the `project` tool parameter. These examples use published npm `2.2.0`.

Use Node.js 22 or newer for these recipes. The package declares Node 18+, but native dependency requirements are narrower than that broad declaration; these checks do not establish Node 18.0 compatibility.

The copyable registration commands target PowerShell or a POSIX terminal. Windows Command Prompt was not tested; OpenCode's quoted separator is shell-dependent.

## Current published-package recipes (updated 2026-10-06)

Claude Code, Codex CLI and OpenCode registration commands were checked again on October 6 without a project argument. The other clients retain their older config-shape evidence; no-folder native agent use is unverified for them. See the dated notes below.

Each client section says how far its isolated Windows check went:

| Status                         | What it means                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| **Connected locally**          | The isolated client started and connected to the server.                                   |
| **Config recognized locally**  | The isolated client found the config but still required approval before loading it.        |
| **Config written locally**     | The isolated command wrote the expected config. A live agent session was not claimed.      |
| **Official instructions only** | The config follows current official docs, but this client was not fully exercised locally. |

These checks cover setup and startup state. They do not measure how an agent handles a coding task.

After registration, start a new agent session in your project and ask:

> Use Codebase Context to find [feature] in this repository. Pass this repository's absolute path as project when checking get_indexing_status and searching. Wait for indexing if needed, read codebase://context, then search_codebase and open a returned source file. Show me the relevant files.

The first index may take a while and download a local model. You can prepare it separately with `npx -y codebase-context@2.2.0 reindex` from the project folder. Index readiness, client connection and useful agent behavior are separate checks.

## Claude Code

**Status:** Connected locally

**Checked:** 2026-10-06 with Claude Code 2.1.291

**Scope:** User scope makes the registration available across projects. The agent selects the repository in tool calls.

User setup:

```bash
claude mcp add --scope user --transport stdio codebase-context -- npx -y codebase-context@2.2.0
```

Optional shared project setup:

```bash
claude mcp add --scope project --transport stdio codebase-context -- npx -y codebase-context@2.2.0
```

`--scope project` writes shared `.mcp.json` and requires project-server approval. `--scope local` instead stores a private association for the current project in `~/.claude.json`; it does not write `.mcp.json`.

**What was checked:** With isolated user configuration, the no-folder user command wrote the expected stdio arguments and `claude mcp get` reported Connected.

**Limit:** Connection proof does not establish an agent investigation. The optional shared-project variant follows the official scope contract; it was not exercised in this October check.

**Official docs:** https://code.claude.com/docs/en/mcp

## Codex CLI

**Status:** Config written locally

**Checked:** 2026-10-06 with Codex CLI 0.160.0

**Scope:** The command writes user config. A trusted project can use a project `.codex/config.toml` instead.

```bash
codex mcp add codebase-context -- npx -y codebase-context@2.2.0
```

Equivalent project config:

```toml
[mcp_servers.codebase-context]
command = "npx"
args = ["-y", "codebase-context@2.2.0"]
startup_timeout_sec = 120
```

**What was checked:** The command ran with an isolated `CODEX_HOME`, wrote `config.toml`, and `codex mcp get` returned the same command and arguments.

**Limit:** The CLI command is user-scoped. A trusted project can instead use .codex/config.toml. The double dash is required.

**Official docs:** [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli). The supported `startup_timeout_sec` option defaults to ten seconds; the project example allows 120 seconds for initial `npx` package preparation. This does not prove Desktop startup or guarantee completion of a cold download.

## Codex Desktop: published 2.2.0

Create or merge `.codex/config.toml` in the project you want to search. Preserve any existing settings:

```toml
[mcp_servers.codebase-context]
command = "npx"
args = ["-y", "codebase-context@2.2.0"]
startup_timeout_sec = 120
```

Trust the project if asked, restart Codex and start a new task there. Use the first-use prompt above so the agent selects the current repository. The CLI command in the preceding section writes user-level config; this recipe uses a trusted project's config instead.

**Verification boundary:** isolated Windows CLI and SDK/MCP checks on October 5 indexed a six-file fixture with published `2.2.0`, selected its project, retrieved context and found a source that the host could open. The exact `npx -y codebase-context@2.2.0 <project>` entrypoint also passed using a warmed isolated npm cache and prepared index. This does not establish a fully cold download or a fresh Codex Desktop agent session. The September Desktop session below used a packed candidate; keep it separate from published-package acceptance.

On October 6 the exact published `npx` entrypoint was also tested without a folder, environment root or MCP roots, launched from an unrelated directory. Its first tool call returned `selection_required`; an explicit `project` call selected the prepared fixture, search found the expected symbol, context returned its map, and the runner host opened the returned source. A later call without `project` retained that selection. This is SDK/protocol and runner-host evidence with warmed caches and a pre-indexed fixture, not a native Desktop task.

## Unreleased installer candidate

The next release is expected to support one project-only command from the target project:

The `init --client codex --yes` flow is an unreleased source candidate. Published npm `2.2.0` does not include these flags. Use the published configuration above rather than an `@latest` installer command; candidate verification uses an exact built or installed candidate.

A successful `init --client codex --yes` writes the project-scoped `.codex/config.toml` and prepares the index for that root. If config writing or index preparation fails, setup is incomplete and Codex is not ready to use.

For candidate verification before publication, build the source checkout and run its absolute `dist/index.js` path from the project you want to configure:

```powershell
# In the codebase-context source checkout
npm run build

# In the target project, using the built CLI path
node C:\path\to\codebase-context\dist\index.js init --client codex --yes
```

Use `--root C:\path\to\project` when the command is run from elsewhere. Here, `root` means the project folder to configure and index. The candidate writes the project-scoped `<project>/.codex/config.toml`, preserves unrelated Codex settings, prepares the index for that folder, and does not write `AGENTS.md` or global client configuration. After a successful result, trust the project in Codex Desktop if prompted, restart or reopen Codex, start a new task in that project, and ask a small project question. A written config and ready index do not prove that Codex loaded or queried the server.

Before release, the generated `npx` server command still resolves the published package unless the candidate is installed in the target project's `node_modules`. Our packaged test installs the candidate in a disposable project and checks its file hash. Running the built setup command alone does not prove that Codex will launch that same candidate.

**Checked on 2026-09-15:** the packed candidate installed and indexed an isolated Windows project. A fresh Codex Desktop task then called the actual `search_codebase` MCP tool and located the requested chart component with its source file and lines. The normal Desktop task flow established project trust; no trust-file edits or replacement CLI/SDK search were used for that answer. This covers the small prepared project with shared caches, not a cold-machine install or the published npm package.

## Optional fixed-folder setup and CLI preparation

To set a default project before the first tool call, append its full path to the server arguments, for example `args = ["-y", "codebase-context@2.2.0", "C:/projects/my-app"]`. Use a quoted literal shell argument in registration commands. This makes the default fixed across repositories when the registration is user-scoped; explicit tool selection can still choose another allowed project.

To prepare the index separately, run from the project folder:

```powershell
npx -y codebase-context@2.2.0 reindex
```

Do not use published `2.2.0`'s interactive `init` as the setup route. October 6 isolated checks found that it ignores `--help`, `--client` and `--yes`; its Claude/Codex registration executes `mcp` instead of the client executable, and its HTTP recipes require a separately started server. It can exit zero after registration fails. The unreleased installer above is a separate implementation.

## Gemini CLI

**Status:** Config written locally

**Checked:** 2026-08-11 with Gemini CLI 0.41.1

**Scope:** User or project.

User setup:

```bash
gemini mcp add --scope user codebase-context npx -y codebase-context@2.2.0
```

Project setup:

```bash
gemini mcp add --scope project codebase-context npx -y codebase-context@2.2.0
```

Gemini writes an `mcpServers` entry in its settings. Claude, Codex, and Copilot CLI use `--`; Gemini does not.

**What was checked:** Both commands wrote the expected config in isolated homes and projects. The user-scoped list found the server as disconnected; no live agent connection was claimed.

**Limit:** Gemini does not use the double-dash separator. The isolated project-scoped list did not enumerate the project entry, so only config generation is proved.

**Official docs:** https://geminicli.com/docs/tools/mcp-server/

## Cursor

**Status:** Config recognized locally

**Checked:** 2026-08-11 with Cursor 3.15.6 and Cursor Agent 2026.04.17-787b533

**Scope:** Project.

Create `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context@2.2.0"]
    }
  }
}
```

Checked config shape: `.cursor/mcp.json with mcpServers.codebase-context command npx and args [-y, codebase-context]`.

**What was checked:** Cursor Agent loaded the isolated workspace config and showed the server pending approval.

**Limit:** User approval is required. The official one-click route exists, but a generated deep link was not accepted as proof.

**Official docs:** https://docs.cursor.com/context/model-context-protocol

## VS Code with GitHub Copilot

**Status:** Official instructions only

**Checked:** 2026-08-11 against VS Code 1.125.1 help and current official docs

**Scope:** User command or workspace config; not locally runtime-tested.

Official user command:

```powershell
code --add-mcp '{"name":"codebase-context","command":"npx","args":["-y","codebase-context@2.2.0"]}'
```

Deterministic workspace config at `.vscode/mcp.json`:

```json
{
  "servers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context@2.2.0"]
    }
  }
}
```

**What was checked:** Local CLI help exposes `--add-mcp`. An isolated GUI launch could not provide deterministic completion, so it was not counted as a local runtime check.

**Limit:** The command is official but not accepted as a completed local runtime test. Workspace config remains the deterministic manual fallback.

**Official docs:** https://code.visualstudio.com/docs/agent-customization/mcp-servers

## GitHub Copilot CLI

**Status:** Config written locally

**Checked:** 2026-08-11 with GitHub Copilot CLI 1.0.24

**Scope:** User config.

```bash
copilot mcp add codebase-context -- npx -y codebase-context@2.2.0
```

**What was checked:** The command ran with an isolated `--config-dir` and wrote the expected `mcp-config.json` command, arguments, and tool filter.

**Limit:** The CLI writes user configuration by default. VS Code workspace mcp.json is a separate surface.

**Official docs:** https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers

## OpenCode

**Status:** Connected locally

**Checked:** 2026-10-06 with stable OpenCode 1.18.34

**Scope:** User registration by default.

Run once:

```bash
opencode mcp add codebase-context '--' npx -y codebase-context@2.2.0
```

Keep the quoted `'--'`: the installed Windows PowerShell npm shim consumes an unquoted separator. The quoted form also works in POSIX shells.

For a project-local alternative, merge this into `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "codebase-context": {
      "type": "local",
      "command": ["npx", "-y", "codebase-context@2.2.0"],
      "enabled": true,
      "timeout": 120000
    }
  }
}
```

Checked config shape: `opencode.json with a local command array and timeout 120000`.

The longer timeout is intentional because the isolated cold start took about 38 seconds while `npx` prepared the package and server.

**What was checked:** With home, config, data, cache, temporary and workspace paths redirected, the no-folder command wrote user configuration and `opencode mcp list` reported Connected. An August 11 check with OpenCode 1.18.5 also connected using the project config shape and an explicit folder; the no-folder project variant is not a new native acceptance check.

**Limit:** Stable OpenCode 1.x and beta OpenCode 2 use different native config shapes. The stable V1 shape is the public default; do not mix schemas.

**Official docs:** https://opencode.ai/docs/mcp-servers/

## Windsurf

**Status:** Official instructions only

**Checked:** 2026-08-11 against current official docs; Windsurf was not installed locally

**Scope:** User config.

Create `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "npx",
      "args": ["-y", "codebase-context@2.2.0"]
    }
  }
}
```

Checked config shape: `~/.codeium/windsurf/mcp_config.json with mcpServers.codebase-context command npx and args [-y, codebase-context]`.

**What was checked:** The config shape was checked against the current official page. The local client was unavailable.

**Limit:** Current ownership and local behavior are not independently verified on this machine; publish as official config, not locally tested.

**Official docs:** https://docs.windsurf.com/windsurf/cascade/mcp

## Optional advanced HTTP server

Use `stdio` for the simplest setup. HTTP can let several clients share one long-running local process, but support depends on the client and this path is not part of the default setup proof:

```bash
npx -y codebase-context@2.2.0 --http
npx -y codebase-context@2.2.0 --http --port 4000
```

The documented default endpoint is `http://127.0.0.1:3100/mcp`. Config-shape templates are available in [`templates/mcp/stdio/.mcp.json`](../templates/mcp/stdio/.mcp.json) and [`templates/mcp/http/.mcp.json`](../templates/mcp/http/.mcp.json); pin the published package as in the recipes above. HTTP does not discover a client's project folder; the agent still has to select its repository.

The [MCP July 28, 2026 HTTP revision](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http) removed protocol sessions and the GET stream endpoint. This source checkout uses SDK 1.27.1 and the earlier protocol/session model. The stdio checks do not validate its concurrent HTTP project isolation or compatibility with the new revision. A protocol migration and host testing are separate from these setup recipes.

Client support for HTTP differs. Follow that client's official docs and keep stdio as the fallback.

## Project routing contract

The documented default is agent-directed selection. Start the stdio server without a folder; call `get_indexing_status` with the current repository's absolute path as `project`, wait for readiness and pass the same `project` when searching. A successful selection becomes the default for later calls in that server process, including `codebase://context`. Select another project explicitly when changing repositories. This lets one registration serve multiple projects without changing client configuration.

CBC deliberately does not index the server process's working directory when no project is configured. Without a configured folder, known root or explicit selection, tools return `selection_required`. They do not guess or index the user's home directory.

Some clients also announce workspace roots. One valid root can auto-select; several roots with no active selection return `selection_required` and available projects. Explicit selectors must stay within announced roots. Relative monorepo paths require a known workspace context; use absolute repository paths for the portable first-use recipe.

[MCP deprecated Roots on July 28, 2026](https://modelcontextprotocol.io/specification/2026-07-28/client/roots), recommending explicit directories/files in tool parameters, resource URIs or server configuration. CBC's older Roots support remains a compatibility aid rather than a required setup step.

October 6 verification: 18 focused current-source routing tests passed, including ambiguous roots, explicit selection, subsequent calls and root changes. The exact published server also switched between two isolated prepared repositories A to B to A in one no-roots stdio process: search paths, context map and subsequent status calls followed each selection. The runner host opened the expected distinct sources. A native agent session across real repositories remains a validation step; stdio process-local selection does not establish concurrent HTTP isolation.

A follow-up recorded raw `search_codebase` calls containing only `query` and `mode`, with no `project`: they returned A, B and A after those explicit selections. The caller does not automatically add the full path; CBC routes omitted-project calls using its selected project. This state lasts for that stdio process. Select again after a server restart or when changing repositories.

A native Codex CLI controlled-fixture trial with an ordinary question supplied the correct absolute `project` without path instructions. Its MCP call was denied by the noninteractive run's `never` approval policy, so native retrieval and continuation did not pass. If a host refuses a tool call for approval, repeating the folder path will not resolve that permission issue; use the client's trust/approval flow. The test retained the denial and did not count fallback source/index reads as CBC acceptance.

## Test a local build

Build the source checkout:

```bash
pnpm build
```

Then replace the `npx` command in your client config with the local entry point:

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "node",
      "args": ["<path-to-checkout>/dist/index.js"]
    }
  }
}
```

For one explicit project, append its path to the arguments or set `CODEBASE_ROOT`.
