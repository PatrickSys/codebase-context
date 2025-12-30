# Codebase Context MCP - Project Specification

## Problem Statement

AI Agents and LLMs used for code generation frequently:
- Hallucinate or invent APIs that don't exist
- Assume patterns and conventions without understanding the actual codebase
- Require excessive manual context and guidance
- Fail to understand project-specific patterns for state management, authentication, testing, etc.

## Project Intent

Create an MCP (Model Context Protocol) server that provides AI agents with rich, structured context about a codebase, enabling them to:
- Understand the architecture and design patterns used
- Know the specific frameworks, libraries, and their configurations
- Follow established conventions for state management, authentication, routing, testing, etc.
- Generate code that aligns with existing patterns rather than inventing new approaches

## Scope

### Initial Scope (MVP)
- **Language Support**: JavaScript/TypeScript codebases
- **Framework Focus**: Angular applications (initial implementation)
- **Core Features**:
  - Codebase indexing and analysis
  - Pattern extraction (state management, authentication, API calls, etc.)
  - Architecture documentation generation
  - MCP server exposing context to AI agents

### Future Scope
- Framework agnostic (React, Vue, Svelte, etc.)
- Support for other languages (Python, Go, etc.)
- Real-time index updates on file changes
- Custom pattern definitions

## Key Context Areas to Extract

1. **Project Structure**
   - Directory organization
   - Module/feature boundaries
   - Entry points

2. **State Management**
   - Store patterns (NgRx, NGXS, services, signals, etc.)
   - State structure and conventions
   - Actions/reducers patterns

3. **Authentication & Authorization**
   - Auth flow patterns
   - Guards and interceptors
   - Token management

4. **API Integration**
   - HTTP client patterns
   - Service layer organization
   - Error handling conventions

5. **Testing Patterns**
   - Test file organization
   - Mocking strategies
   - Test utilities and helpers

6. **Styling & UI Patterns**
   - Component library usage
   - Styling approach (SCSS, Tailwind, etc.)
   - Theming patterns

7. **Routing & Navigation**
   - Route organization
   - Lazy loading patterns
   - Route guards

## Technical Approach

### MCP Server
- Expose tools/resources via MCP protocol
- Provide structured context on demand
- Support queries for specific patterns or areas

### Indexing Strategy
- Static analysis of codebase
- AST parsing for pattern detection
- Configuration file analysis
- Dependency graph construction

### Output Format
- Structured JSON/Markdown for AI consumption
- Contextual examples from actual codebase
- References to specific files/lines

## Similar Tools & Inspiration

- **GitMCP** (https://gitmcp.io/) - Git repository context
- **Claude Context** (https://github.com/zilliztech/claude-context) - Context management
- **Codebase MCP** (https://github.com/DeDeveloper23/codebase-mcp) - Codebase indexing
- **Cursor** - IDE with codebase indexing
- **Augment Code** - AI-powered code understanding

## Success Criteria

1. AI agents can generate code that follows existing patterns without manual guidance
2. Reduced hallucination of non-existent APIs or patterns
3. Consistent code style and architecture across AI-generated code
4. Easy integration via MCP protocol with any compatible AI agent

## Related Projects

Existing attempts to evaluate/consolidate:
- `codebase-mcp`
- `codebase-mcp-indexer`
- `frontend-mcp`
- `codebase-context-mcp`

## Next Steps

1. Review existing project attempts
2. Identify reusable components and good ideas
3. Define MVP feature set
4. Choose base project or start fresh
5. Implement core indexing and MCP server
