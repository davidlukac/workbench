# Skills vs Agents

A practical comparison for Workbench terminology. This document assumes [`WhatAreSkills.md`](WhatAreSkills.md) remains the detailed reference for Agent Skills.

---

## Short Answer

If by **Agent** you mean "the text description / system prompt that describes a persona," then you are mostly describing an **agent profile** or **persona definition**, not the runtime agent itself.

The useful distinction is:

| Concept | What it is | Primary question it answers |
|---|---|---|
| **Skill** | A reusable capability package: `SKILL.md` plus optional scripts, templates, examples, schemas, and reference files | "How should the agent do this class of task?" |
| **Agent profile / Persona** | A role definition: system prompt, purpose, tool permissions, model choice, and sometimes MCP servers or memory | "Who should do the work, with what authority and behavior?" |
| **Runtime agent / Subagent** | A live execution instance created from a base model plus instructions, tools, context, and task input | "What is actually running right now?" |
| **Instruction file / Rule** | Persistent prompt context, often scoped by repo, directory, glob, or product settings | "What conventions should always or conditionally apply here?" |
| **Workflow / Command** | A reusable prompt template or explicit runbook, usually manually invoked | "What sequence should I trigger on demand?" |

The confusing part is that many products use "agent" for all three of these:

1. The product itself, such as Codex, Claude Code, Cursor Agent, or Windsurf Cascade.
2. A saved **agent profile**, such as `code-reviewer.md`.
3. A live **subagent instance** spawned to do one task.

For Workbench, use these terms:

- **Persona**: the saved role/system-prompt definition.
- **Agent**: the live worker executing a task.
- **Skill**: the reusable procedure/resource package the worker can load.

---

## Mental Model

An agent is the worker. A skill is a capability the worker can use.

```text
Task
  -> routed to Persona / Agent profile
      -> instantiates Runtime agent
          -> loads relevant Rules / AGENTS.md / project instructions
          -> invokes relevant Skills only when needed
          -> uses Tools / MCP / shell / editor APIs to complete work
```

Example:

- Persona: `backend_engineer`
  - System prompt: "You are a senior backend engineer..."
  - Tool permissions: shell, editor, tests, database MCP
  - Model: high-reasoning coding model
- Skill: `nestjs-api-change`
  - `SKILL.md`: local steps for adding endpoints
  - Supporting files: API conventions, test template, migration checklist
- Runtime agent: the actual backend worker spawned for `task-PROJ-123-001`

The persona decides **role and authority**. The skill provides **task procedure and reusable material**.

---

## Skill vs Agent Profile

| Dimension | Skill | Agent profile / Persona |
|---|---|---|
| Unit of reuse | Capability or procedure | Worker role |
| Typical file | `SKILL.md` in a skill folder | Markdown profile with frontmatter, or config object |
| Content | Steps, examples, scripts, templates, reference docs | System prompt, purpose, tool permissions, model, MCP access |
| Loaded when | Usually by model decision or explicit mention | When selected, assigned, delegated to, or instantiated |
| Context strategy | Progressive disclosure: metadata first, full content only when invoked | Usually full prompt/config at runtime startup |
| Best for | Repeatable work that benefits from bundled files or deterministic scripts | Separating responsibilities: reviewer, planner, backend engineer, security auditor |
| Portability | Increasingly portable through the Agent Skills open standard | Product-specific; no single dominant cross-tool standard |
| Can own tools? | Sometimes can request/preapprove tools, but usually does not define the whole worker | Commonly defines allowed tools, permissions, MCP servers |
| Can have its own context window? | No, not by itself | Often yes when run as a subagent |

The shortest rule:

- Use a **Skill** when you want the same worker to learn a reusable procedure.
- Use an **Agent profile / Persona** when you want a different kind of worker.

---

## What Skills Are Not

Skills are not just long prompts. They are folders with a required `SKILL.md` file and optional supporting files. The important design is **progressive disclosure**:

1. The host exposes only `name` and `description` initially.
2. The full `SKILL.md` is loaded only when relevant.
3. Supporting files and scripts are read or executed only as needed.

That makes Skills good for large, reusable, task-specific capability bundles without paying the full context cost on every turn.

Sources:

- Anthropic describes Skills as modular capabilities that package instructions, metadata, and optional resources, loaded automatically when relevant: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- GitHub describes agent skills as folders of instructions, scripts, and resources that Copilot can load when relevant: https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
- Windsurf describes Cascade Skills as multi-step procedures bundled with supporting files and loaded through progressive disclosure: https://docs.windsurf.com/windsurf/cascade/skills

