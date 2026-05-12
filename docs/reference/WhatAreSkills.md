# What Are Agent Skills?

A reference document covering the Agent Skills open standard: what they are, how they are structured, how they work, and platform-specific details for Claude Code.

---

## Overview

**Agent Skills** are a lightweight, open format for extending AI agent capabilities with specialized knowledge and workflows. Originally developed by Anthropic, the format was released as an open standard and is now adopted by dozens of AI coding tools (Claude Code, Cursor, GitHub Copilot, Gemini CLI, OpenCode, Windsurf, VS Code, Junie, OpenHands, and many more).

A Skill is a **folder** containing a `SKILL.md` file. That file includes metadata (`name` and `description`) and instructions that tell an agent how to perform a specific task. The folder can also bundle scripts, reference materials, templates, and other resources.

For the distinction between Skills, agent profiles/personas, runtime agents, rules, `AGENTS.md`, and workflows, see [`SkillsVsAgents.md`](SkillsVsAgents.md).

Reference: https://agentskills.io — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview

---

## The Core Problem Skills Solve

Agents are increasingly capable but often lack the context they need to do real work reliably. Skills solve this by packaging:

- **Procedural knowledge**: multi-step workflows, edge-case handling, validation loops
- **Domain expertise**: legal review flows, data pipelines, presentation standards, company conventions
- **Organizational context**: team-specific patterns, naming conventions, schema definitions

Skills are portable, version-controllable, and shareable. Because they follow an open standard, a Skill written once works across any compatible agent product.

---

## How Skills Work: Progressive Disclosure

Skills use a three-stage **progressive disclosure** loading strategy, so many skills can be installed with minimal context overhead:

| Level | When Loaded | Token Cost | Content |
|---|---|---|---|
| **1: Metadata** | Always, at startup | ~100 tokens per Skill | `name` and `description` from YAML frontmatter |
| **2: Instructions** | When the Skill is triggered | <5,000 tokens recommended | Full `SKILL.md` body |
| **3: Resources** | As needed within the task | Effectively unlimited | Bundled files loaded or scripts executed via bash |

### Stage-by-stage

1. **Discovery** — At startup the agent loads only the `name` and `description` of every available skill into the system prompt. This lets the model know what skills exist and when they might apply, at minimal token cost.

2. **Activation** — When a user request matches a skill's description (or the user explicitly invokes `/skill-name`), the agent reads the full `SKILL.md` body into context.

3. **Execution** — As the agent works through the instructions, it loads referenced files or runs bundled scripts on demand. Scripts execute via bash; only their *output* enters context, not the script source.

This architecture means you can bundle large API docs, schemas, and reference files without a context penalty until they are actually needed.

---

## Directory Structure

```
skill-name/            # Directory name = skill identifier
├── SKILL.md           # Required: YAML frontmatter + markdown instructions
├── scripts/           # Optional: executable code (Python, Bash, JS, etc.)
├── references/        # Optional: detailed docs, schemas, API references
├── assets/            # Optional: templates, images, data files
└── ...                # Any additional files
```

The `SKILL.md` file is the single required file. Everything else is optional supporting material.

---

## `SKILL.md` Format

Every `SKILL.md` file must contain **YAML frontmatter** followed by **Markdown content**.

```markdown
---
name: pdf-processing
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
---

# PDF Processing

## Quick start

Use pdfplumber to extract text:

```python
import pdfplumber
with pdfplumber.open("document.pdf") as pdf:
    text = pdf.pages[0].extract_text()
```

For form filling, see [FORMS.md](FORMS.md).
For API details, see [REFERENCE.md](REFERENCE.md).
```

### Frontmatter Fields (Open Standard)

| Field | Required | Constraints | Purpose |
|---|---|---|---|
| `name` | **Yes** | 1–64 chars. Lowercase, numbers, hyphens only. No leading/trailing/consecutive hyphens. Must match directory name. | Unique identifier for the skill |
| `description` | **Yes** | 1–1,024 chars. Non-empty. | Describes what the skill does AND when to use it. Critical for discovery. |
| `license` | No | Short string or reference to bundled file | License terms for shared/published skills |
| `compatibility` | No | 1–500 chars | Environment requirements (platform, packages, network) |
| `metadata` | No | Arbitrary key-value map | Additional metadata (author, version, etc.) |
| `allowed-tools` | No | Space-separated string | Pre-approved tools the skill may use (experimental) |

### Name Field Rules

