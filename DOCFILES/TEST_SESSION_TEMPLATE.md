# Test Session Template

Copy this folder for new test sessions.

## Naming

`[Repo]_MMDD` (e.g., `SSP_Portal_0712`)

## TEST_RESULTS.md (Required)

```markdown
# Test Results: [Repo] - [Feature]

**Date**: YYYY-MM-DD  
**MCP Version**: X.X.X  
**IDE**: [Cursor/VS Code] X.X.X

## Tests

| Model | Version | MCP | Build | Patterns | Tokens | Time | LOC | Notes | Failure |
|-------|---------|-----|-------|----------|--------|------|-----|-------|---------|
| [Model] | [ver] | ✅/❌ | ✅/❌ | X/5 | XXK | Xm | ~XXX | [observations] | [type] |

## Pattern Checklist

### [Model] +MCP

- [ ] inject()
- [ ] signals
- [ ] standalone
- [ ] test framework
- [ ] internal libs

**Failures**: [Hallucination/Ignored/Incomplete/Type error] - [details]

### [Model] -MCP

[Same structure]

## Summary

[What difference did MCP make?]
```

## TOOL_CALLS.md (If MCP enabled)

Copy MCP tool invocations and responses.

## Optional

Screenshots in `images/` for notable issues.
