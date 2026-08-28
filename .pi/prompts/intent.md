---
description: "Capture a complex/ambiguous task as an intent.md before implementation starts — problem, proposed outcome, affected scope, constraints, open questions. Part of the AI-native SDLC convention in docs/ai-native-sdlc/."
argument-hint: "<idea or problem, in your own words>"
---
Capture intent for: $ARGUMENTS

This is the executable form of `docs/ai-native-sdlc/README.md`. Read that file first if you have not already — it defines when this is worth doing and the file layout. Do NOT start implementing after this — the point is to align on the problem before writing code.

## Steps

1. **Check whether this is worth an intent.md.** Per `docs/ai-native-sdlc/README.md`, it's worth it if the task spans multiple packages/modules, is a breaking change, the requirement itself is vague, or is >half a day of work / a decision future maintainers need to understand. If none apply, say so and suggest going straight to `/code`, `/data`, `/doc`, or plan mode instead — don't force the ceremony.

2. **Derive a feature-slug.** kebab-case, based on what the feature/problem actually is (not a date or session id). Check `docs/ai-native-sdlc/` for an existing directory with the same or a superseding intent before creating a new one — don't fork a second intent for the same problem.

3. **Draft the intent** using `docs/ai-native-sdlc/_template/intent.md` as the structure (Problem, Proposed outcome, Affected users and systems, Constraints, Out of scope, Success measures, Open questions, Source evidence). Fill it from `$ARGUMENTS` and the current conversation — do not invent scope or evidence that wasn't discussed. If something is genuinely unclear, put it under Open questions rather than guessing.

4. **Ask, don't assume, when uncertain.** If Problem, Proposed outcome, or Constraints are underdetermined from the conversation, ask the user 1-3 concrete questions before writing the file (consistent with `HYDRO.md`'s task-routing rule) — don't ship a speculative intent full of invented constraints.

5. **Write the file** to `docs/ai-native-sdlc/<feature-slug>/intent.md` with `Status: draft`. Set `Source` to the current session's JSONL path if known, otherwise `n/a`. Set `SDLC stage: Intent captured / awaiting review`.

6. **Hand off, don't proceed.** Show the user the drafted intent (or a summary) and ask them to confirm or edit it. Only after they confirm should you update `Status: accepted`. Do not start implementation or write `spec.md` in the same turn unless the user explicitly asks for that too.

## Rules

- This produces a document, not code. No file edits outside `docs/ai-native-sdlc/<feature-slug>/intent.md` in this prompt.
- Out of scope items matter as much as the problem statement — always fill in at least one; an intent with no boundaries invites scope creep later.
- If an accepted intent already exists for overlapping scope, prefer amending it (or marking it `superseded` and linking the replacement) over creating a duplicate.
