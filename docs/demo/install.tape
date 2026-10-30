# Terminal recording for docs/demo/install.gif (generate locally; do not commit the GIF if large).
Output docs/demo/install.gif
Require vhs
Set Shell bash
Set FontSize 14
Set Width 1200
Set Height 700
Set Theme "Catppuccin Mocha"

Hide
Type "cd /path/to/your/project"
Enter
Sleep 500ms
Type "npx -y codebase-context@latest init --yes --skip-index --no-update-notice"
Enter
Sleep 3s
Show

Sleep 2s
