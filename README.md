# Branch Context: 1-incorporate-yt-dlp-support

## How It Works

This `.branch-context/` directory provides branch-specific notes for AI coding
assistants. It is git-ignored, never committed, and automatically managed by git hooks:

- **On checkout**: Your notes are restored from a local stash (or pulled from remote)
- **On push**: Your notes are backed up to the remote as an orphan ref
- **On branch switch**: Notes swap automatically — each branch has its own set

Files are stored locally in `.git/contexts/<branch>/` between checkouts.

## How To Use It

This system supports a **Research - Plan - Implement** workflow:

### Phase 1: Research (RESEARCH.md)

Ask your AI assistant to deeply analyze the relevant codebase area and write findings
to `RESEARCH.md`. Verify understanding before moving to planning.

> "Read this folder in depth... write a detailed report of your learnings and findings
> in RESEARCH.md"

### Phase 2: Plan (PLAN.md)

Ask for an implementation plan in `PLAN.md` — approach, code snippets, file paths,
trade-offs. Do NOT implement yet.

**Annotation cycle** (repeat until satisfied):
1. Review PLAN.md in your editor
2. Add inline notes correcting assumptions or adding constraints
3. Tell the AI: "Address all notes, update the plan. Don't implement yet."

### Phase 3: Implement

Once the plan is solid, issue a single implementation command:

> "Implement it all. Mark each task complete in the plan as you go."

### Key Principles

- **Persistent artifacts over chat** — use these files, not conversation memory
- **Human-in-the-loop planning** — the annotation cycle is where your judgment matters
- **Separation of concerns** — research validates understanding, planning validates
  approach, implementation is execution