```yaml
# Valid
name: pdf-processing
name: data-analysis
name: code-review

# Invalid
name: PDF-Processing     # uppercase not allowed
name: -pdf               # cannot start with hyphen
name: pdf--processing    # consecutive hyphens not allowed
```

### Description Field — The Key to Discovery

The description is the most important field. It drives both automatic activation (model decides) and serves as the human-readable label. Best practices:

- Include **what** the skill does and **when** to use it
- Use **third person** (the description is injected into the system prompt)
- Include **specific keywords** that map to natural user requests
- Maximum 1,024 characters

```yaml
# Good — specific, includes triggers
description: Analyzes Excel spreadsheets, creates pivot tables, generates charts. Use when analyzing Excel files, spreadsheets, tabular data, or .xlsx files.

# Bad — too vague
description: Helps with documents
```

### Body Content

The body is plain Markdown with no format restrictions. Recommended sections:

- Step-by-step instructions
- Quick-start code examples
- References to bundled files for deeper detail
- Common edge cases

**Keep it under 500 lines.** Move detailed reference material to separate linked files.

---

## Supporting Files

Supporting files extend a skill without bloating `SKILL.md`. They are loaded by the agent only when referenced and accessed.

```
pdf-skill/
├── SKILL.md              # Overview + quick-start (loaded when triggered)
├── FORMS.md              # Form-filling guide (loaded only when needed)
├── REFERENCE.md          # Full API reference (loaded only when needed)
├── examples.md           # Usage examples
└── scripts/
    ├── analyze_form.py   # Executed via bash; only output enters context
    ├── fill_form.py
    └── validate.py
```

Reference supporting files from `SKILL.md` using relative paths:

```markdown
For form filling, see [FORMS.md](FORMS.md).
Run field extraction: `scripts/analyze_form.py input.pdf`
```

### Rules for Supporting Files

- **Keep references one level deep** from `SKILL.md`. Nested reference chains (`SKILL.md → A.md → B.md`) cause the agent to partially read files.
- **Name files descriptively**: `form_validation_rules.md` not `doc2.md`.
- **Always use forward slashes** in paths, even on Windows.
- For reference files longer than 100 lines, include a **table of contents** at the top.
- Scripts that run deterministically are more reliable than asking the model to generate equivalent code on the fly.

---

## Where Skills Live

### Claude Code (filesystem-based)

| Scope | Path | Applies to |
|---|---|---|
| Enterprise / managed | See managed settings docs | All users in the org |
| Personal | `~/.claude/skills/<skill-name>/SKILL.md` | All your projects |
| Project | `.claude/skills/<skill-name>/SKILL.md` | This project only |
| Plugin | `<plugin>/skills/<skill-name>/SKILL.md` | Where plugin is enabled |

When skills share the same name across levels, the priority is: **enterprise > personal > project**. Plugin skills use a `plugin-name:skill-name` namespace to avoid conflicts.

Claude Code also supports legacy `.claude/commands/<name>.md` files — these work identically to a skill but without the supporting-files directory. If both a command and a skill share the same name, the skill takes precedence.

### Claude API

Skills are uploaded via the `/v1/skills` endpoints and are **workspace-wide** (all workspace members share them). Reference them via `skill_id` in the `container` parameter. Requires beta headers: `code-execution-2025-08-25`, `skills-2025-10-02`, and `files-api-2025-04-14`.

### Claude.ai

Custom skills are uploaded as zip files via Settings > Features. They are **per-user only** (not org-wide). Available on Pro, Max, Team, and Enterprise plans with code execution enabled.

**Note:** Skills do not sync across surfaces. A skill uploaded to Claude.ai is not automatically available in Claude Code or via the API.

---

## Invocation Methods

### Automatic (model-driven)

The agent monitors conversation content and matches it against skill descriptions. When a request aligns with a skill's description, the agent loads and applies it automatically. This is why the description field must be specific and keyword-rich.

### Manual (user-driven)

Type `/skill-name` in chat to invoke a skill directly, regardless of whether the model would have triggered it automatically.

### Windsurf / Cascade

Both automatic invocation (description match) and explicit `@skill-name` mention in the chat input.

---

## Claude Code Extended Frontmatter

Claude Code adds its own frontmatter fields beyond the open standard:

