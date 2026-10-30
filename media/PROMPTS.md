# Prompts

Ready to paste. The words in the next section are copied from the README and the benchmark. Keep them as written.

The README hero is the recorded terminal GIF at `docs/assets/hero.gif` (WebM: `docs/assets/hero.webm`). It is one take of `map`, then `search --intent edit`, on `tests/fixtures/codebases/eval-controlled`. In that take the preflight says the match is low confidence and not ready to edit. Do not ask a model to draw a fake terminal result.

Agent: cursor-cloud/cbc-visuals

## Words to copy

```text
Codebase Context gives coding agents a map of your repository through MCP, for developers who want their agent to find relevant code and follow the team's patterns.

Search, examples and project memory run locally by default.

search_codebase ranks files and symbols for the task instead of returning an unstructured dump.

get_team_patterns shows the approaches used in the repository and points to representative files.

Index locally. Codebase Context scans the project, builds a keyword index, and creates local semantic embeddings.

The search result shows ranked files, relevant project patterns, and what the agent should read before it changes code.

Code and indexes stay on the machine with the default local embedding provider. Docker, a GPU, and an API key are not required.

Cloud embeddings are optional. If you select a cloud provider, code chunks are sent to that provider to create the search index.

claude mcp add --scope user --transport stdio codebase-context -- npx -y codebase-context

The existing benchmark reports 25.7% expected-file recovery versus jCodeMunch's 27.1% in a fixed retrieval comparison; it does not establish a winner or coding quality.
```

Leave the benchmark sentence out unless the picture needs a number. If a number appears, use that whole sentence. Do not add a speed, token, or coding-quality claim.

## README still

Use this when a still image is wanted beside the recorded GIF. The GIF remains the hero.

### Claude

```text
Draw a wide SVG, about 1600 by 640, for the Codebase Context README. Dark background, plain rectangles and one accent color, no photos, no logos, no fake screenshots, no charts.

Use only these sentences, copied as written:

Codebase Context gives coding agents a map of your repository through MCP, for developers who want their agent to find relevant code and follow the team's patterns.

Search, examples and project memory run locally by default.

Do not add metrics. Do not draw a terminal. The real demo is a separate GIF.
```

### Image model

```text
Wide dark banner, 1600x640, flat geometric shapes, cream text, one amber accent, no people, no stock photos, no UI chrome, no terminal, no numbers. Headline copied exactly: "Codebase Context gives coding agents a map of your repository through MCP, for developers who want their agent to find relevant code and follow the team's patterns." Second line copied exactly: "Search, examples and project memory run locally by default."
```

### Video model

```text
10 second silent motion graphic, 1600x640, plain rectangles and text on a dark field. No stock footage, no people, no fake product UI. Show this sentence for the first half, copied exactly: "Codebase Context gives coding agents a map of your repository through MCP, for developers who want their agent to find relevant code and follow the team's patterns." Then this sentence, copied exactly: "Search, examples and project memory run locally by default." No other claims.
```

## LinkedIn card

1200 by 627. Same limits: no fake terminal, no invented numbers.

### Claude

```text
Make a 1200 by 627 SVG card for a LinkedIn post about Codebase Context. Flat shapes, dark background, cream type, one accent. No people, no stock photos, no screenshots, no charts.

Copy these lines exactly:

Codebase Context gives coding agents a map of your repository through MCP, for developers who want their agent to find relevant code and follow the team's patterns.

Search, examples and project memory run locally by default.

Code and indexes stay on the machine with the default local embedding provider.

If you mention a measurement, use this whole sentence and no other number: "The existing benchmark reports 25.7% expected-file recovery versus jCodeMunch's 27.1% in a fixed retrieval comparison; it does not establish a winner or coding quality."
```

### Image model

```text
LinkedIn card, 1200x627, flat dark layout, three short text blocks, no photographs, no faces, no fake dashboard. Text must be copied exactly and remain readable: "Codebase Context gives coding agents a map of your repository through MCP, for developers who want their agent to find relevant code and follow the team's patterns." "Search, examples and project memory run locally by default." "Code and indexes stay on the machine with the default local embedding provider." No extra slogans and no numbers.
```

### Video model

```text
15 second silent LinkedIn video, 1200x627, plain shapes and text only. No stock clips, no people, no screen recording. Three beats, each a sentence copied exactly: "Codebase Context gives coding agents a map of your repository through MCP, for developers who want their agent to find relevant code and follow the team's patterns." Then "Search, examples and project memory run locally by default." Then "Code and indexes stay on the machine with the default local embedding provider." End there. No winner, speed, or token claim.
```

## Reddit-safe diagram

A diagram, not an ad. No hype, no fake before/after, no cropped benchmark.

### Claude

```text
Draw an SVG diagram a Reddit reader can check against the README. White background, sketch-style boxes and arrows, black stroke, no photos, no fake terminal, no trophy, no "10x".

Title, copied in meaning from the README privacy section: code stays on the machine with the default local provider.

Three boxes in a row: Repository, Local index, Results. A dashed box under them: "Cloud embeddings are optional. If you select a cloud provider, code chunks are sent to that provider to create the search index."

Footer, copied exactly: "Docker, a GPU, and an API key are not required."

Do not include the 25.7% figure. The diagram is about where code goes, not about retrieval score.
```

### Image model

```text
Clean diagram on white, hand-drawn boxes, 1200x700, black ink, light blue and green fills, one dashed red box. No people, no logos, no screenshots, no numbers. Title: "Code and indexes stay on the machine with the default local embedding provider." Three boxes: Repository, Local index, Results. Dashed box: "Cloud embeddings are optional. If you select a cloud provider, code chunks are sent to that provider to create the search index." Footer: "Docker, a GPU, and an API key are not required." All of those sentences must be spelled as written.
```

### Video model

```text
12 second silent diagram video, white background, sketch boxes drawing themselves, no stock footage, no voiceover, no numbers. Start with three boxes labeled Repository, Local index, and Results, and the sentence "Code and indexes stay on the machine with the default local embedding provider." Then draw a dashed box with the sentence "Cloud embeddings are optional. If you select a cloud provider, code chunks are sent to that provider to create the search index." End on "Docker, a GPU, and an API key are not required." Do not add a comparison or a winner.
```
