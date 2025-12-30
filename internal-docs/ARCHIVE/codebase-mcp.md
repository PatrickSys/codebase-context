# Project: Codebase MCP (Master Control Program)

## 1. Vision & Intent

The primary goal of Codebase MCP is to make Large Language Models (LLMs) and AI agents significantly more effective at generating and modifying code within established, complex codebases. It aims to bridge the gap between the general knowledge of an LLM and the specific, nuanced context of a particular software project.

By providing deep, contextual understanding of a project's architecture, patterns, frameworks, and conventions, Codebase MCP will act as a "Master Control Program" that guides AI-driven development, reducing hallucinations, incorrect API usage, and the need for excessive manual guidance.

## 2. Problem Statement

As of late 2025, while AI agents are proficient at writing boilerplate or isolated code, their effectiveness diminishes drastically when working on existing projects. The core problems are:

- **Context Blindness:** LLMs are unaware of project-specific architectural decisions, such as state management patterns (e.g., NgRx in Angular), authentication flows, or testing strategies.
- **API Hallucination:** Agents frequently invent or assume the existence of functions, modules, or APIs that are not present in the codebase.
- **Convention Ignorance:** Generated code often fails to adhere to established coding styles, naming conventions, and structural patterns, increasing the need for manual refactoring.
- **High Guidance Overhead:** Developers must spend significant time providing detailed manual context (e.g., "Here is our authentication service, please use it like this...") for even simple tasks.

This results in a workflow where the cognitive load of guiding the AI often outweighs the benefits of using it.

## 3. Scope and Phased Implementation

### Phase 1: Initial Implementation (MVP)

-   **Technology Focus:** The initial version will be scoped to **JavaScript and TypeScript** codebases.
-   **Framework Focus:** While the long-term vision is framework-agnostic, the first implementation will prioritize and be optimized for **Angular** projects, given their structured nature.
-   **Core Functionality:**
    -   **Codebase Indexing:** Develop an indexer (`codebase-mcp-indexer`) that can traverse a repository, parse source files, and build a semantic map of the codebase.
    -   **Pattern Extraction:** The indexer should identify and catalog key architectural components and patterns, such as:
        -   State management stores (e.g., NgRx stores, services with BehaviorSubjects).
        -   API/HTTP service layers.
        -   Authentication/Authorization services.
        -   Core UI component libraries.
        -   Testing setups and conventions.
    -   **Context Provisioning:** The extracted context will be made available to a target AI agent or LLM, likely via a structured output (e.g., JSON, Markdown) or a dedicated API.

### Phase 2: Framework Agnosticism

-   Expand the analysis capabilities to support other major frameworks like React, Vue, Svelte, and backend frameworks (e.g., Node.js/Express, NestJS).
-   Develop a pluggable architecture where "analyzers" for specific technologies can be added or enabled as needed.

### Phase 3: The "MCP" Vision

-   Evolve the tool into a true "Master Control Program" that can be added to any repository as a dev-dependency.
-   Offer a seamless, Cursor-like experience where the context is automatically and continuously fed to the developer's AI assistant of choice.
-   This would involve deeper integration with IDEs and AI agent runtimes.

## 4. Inspiration & Existing Art

This project draws inspiration from and aims to build upon concepts from:

-   **Cursor:** For its deep codebase indexing and seamless IDE integration.
-   **gitmcp.io:** For the concept of an AI-native "mission control".
-   **claude-context:** For its focus on providing relevant context to an LLM.
-   **codebase-mcp (previous attempt):** As a starting point for what a self-contained codebase analyzer might look like.
