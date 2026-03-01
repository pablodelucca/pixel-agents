---
description: Implement an approved OpenSpec change and keep tasks in sync.
---
The user has requested to implement the following change proposal. Find the change proposal and follow the instructions below. If you're not sure or if ambiguous, ask for clarification from the user.
<UserRequest>
  $ARGUMENTS
</UserRequest>
<!-- OPENSPEC:START -->
**Guardrails**
- Favor straightforward, minimal implementations first and add complexity only when it is requested or clearly required.
- Keep changes tightly scoped to the requested outcome.
- Refer to `openspec/AGENTS.md` (located inside the `openspec/` directory—run `ls openspec` or `openspec update` if you don't see it) if you need additional OpenSpec conventions or clarifications.

**Steps**
Track these steps as TODOs and complete them one by one.
1. Read `changes/<id>/proposal.md`, `design.md` (if present), and `tasks.md` to confirm scope and acceptance criteria.
2. Work through tasks sequentially, keeping edits minimal and focused on the requested change.
3. Confirm completion before updating statuses—make sure every item in `tasks.md` is finished.
4. Update the checklist after all work is done so each task is marked `- [x]` and reflects reality.
5. Reference `openspec list` or `openspec show <item>` when additional context is required.

**Reference**
- Use `openspec show <id> --json --deltas-only` if you need additional context from the proposal while implementing.
<!-- OPENSPEC:END -->
