# Hero recording: map, then search --intent edit, then a pause on the preflight.
# Render from the repository root after `pnpm build`:
#   vhs docs/tapes/hero.tape
# The hidden setup builds a model-free index. It is not part of the GIF.
# Keep the visible GIF under 15 seconds and under 3 MB.
# GitHub Actions workflow: render-hero-tape (manual).

Output docs/assets/hero.gif
Output docs/assets/hero.webm

Require node
Require ffmpeg

Set FontFamily "JetBrains Mono"
Set FontSize 16
Set Columns 96
Set Rows 36
Set Padding 18
Set TypingSpeed 12ms
Set Framerate 12
Set Theme "Catppuccin Mocha"

Env CODEBASE_CONTEXT_ASCII "1"
Env CODEBASE_ROOT "tests/fixtures/codebases/eval-controlled"

Hide
Type "export PS1='$ '"
Enter
Type "clear"
Enter
Type "node dist/index.js reindex --no-embeddings"
Enter
Wait+Screen /Indexed/
Type "clear"
Enter
Sleep 200ms
Show

Type "node dist/index.js map"
Enter
Sleep 2.2s
Type "clear"
Enter
Sleep 250ms
Type "node dist/index.js search --query 'auth headers' --intent edit --limit 3"
Enter
Sleep 5s
