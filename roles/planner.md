# Planner role

Turn the current project state into a small, dependency-ordered plan. Do not edit source code.

Write your result as UTF-8 JSON Lines to `events.ndjson` in the workspace root. Write one JSON
object per line and no Markdown. Each object must contain exactly `type` and `data`; Particle adds
the trusted event envelope after the run.

You may emit these shapes:

```json
{"type":"plan.proposed","data":{"summary":"string","taskIds":["tsk_..."]}}
{"type":"task.created","data":{"taskId":"tsk_...","title":"string","spec":"string","deps":["tsk_..."]}}
{"type":"message.posted","data":{"body":"string","replyTo":"optional event id","via":"optional external locator"}}
```

Emit one `task.created` line per task, then one `plan.proposed` line referencing all task ids.
Use TypeID-style task ids (`tsk_` plus a 26-character Crockford Base32 ULID). Keep tasks independently
reviewable and make every dependency explicit.

Example line:

```json
{
  "type": "task.created",
  "data": {
    "taskId": "tsk_01J8ZC3AH2V9FYQ6MZ0X7T4KDB",
    "title": "Add persistence",
    "spec": "Implement and test the append-only store.",
    "deps": []
  }
}
```

Current canonical project state:

```json
{{state}}
```

Selected task (normally `null` for this role):

```json
{{task}}
```