---

## What Agents Are Not

In this doc, "Agent" does **not** mean "any AI chat session." It means one of:

1. A **runtime worker** with model + context + tools + task.
2. A saved **agent profile/persona** that configures that worker.

Claude Code and GitHub Copilot make this distinction explicit:

- Claude Code subagents are specialized assistants with their own context window, custom system prompt, tool access, and independent permissions.
- GitHub Copilot custom agents are Markdown "agent profiles" that specify prompts, tools, and MCP servers; assigning one to a task instantiates the custom agent.

Sources:

- Claude Code custom subagents: https://code.claude.com/docs/en/sub-agents
- GitHub Copilot custom agents: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-custom-agents

---

## Where AGENTS.md Fits

`AGENTS.md` is badly named for this discussion because it usually does **not** define a named agent profile. In most tools it is closer to a **rule file** or **instruction file**:

- It gives project or directory guidance to whatever agent is active.
- It does not usually create a selectable `backend-engineer` or `security-reviewer` agent by itself.
- It is useful for repository conventions, architecture notes, build commands, and constraints.

Examples:

- Windsurf treats root `AGENTS.md` as always-on rules and subdirectory `AGENTS.md` as location-scoped rules: https://docs.windsurf.com/windsurf/cascade/agents-md
- Cursor treats `AGENTS.md` as a simple Markdown alternative to `.cursor/rules` for project instructions: https://docs.cursor.com/context/rules-for-ai
- Gemini CLI uses `GEMINI.md` context files similarly and can be configured to load `AGENTS.md` as a context filename: https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html
- Codex uses `AGENTS.md` for repository guidance; OpenAI's public skills catalog is separate from that mechanism: https://github.com/openai/codex/blob/main/docs/agents_md.md and https://github.com/openai/skills

So, in Workbench language:

```text
AGENTS.md = ambient project instructions
Persona = named worker profile
Skill = reusable capability package
```

---

## Which Systems Support Agent Profiles?

This table focuses on **saved custom agent/persona profiles**, not whether the product itself is an agent.

| System | Saved custom agent/profile support | Mechanism | Notes |
|---|---:|---|---|
| **Claude Code** | Yes | `.claude/agents/*.md`, `~/.claude/agents/*.md`, `/agents` UI | Strong match for "agent as persona/system prompt." Profiles can define prompt, tools, model, permissions, MCP scope, skills to preload, memory, and hooks. Subagents run in separate context windows. |
| **Claude Code SDK** | Yes | Programmatic agent definitions | Built for custom agents with system prompts, tool permissions, MCP, and session management. |
| **Claude API / Anthropic Messages API** | Partial | Application-defined system prompts + tools | You can build agents, but the generic API does not by itself impose the same filesystem agent-profile convention as Claude Code. |
| **GitHub Copilot cloud agent** | Yes | `.github/agents/*.md` and org/enterprise `.github-private/agents/*.md` | Agent profiles specify prompts, tools, and MCP servers. Available on GitHub.com, issue assignment, PRs, and supported IDE surfaces. |
| **GitHub Copilot CLI** | Yes | `.agent.md` / `.md` agent profiles; `/agent`; `copilot --agent` | Includes built-in agents such as explore, research, task/general-purpose variants, and can run custom agents as subagents. |
| **GitHub Copilot SDK** | Yes | Programmatic custom agents | Supports custom agents with isolated context, tool restrictions, optional MCP servers, delegation, and subagent events. |
| **OpenAI AgentKit / Agents SDK** | Yes | Agent Builder workflows or SDK agent definitions | This is OpenAI's app-building agent framework, separate from Codex's repo instruction files. It supports workflows composed of agents, tools, logic, and handoffs. |
| **OpenAI Codex** | Partial / product-dependent | Codex tasks plus `AGENTS.md`; skills via OpenAI skills catalog | Codex is itself a coding agent and supports project instructions and skills. Public Codex docs do not present a Claude-style `.codex/agents/*.md` custom-agent-profile system. |
| **Cursor** | Partial | Custom Modes; `.cursor/rules`; `AGENTS.md` | Cursor Custom Modes configure tools and instructions for specialized workflows, but Cursor's docs frame these as modes, not named subagent profiles with separate context windows. |
| **Windsurf Cascade** | No clear custom-agent-profile primitive in current docs | Rules, `AGENTS.md`, Workflows, Skills, Modes | Windsurf supports rich customization, but docs distinguish Skills, Rules, Workflows, and `AGENTS.md`; they do not describe a Claude/GitHub-style named custom subagent profile. |
| **Gemini CLI** | No clear custom-agent-profile primitive in current docs | `GEMINI.md` context files and custom commands | Gemini CLI supports persona/context instructions and reusable commands, but these are not the same as named subagent profiles. |

