# CLAUDE.md

## Session start: invoke the `using-superpowers` skill

At the very beginning of every session, before responding to the user (including
before asking clarifying questions), invoke the `using-superpowers` skill via
the `Skill` tool:

```
Skill(skill="using-superpowers")
```

This loads the Superpowers skills framework and tells you how to discover and
apply the other skills available under `.claude/skills/`. If a skill applies to
the task at hand, you must use it.

## Available superpowers skills

The following skills are installed in `.claude/skills/` (sourced from
[obra/superpowers](https://github.com/obra/superpowers), MIT-licensed):

- `using-superpowers` — entry point; how to find and use skills
- `brainstorming` — Socratic design refinement
- `writing-plans` — detailed implementation planning
- `executing-plans` — batch execution with checkpoints
- `test-driven-development` — RED-GREEN-REFACTOR with anti-patterns reference
- `systematic-debugging` — 4-phase root cause analysis
- `verification-before-completion` — validate fixes before declaring done
- `requesting-code-review` — pre-review checklist
- `receiving-code-review` — feedback response workflow
- `dispatching-parallel-agents` — concurrent subagent workflows
- `subagent-driven-development` — fast iteration with two-stage review
- `using-git-worktrees` — parallel development branches
- `finishing-a-development-branch` — merge/PR decision workflow
- `writing-skills` — author new skills

Always prefer invoking the matching skill over improvising.
