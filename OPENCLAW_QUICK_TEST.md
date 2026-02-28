# OpenClaw Pixel Agents – Quick Test (3 Steps)

This is a beginner test.

## 1) Open in VS Code + run extension host
1. Open folder `pixel-agents` in VS Code
2. Press `F5`
3. In the new "Extension Development Host" window, open the **Pixel Agents** panel

## 2) Switch provider to OpenClaw mode
In the Extension Development Host settings:
- Search for `pixelAgents.provider`
- Set to: `openclaw-session`

## 3) Validate expected behavior
Expected:
- An observer terminal named **OpenClaw Observer** exists (single shared one)
- Pixel characters appear from active OpenClaw session files
- Status changes when tool activity appears (active / waiting)

Tip:
- Keep `pixelAgents.openclaw.maxObservedAgents = 1` for a clean beginner setup.

If something looks wrong, note:
- what you did
- what you expected
- what happened instead
- screenshot if possible

Then send it to Sam and he will fix it.