The practical read:

- **Strong custom-agent/profile support**: Claude Code, GitHub Copilot, OpenAI AgentKit / Agents SDK.
- **Agent-like customization but not named subagents**: Cursor Custom Modes.
- **Instruction/rule support, not agent profiles**: Codex `AGENTS.md`, Windsurf `AGENTS.md`, Gemini `GEMINI.md`.
- **Skill support**: Claude, Codex, GitHub Copilot, Windsurf, and many other tools through the Agent Skills open standard.

---

## Which Systems Support Skills?

| System | Skills support | Mechanism |
|---|---:|---|
| **Claude / Anthropic** | Yes | Claude API, Claude.ai, Claude Code custom skills |
| **OpenAI Codex** | Yes | OpenAI skills catalog for Codex; local installed skills in Codex environments |
| **GitHub Copilot** | Yes | Copilot cloud agent, Copilot CLI, and VS Code agent mode |
| **Windsurf Cascade** | Yes | `.windsurf/skills`, global Windsurf skills, `.agents/skills`, optional Claude-compatible skill discovery |
| **Cursor** | Uses rules heavily; Skills support should be verified per current product surface | Cursor docs emphasize Rules, AGENTS.md, and Custom Modes; the broader Agent Skills ecosystem lists Cursor as an adopter, but Cursor's current public docs are clearer about rules than skills. |
| **Gemini CLI** | Not clearly documented as Agent Skills | Supports `GEMINI.md` context files and custom commands; not the same as the Agent Skills folder standard in the docs reviewed. |

---

## Workbench Design Guidance

Workbench should keep **Persona**, **Skill**, and **Task** separate in config and ledger state.

Recommended shape:

```yaml
personas:
  backend_engineer:
    name: Backend Engineer
    system_prompt: |
      You are a senior backend engineer...
    tools:
      - shell
      - editor
      - tests
    skills:
      - api-change
      - test-writing

skills:
  api-change:
    name: api-change
    required: false
  test-writing:
    name: test-writing
    required: false
```

Task routing should choose a **persona** first, then attach skill hints:

```json
{
  "task_id": "task-PROJ-123-001",
  "persona": "backend_engineer",
  "skill_hints": ["api-change", "test-writing"]
}
```

That keeps the architecture portable:

- In Claude Code, a Workbench persona can map to `.claude/agents/backend-engineer.md`.
- In GitHub Copilot, it can map to `.github/agents/backend-engineer.md`.
- In Codex, Cursor, Windsurf, or Gemini, the same persona may need to be rendered as prompt context, a mode, a rule, or direct instructions if named agent profiles are unavailable.
- Skills can stay closer to the open Agent Skills format and be reused across more hosts.

---

## Spawning Subagents and Passing Context

This section answers the operational questions that matter for Workbench dispatch:

1. Who decides to spawn a worker?
2. Which persona/profile does it use?
3. What instructions and context does the spawned worker actually receive?
4. Can workers run serially, in parallel, or communicate with each other?

### Claude Code

Claude Code is the clearest implementation of named subagents.

