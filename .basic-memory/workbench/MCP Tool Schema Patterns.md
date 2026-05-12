---
title: MCP Tool Schema Patterns
type: guide
permalink: workbench/mcp-tool-schema-patterns
tags:
- mcp
- tools
- zod
- schema
- implementation
---

# MCP Tool Schema Patterns

Lessons from `update_spec` schema and error messaging work — 2026-05-11.

## Use typed partial objects, not `z.record`, for structured inputs

**Anti-pattern:**
```ts
fields: z.record(z.string(), z.unknown())
```
Exposes `{ type: "object" }` to MCP clients — no property-level schema, no client-side hints, no SDK validation.

**Correct pattern:**
```ts
fields: z
  .object({
    story_id: z.string().min(1),
    background: z.string().min(1),
    acceptance_criteria: z.array(acceptanceCriterionSchema),
    // ...
  })
  .partial()       // all fields optional — partial update semantics
  .passthrough()   // unknown keys flow through to the handler for graceful rejection
```

Benefits:
- MCP clients receive full nested JSON Schema (property names, types, required fields on sub-objects)
- SDK validates known fields before the handler runs — structured JSON-RPC errors with full path arrays
- `.passthrough()` preserves unknown keys so the handler can push them to `rejected[]` with `"unknown field"`

## SDK validation fires before the handler

With a typed schema, a malformed `acceptance_criteria` item returns a `-32602` MCP error with a structured `path` array (e.g. `["fields", "acceptance_criteria", 0, "criterion"]`) and lists **all** failing issues at once — before the handler is called. The in-handler `SPEC_FIELD_VALIDATORS` safeParse loop is now defence-in-depth only for known fields; its primary role is the unknown-key check.

## In-handler rejection error messages — include the path

When building `rejected[]` entries from a `safeParse` failure, map all issues and include the field path:

```ts
const reason = parsed.error.issues
  .map((i) => {
    const path = i.path.length > 0 ? `${i.path.join(".")}: ` : "";
    return `${path}${i.message}`;
  })
  .join("; ");
```

Without this, the caller sees `"Invalid input: expected string, received undefined"` with no indication of which sub-field failed.

## MCP server restart required after rebuild

The MCP server subprocess loads `dist/` at startup. `src/` edits + `npm run build` do **not** hot-reload. Changes only take effect after the server process is restarted (via `/mcp` restart or session restart in Claude Code).

## Relations
- [[MCP Server Reference]]
- [[Tech Stack]]