| Field | Default | Purpose |
|---|---|---|
| `disable-model-invocation` | `false` | `true` = only the user can invoke (prevents auto-trigger). Good for `/deploy`, `/commit`. Also prevents the skill from being preloaded into subagents. |
| `user-invocable` | `true` | `false` = hidden from `/` menu; Claude can still invoke it. Good for background reference context. |
| `when_to_use` | — | Additional context for when Claude should invoke (appended to `description` in the listing). |
| `argument-hint` | — | Hint shown in autocomplete, e.g. `[issue-number]`. |
| `arguments` | — | Named positional arguments for `$name` substitution. |
| `allowed-tools` | — | Tools pre-approved without per-use confirmation while this skill is active. |
| `model` | inherit | Model override for the skill's turn. |
| `effort` | inherit | Effort level override: `low`, `medium`, `high`, `xhigh`, `max`. |
| `context` | — | `fork` = run in an isolated subagent context. |
| `agent` | `general-purpose` | Which subagent type to use with `context: fork`. |
| `hooks` | — | Lifecycle hooks scoped to this skill. |
| `paths` | — | Glob patterns: limits when Claude auto-activates (only when working with matching files). |
| `shell` | `bash` | Shell for `!` inline commands: `bash` or `powershell`. |

### Invocation Control Matrix

| Frontmatter | User can invoke | Claude can invoke | Description in system prompt |
|---|---|---|---|
| (default) | Yes | Yes | Yes |
| `disable-model-invocation: true` | Yes | No | No |
| `user-invocable: false` | No | Yes | Yes |

---

## Claude Code Special Features

### String Substitutions

| Variable | Description |
|---|---|
| `$ARGUMENTS` | Everything typed after the skill name |
| `$ARGUMENTS[N]` | Nth argument by 0-based index |
| `$N` | Shorthand for `$ARGUMENTS[N]` |
| `$name` | Named argument declared in `arguments` frontmatter |
| `${CLAUDE_SESSION_ID}` | Current session ID |
| `${CLAUDE_EFFORT}` | Current effort level string |
| `${CLAUDE_SKILL_DIR}` | Absolute path to the skill's directory |

Example:
```yaml
---
name: fix-issue
description: Fix a GitHub issue by number
disable-model-invocation: true
---

Fix GitHub issue $ARGUMENTS following our coding standards.
1. Read the issue
2. Implement the fix
3. Write tests
4. Create a commit
```
Invoked as `/fix-issue 123` → `$ARGUMENTS` becomes `123`.

### Dynamic Context Injection (Shell Preprocessing)

The `` !`<command>` `` syntax runs a shell command **before** the skill content is sent to Claude. The output replaces the placeholder inline.

```markdown
## Current changes
!`git diff HEAD`

## Instructions
Summarize the changes above and flag anything risky.
```

Multi-line version uses a fenced block opened with ` ```! `:
````markdown
## Environment
```!
node --version
npm --version
git status --short
```
````

This is **preprocessing**, not something Claude executes. Claude only sees the rendered output.

Can be disabled org-wide with `"disableSkillShellExecution": true` in managed settings.

### Subagent Execution (`context: fork`)

Adding `context: fork` runs the skill in an isolated subagent with no access to the current conversation history:

```yaml
---
name: deep-research
description: Research a topic thoroughly using codebase exploration
context: fork
agent: Explore
---

