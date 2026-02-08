# Agent Instructions

## Codebase Context

**At start of each task:** Call `get_memory` to load team conventions.

**CRITICAL:** When user says "remember this" or "record this":
- STOP immediately and call `remember` tool FIRST
- DO NOT proceed with other actions until memory is recorded
- This is a blocking requirement, not optional

## Internal Documentation (Submodule)

This repository uses a private git submodule for internal notes.

- **Path**: `internal-docs/`
- **Repo**: `https://github.com/PatrickSys/codebase-context-internal.git`

### Quick Setup

```bash
git clone --recurse-submodules https://github.com/PatrickSys/codebase-context.git
```

### Syncing

```bash
git pull --recurse-submodules
git submodule update --remote --merge
```

### Privacy

The `internal-docs` repository is private. It returns a 404 to unauthenticated users. Access requires a GitHub PAT or SSH keys with repository permissions.