| Question | Claude Code behavior |
|---|---|
| How is a subagent spawned? | Through the `Agent` tool, automatic delegation, explicit natural-language request, `@agent-name` mention, a skill with `context: fork`, `claude --agent <name>`, or experimental agent teams. Older docs/settings may call the same tool `Task`; newer docs say it was renamed to `Agent` in v2.1.63. |
| How is the persona selected? | Claude matches the task against each subagent's `description`, or the user forces a specific one with `@agent-name`, natural language, `--agent`, or a skill's `agent:` field. |
| Where is the persona defined? | `.claude/agents/*.md`, `~/.claude/agents/*.md`, managed settings, plugin `agents/`, or a session-local `--agents` JSON definition. The Markdown body is the subagent's system prompt. |
| What does a named subagent receive? | A fresh context with the subagent prompt, selected tools, model, permissions, working directory, project context such as `CLAUDE.md`, and the delegation message Claude writes for that task. It does **not** receive the full main conversation history by default. |
| What does a skill-spawned subagent receive? | For `context: fork`, the skill content becomes the task prompt. The `agent:` field chooses the execution environment. Claude docs explicitly warn that this does not include conversation history, so the skill must contain an actionable task, not just passive guidelines. |
| Can skills be attached to subagents? | Yes. A subagent can list `skills:` to preload full skill content at startup. It can also invoke available skills through the Skill tool unless restricted. |
| Can multiple subagents run? | Yes. Claude supports serial chains, parallel subagents, foreground/background execution, and experimental forks. |
| Can subagents spawn subagents? | No. Claude docs state subagents cannot spawn other subagents. Chaining must be coordinated by the main conversation. |
| Can a subagent be resumed? | Yes, in the newer subagent flow. Each invocation starts fresh, but Claude can resume a previous subagent by agent ID; its transcript persists separately from the main conversation. |
| Can workers communicate with each other? | Ordinary subagents report back to the main agent only. Experimental agent teams add independent Claude Code sessions, a shared task list, direct teammate messaging, and a mailbox. |

Claude-specific implications for Workbench:

- For **normal dispatch**, map Workbench personas to Claude subagent definitions.
- For **isolated one-shot procedures**, map Workbench workflows or skills to Claude Skills with `context: fork`.
- For **parallel workers that need to talk**, use Claude agent teams, not ordinary subagents.
- For **parallel workers that only return summaries**, ordinary subagents are enough.
- The task prompt must carry task-specific context: files, acceptance criteria, constraints, dependencies, and expected output. A named subagent will not automatically know all previous orchestrator discussion.

Key Claude sources:

- Custom subagents: https://code.claude.com/docs/en/subagents
- Skills running in subagents: https://code.claude.com/docs/en/skills
- Agent teams: https://code.claude.com/docs/en/agent-teams
- Agent SDK subagents: https://code.claude.com/docs/en/agent-sdk/subagents

### Windsurf Cascade

Windsurf should be treated differently. Current Windsurf docs describe **Cascade modes, rules, `AGENTS.md`, workflows, skills, and memories**, but they do not document a Claude-style named subagent profile system or first-class multi-subagent spawning model.

| Question | Windsurf behavior |
|---|---|
| How is another persona spawned? | Not clearly supported as named subagents in current public docs. Cascade runs as the active agentic assistant. You can change behavior through Mode, Rules, `AGENTS.md`, Workflows, Skills, and Memories. |
| How is persona/context selected? | Rules can be always-on, glob-scoped, model-selected, or manual. `AGENTS.md` files become location-scoped rules. Workflows are manual slash commands. Skills are model-invoked or `@skill-name` mentioned. |
| What does Cascade receive? | The active Cascade mode plus relevant rules, `AGENTS.md`, memories, workflow text, and invoked skill content. Skills use progressive disclosure: only name/description by default, full content and resources when invoked. |
| Can multiple subagents run in parallel? | No documented Claude-like subagent or agent-team primitive in the reviewed Windsurf docs. Treat parallelism as outside the host primitive unless Windsurf adds a documented feature. |
| Can a workflow call other workflows? | Yes. Windsurf docs say workflows can include instructions to call other workflows, processed sequentially. |
| Can skills act like workers? | They can guide complex multi-step work and load supporting files, but they run inside Cascade rather than creating a documented separate worker context. |

Windsurf-specific implications for Workbench:

- Render a Workbench **persona** as explicit prompt context, a Mode choice, rules, or a workflow instruction rather than assuming a named subagent exists.
- Use Windsurf **Skills** for reusable procedures with supporting files.
- Use Windsurf **Workflows** for manually triggered runbooks.
- Use `AGENTS.md` or `.windsurf/rules` for ambient project/persona constraints.
- If Workbench needs actual parallel workers in Windsurf, the portable mechanism is external orchestration through Workbench/MCP/CLI state, not a documented Cascade subagent primitive.

Key Windsurf sources:

- Memories, Rules, Workflows, Skills comparison: https://docs.windsurf.com/windsurf/cascade/memories
- Skills: https://docs.windsurf.com/windsurf/cascade/skills
- Workflows: https://docs.windsurf.com/windsurf/cascade/workflows
- AGENTS.md: https://docs.windsurf.com/windsurf/cascade/agents-md
- Modes: https://docs.windsurf.com/windsurf/cascade/modes

### OpenAI Codex

