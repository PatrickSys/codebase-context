AI Coding Agents have coding knowledge but lack "Codebase Intelligence". I tried to give them a second brain.

I've been using AI coding tools since 2022 (when GitHub Copilot was first released). While they now handle multi-step workflows with huge context windows, they remain "Junior Developers" on their first day. Every single day.

They don't know that we use an internal UI library instead of external ones. They don't know that we are 60% through a migration from RxJS to Signals. They don't know that 'user.service.ts' is the "Golden File" that demonstrates our best practices.

So I built Codebase-Context MCP.

It is a local "Discovery Layer" that gives the AI eyes to see your reality. Built on an extensible modular architecture (starting with an Angular analyzer), it provides quantified evidence instead of generic suggestions:

1. Indexes your codebase and offers semantic search through the index.
2. Library Discovery: It tells the Agent '@mycompany/ui-toolkit' is used in 847 files, while '@angular/material' appears in only 12.
3. Pattern Quantification: It detects that 'inject()' is used in 98% of Angular classes, preventing the model from guessing based on outdated or generic training data.
4. Golden Files: It algorithmically finds files that best represent your target architecture, so the AI copies from the best, not the legacy.

Now you might be thinking: What if 80% of your codebase is legacy code?

Fair point. Here's what I learned from building this:

A well-maintained AGENTS.md is incredibly effective for declaring intent ("Use inject()"). However, static files can't dynamically quantify usage or find the perfect reference file among thousands. It's the quantification of patterns that this MCP provides. Evidence that grounds the AI context in the codebase reality.

The problem today isn't "not enough context". It's actually "too much irrelevant context". In one of my testing sessions, I was using Grok Code and the MCP returned four (small) files worth of context. One of them used constructor DI and the rest used the inject function. Guess what? Grok used constructor DI. The same happened with GPT-5.1 High.

This mirrors the Stack Overflow and DORA 2025 reports: AI adoption is high (~90%), but often harms stability by increasing code churn. We are generating code faster, but it is "almost right, but not quite."

The next step is "AI Governance"- ensuring AI produces code how we want it.

What are you doing to keep AI aligned with your standards?