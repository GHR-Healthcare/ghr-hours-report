# ghr-hours-report — Claude Code Instructions

## Environment

Mike works from a cloud desktop (Windows with WSL) as of November 2026, so one machine serves home and office. Repos live at `/home/mjones/Projects/<repo>`, as before, and Claude's per-repo memory was copied across from the old laptop in November 2026. Two quirks recorded on the old laptop are still true here, measured 2026-11-05: `az` is the Windows CLI through WSL interop (`/mnt/c/Program Files (x86)/.../az`; its Windows-path warning goes to stderr, and `-o tsv` can carry a trailing `\r`), and `/tmp` is wiped on every reboot (nothing there predates the current boot). Other old-laptop notes in memory: check before applying them here.