Codex needs two separate interpretations:

1. **Codex product / cloud tasks / local coding agent**: a coding agent surface for working on repositories.
2. **OpenAI Agents SDK / AgentKit**: a developer framework for building multi-agent applications.

Those are related but not the same product surface.

| Question | Codex product behavior |
|---|---|
| How is work spawned? | A user delegates a Codex task from web, IDE, mobile, GitHub `@codex`, or local Codex clients. Codex cloud provisions a sandboxed container per task. |
| Can multiple tasks run? | Yes. OpenAI docs say Codex cloud can work in the background on many tasks in parallel, with each task using its own environment. |
| How is persona selected? | Public Codex docs emphasize prompts, repository instructions such as `AGENTS.md`, environment configuration, and skills. They do not document a Claude-style `.codex/agents/*.md` named subagent profile system. |
| What context does a task receive? | The task prompt, repository checkout, environment setup, accessible instructions such as `AGENTS.md`, configured tools/MCP, and any provided diffs/images/issues. A cloud task is isolated to its container/task environment. |
| Can Codex subagents communicate? | Not as a documented Codex product primitive. Multiple Codex cloud tasks are independent background tasks unless an external system coordinates them. |

Codex-specific implications for Workbench:

- Treat Codex cloud tasks as **independent workers**, not as nested subagents inside one main thread.
- Render Workbench persona instructions into the task prompt and/or repo instruction files.
- Use `AGENTS.md` for ambient repo guidance, not named persona selection.
- Use Skills for reusable procedures where available.
- For parallel Workbench execution, create multiple Codex tasks or local Codex sessions and coordinate through Workbench's ledger/MCP, not through a documented native subagent messaging system.

OpenAI Agents SDK / AgentKit has a stronger multi-agent model:

| Pattern | Behavior |
|---|---|
| Agents as tools | A manager agent keeps control and calls specialist agents as tools. Good when the manager should synthesize outputs. |
| Handoffs | A triage/manager agent delegates to a specialist that becomes the active agent for the next part of the interaction. Good when the specialist should own the user-facing response. |
| Code orchestration | Application code can chain agents, run evaluator loops, or run independent agents in parallel with normal language/runtime primitives such as `Promise.all`. |
| Handoff context | By default, a handoff can pass conversation history; `inputFilter` can modify what the receiving agent sees. |

OpenAI-specific implications for Workbench:

- For Codex **as a tool users operate**, use prompt/context rendering plus external task coordination.
- For a Workbench **agent orchestration engine built on OpenAI**, Agents SDK maps closely to Workbench personas: each persona can become an `Agent` with instructions, tools, handoffs, and optional structured context.

Key OpenAI sources:

- Codex cloud: https://platform.openai.com/docs/codex/overview
- OpenAI code generation / Codex: https://platform.openai.com/docs/guides/code-generation
- OpenAI skills catalog for Codex: https://github.com/openai/skills
- Agent Builder: https://platform.openai.com/docs/guides/agent-builder
- Agents SDK: https://platform.openai.com/docs/guides/agents-sdk
- Agents SDK orchestration: https://openai.github.io/openai-agents-js/guides/multi-agent/
- Agents SDK handoffs: https://openai.github.io/openai-agents-js/guides/handoffs/

### Secondary Systems

| System | Spawning / context notes |
|---|---|
| **GitHub Copilot cloud agent** | Supports custom agents in `.github/agents/*.md`; assigning an issue/PR/task to an agent starts work under that profile. Copilot CLI and SDK also support custom agents and multi-agent composition. |
| **Cursor** | Custom Modes provide specialized tool/instruction profiles, while rules and `AGENTS.md` provide persistent context. Public docs are clearer about modes/rules than named subagent spawning. |
| **Gemini CLI** | `GEMINI.md` files and custom commands provide context and reusable procedures. Current reviewed docs do not describe named subagent profiles equivalent to Claude subagents. |

---

## Workbench Dispatch Model

Workbench should not assume every host can spawn subagents the same way. Treat spawning as an adapter-specific capability.

Recommended portable model:

```text
Workbench task
  -> persona key
  -> skill hints
  -> context pack
  -> host adapter chooses execution strategy
```

The **context pack** should be explicit because most worker types do not inherit the orchestrator's full conversation.

Minimum context pack:

- Task ID, title, and exact requested outcome
- Acceptance criteria references
- Relevant files/directories
- Dependencies and blocked/unblocked state
- Persona key and rendered persona instructions
- Skill hints or required skill names
- Constraints: no-go files, test expectations, permission limits
- Required response shape: summary, changed files, tests, risks, evidence

Host adapter mapping:

| Host | Preferred Workbench mapping |
|---|---|
| Claude Code | Persona -> `.claude/agents/<persona>.md`; task -> Agent delegation prompt; reusable procedures -> Skills; peer communication -> agent teams when enabled |
| Windsurf Cascade | Persona -> prompt/rule/workflow context; task -> Cascade prompt; reusable procedures -> Skills; parallelism -> external Workbench orchestration |
| Codex product | Persona -> task prompt + `AGENTS.md`/instructions; task -> independent Codex task/session; reusable procedures -> Skills; parallelism -> multiple tasks coordinated externally |
| OpenAI Agents SDK | Persona -> `Agent` object; task -> run input; delegation -> agents-as-tools or handoffs; parallelism -> application code |

Serial/parallel guidance:

- Use **serial** dispatch when later work depends on earlier outputs, tasks touch the same files, or review must gate implementation.
- Use **parallel** dispatch when tasks have disjoint files, independent hypotheses, or different review lenses.
- Use **follow-up/resume** only when the host preserves worker state. Claude subagents can be resumed by agent ID; Codex cloud tasks usually get follow-up task prompts rather than nested subagent continuation; Windsurf depends on the same Cascade conversation or external state.
- Use **direct worker communication** only where the host supports it. Claude agent teams support it; ordinary Claude subagents, Windsurf Cascade, and Codex product tasks should communicate through the orchestrator or Workbench ledger.

---

## Decision Rules

Use a **Persona / Agent profile** when:

- The worker needs a stable role, stance, or responsibility boundary.
- It should have different tool permissions.
- It should run in a separate context window.
- It should be selected by planner/router logic.
- It maps to a durable Workbench role like planner, backend engineer, frontend engineer, reviewer, security auditor, or docs writer.

Use a **Skill** when:

- The same procedure should be reusable across personas.
- The procedure needs bundled scripts, templates, schemas, examples, or long references.
- The agent should load it only when relevant.
- You want cross-tool portability through the Agent Skills standard.

Use **Rules / AGENTS.md** when:

- The instruction should apply broadly to a repo or directory.
- It is short enough to be ambient context.
- It expresses conventions, constraints, build commands, or style rules.

Use a **Workflow / Command** when:

- A human should explicitly trigger the procedure.
- It is a repeatable runbook rather than an automatically selected capability.
- You do not need supporting files or progressive disclosure.

---

## Sources Reviewed

- Anthropic Agent Skills overview: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- Claude Code custom subagents: https://code.claude.com/docs/en/sub-agents
- Claude Code agent teams: https://code.claude.com/docs/en/agent-teams
- Claude Code Agent SDK overview: https://code.claude.com/docs/en/agent-sdk/overview
- Claude Code Agent SDK subagents: https://code.claude.com/docs/en/agent-sdk/subagents
- GitHub Copilot agent skills: https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
- GitHub Copilot custom agents: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-custom-agents
- GitHub Copilot CLI custom agents: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli
- GitHub Copilot SDK custom agents: https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/custom-agents
- OpenAI Codex overview: https://platform.openai.com/docs/codex/overview
- OpenAI code generation / Codex models: https://platform.openai.com/docs/guides/code-generation
- OpenAI skills catalog for Codex: https://github.com/openai/skills
- OpenAI Agent Builder: https://platform.openai.com/docs/guides/agent-builder
- OpenAI Agents SDK: https://platform.openai.com/docs/guides/agents-sdk
- OpenAI Agents SDK orchestration: https://openai.github.io/openai-agents-js/guides/multi-agent/
- OpenAI Agents SDK handoffs: https://openai.github.io/openai-agents-js/guides/handoffs/
- Cursor Rules / AGENTS.md: https://docs.cursor.com/context/rules-for-ai
- Cursor Modes: https://docs.cursor.com/en/agent/modes
- Windsurf Skills: https://docs.windsurf.com/windsurf/cascade/skills
- Windsurf AGENTS.md: https://docs.windsurf.com/windsurf/cascade/agents-md
- Windsurf Memories & Rules: https://docs.windsurf.com/windsurf/cascade/memories
- Gemini CLI context files: https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html
- Gemini CLI custom commands: https://google-gemini.github.io/gemini-cli/docs/cli/custom-commands.html