Research $ARGUMENTS:
1. Find relevant files with Glob and Grep
2. Read and analyze the code
3. Summarize findings with specific file references
```

Built-in agent types: `Explore`, `Plan`, `general-purpose`. Can also use any custom subagent defined in `.claude/agents/`.

### Skill Content Lifecycle

When invoked, rendered `SKILL.md` content enters the conversation as a single message and persists for the rest of the session. On auto-compaction, Claude Code re-attaches the most recent invocation of each skill (first 5,000 tokens each, combined budget of 25,000 tokens), prioritizing the most recently invoked skills.

---

## Pre-Built Skills (Claude Platform)

Anthropic provides ready-to-use skills for document workflows:

| Skill ID | Capability |
|---|---|
| `pptx` | Create and edit PowerPoint presentations |
| `xlsx` | Create spreadsheets, charts, pivot tables |
| `docx` | Create and edit Word documents |
| `pdf` | Generate formatted PDF documents |

Also open-sourced in the [skills repository](https://github.com/anthropics/skills): a **Claude API** skill bundling current API reference, SDK docs, and best practices for 8 languages.

---

## Best Practices

### Writing Skills

- **Concise is key**: Only add context Claude doesn't already have. Every token in `SKILL.md` is a recurring cost once loaded.
- **Description in third person**: It's injected into the system prompt; first person breaks the POV.
- **Include triggers in description**: "Use when..." clauses help the model know when to activate.
- **Set appropriate freedom**: Exact scripts for fragile, sequenced operations. High-level instructions for tasks where multiple approaches are valid.
- **Avoid time-sensitive information**: No "before August 2025 use the old API" type content. Use an "old patterns / deprecated" section pattern instead.
- **Consistent terminology**: Pick one word and stick to it (`extract`, not sometimes `pull`, sometimes `get`).
- **Feedback loops**: Build validate-fix-repeat cycles into complex workflows to catch errors early.

### Workflow Structure

For complex tasks, provide a checklist Claude copies and checks off:

```markdown
Task progress:
- [ ] Step 1: Analyze the form
- [ ] Step 2: Create field mapping
- [ ] Step 3: Validate mapping
- [ ] Step 4: Fill form
- [ ] Step 5: Verify output
```

### Testing

- Test with all model tiers you plan to use (Haiku needs more guidance than Opus).
- Build evaluations **before** writing extensive documentation.
- Use a "Claude A / Claude B" pattern: Claude A helps refine the skill, Claude B tests it in real tasks.
- Minimum three evaluation scenarios before sharing a skill.

### Anti-patterns to Avoid

| Anti-pattern | Fix |
|---|---|
| Too many library choices offered | Pick one default, mention alternative only for edge cases |
| Windows-style paths (`\`) | Always use forward slashes (`/`) |
| Magic constants in scripts | Document every constant with a brief why |
| Deeply nested file references | Keep all references one level deep from `SKILL.md` |
| Generic description | Include specific verbs and domain keywords |
| Time-sensitive inline content | Move to a "deprecated/legacy" section |

---

## Security Considerations

Skills execute code and read files in the agent's environment. Treat them like installing software.

- **Only use skills from trusted sources** (yourself, your team, or Anthropic's official repository).
- **Audit all files** before use: `SKILL.md`, any scripts, images, and resource files. Look for unexpected network calls, file access patterns, or operations that don't match the stated purpose.
- **External URL fetching is particularly risky**: fetched content may contain injected instructions, and the fetched resource can change after you audit it.
- **Bundled scripts can invoke any tool** the agent has access to — file system, bash, code execution. A malicious skill can exfiltrate data, modify files, or make network calls.
- In Claude Code, project skills in `.claude/skills/` take effect after accepting the workspace trust dialog. Review skills before trusting a repo.

---

## Runtime Environment Constraints

| Platform | Network | Package install |
|---|---|---|
| Claude.ai | Varies by user/admin settings | Yes (npm, PyPI, GitHub) |
| Claude API | **None** | **No** — pre-installed packages only |
| Claude Code | Full (same as user's machine) | Allowed locally; avoid global installs |

---

## Checklist Before Publishing a Skill

**Structure**
- [ ] `name` matches directory name, lowercase letters/numbers/hyphens only
- [ ] `description` is specific, keyword-rich, uses third person, includes "Use when..."
- [ ] `SKILL.md` body is under 500 lines
- [ ] Detailed material extracted to separate referenced files
- [ ] All file references are one level deep
- [ ] Only forward slashes in paths

**Content quality**
- [ ] No time-sensitive information
- [ ] Consistent terminology throughout
- [ ] Examples are concrete, not abstract
- [ ] Scripts handle errors explicitly (no punting to the model)
- [ ] Required packages listed and verified available
- [ ] Feedback/validation loops included where applicable

**Testing**
- [ ] At least three evaluation scenarios created
- [ ] Tested with Haiku, Sonnet, and Opus (or equivalents)
- [ ] Tested with real-world usage scenarios
- [ ] Team feedback incorporated

---

## Ecosystem

As of 2025, the Agent Skills standard is supported by: Claude Code, Claude.ai, Cursor, GitHub Copilot, VS Code, Gemini CLI, Windsurf (Cascade), Junie (JetBrains), OpenCode, OpenHands, Amp, Letta, Goose, Roo Code, OpenAI Codex, Databricks Genie Code, Snowflake Cortex Code, Laravel Boost, Spring AI, and many others.

The standard is maintained openly at https://github.com/agentskills/agentskills.

---

## Quick Reference: Minimal Skill

```
~/.claude/skills/my-skill/SKILL.md
```

```markdown
---
name: my-skill
description: What this skill does and when to use it. Use when the user asks about X or mentions Y.
---

# My Skill

## Instructions

Step 1: ...
Step 2: ...

## Notes

For edge case A, see [edge-cases.md](edge-cases.md).
```

Invoke with `/my-skill` or let Claude auto-activate when relevant.
