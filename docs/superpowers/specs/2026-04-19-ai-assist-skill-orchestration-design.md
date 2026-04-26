# AI Assist Skill Orchestration Design

## Goal

Make AI Assist materially smarter for common TaiGer workflows by introducing explicit skill-aware orchestration instead of relying only on free-form model tool selection.

The target user experience is:

- users can mention one student with `@student_name`
- users can request a fixed skill with `#skill`
- the backend executes stable, testable skill pipelines for common cases
- when no skill is defined, AI Assist still falls back to automatic intent handling instead of failing

## Scope

This design covers:

- backend orchestration in `TaiGerPortalService/services/ai-assist/orchestrator.js`
- backend request handling in `TaiGerPortalService/controllers/ai_assist.js`
- AI Assist tool definitions and execution contracts in `TaiGerPortalService/services/ai-assist`
- frontend AI Assist composer behavior in `TaiGerPortalStaticWebsite/src/pages/AIAssist/AIAssistPage.tsx`

In scope:

- fixed v1 skill model
- frontend `@student` and `#skill` interaction
- structured request context from frontend to backend
- skill-mode execution plans
- general-mode fallback behavior
- skill-level trace visibility

Out of scope:

- multi-student message handling
- user-defined custom skills
- streaming responses
- broad redesign of the AI Assist page outside the composer and transcript trust surfaces
- replacing the existing read-only TaiGer tool registry

## Product Decisions

### 1. Fixed v1 skills

V1 will support exactly four first-class skills:

- `summarize_student`
- `identify_risk`
- `review_messages`
- `review_open_tasks`

These are backend-defined capabilities, not just prompt labels.

Each skill owns:

- a fixed set of preferred data sources
- a predictable fetch order
- a synthesis rubric
- fallback behavior when inputs are partial

### 2. Single-student scope for v1

Each message supports at most one explicitly mentioned student.

Reasons:

- keeps skill semantics stable
- avoids ambiguous cross-student synthesis
- keeps trace and testing straightforward
- avoids introducing comparison behavior before a dedicated comparison skill exists

If the user selects or mentions another student in the same message, the latest resolved student wins.

### 3. Explicit skills with automatic fallback

If the user provides a valid `#skill`, AI Assist runs that skill.

If the user provides no `#skill`, AI Assist attempts automatic skill resolution first and only uses general free-form tool mode when the request does not fit a fixed skill.

If the user types an unknown `#skill`, AI Assist does not block or error. It records the unknown skill, surfaces a low-friction fallback hint on the frontend, and falls back to automatic resolution.

### 4. Mixed-mode composer

The AI Assist composer uses a mixed interaction model:

- visible skill chips for the four common skills
- inline `@student` and `#skill` typed triggers
- resolved context chips above the composer showing the actual student and skill that will be used

This supports both discoverability and power-user speed.

## Architecture

## High-level execution model

The orchestrator moves from one generic tool loop to a two-mode architecture:

1. `skill mode`
   - used when a valid explicit skill is present or automatic resolution maps the request to a known skill
   - backend drives data retrieval and synthesis in a controlled pipeline

2. `general mode`
   - used when the request does not fit a fixed skill
   - existing Responses API tool loop remains available as fallback

This keeps common workflows deterministic without removing flexibility for unusual requests.

## Resolution pipeline

Before any tool execution, the backend resolves structured context:

1. raw user message
2. frontend `assistContext`
3. conversation-bound student
4. recent conversation context

The orchestrator should compute:

- `resolvedStudent`
- `resolvedSkill`
- `mode`
- `resolutionNotes`

Resolution rules:

- student priority: explicit `@student` from request context > conversation-bound student > model/tool-based discovery
- skill priority: explicit valid `#skill` > backend auto-detected skill > general mode
- unknown explicit skill does not win; it only adds a resolution note and fallback reason

## Backend Design

## Request contract

Keep the existing `message` field and add a new optional `assistContext` object to both first-message and follow-up message endpoints.

Example request body:

```json
{
  "message": "@Abby Student #identify_risk focus on blockers and urgent follow-up",
  "assistContext": {
    "mentionedStudent": {
      "id": "student_abby",
      "displayName": "Abby Student"
    },
    "requestedSkill": "identify_risk",
    "unknownSkillText": null
  }
}
```

`message` remains the source of transcript truth.

`assistContext` carries the frontend's structured interpretation so the backend does not depend only on ad hoc parsing.

Backward compatibility:

- `assistContext` is optional
- existing clients that send only `message` must continue to work

## Controller changes

`controllers/ai_assist.js` should:

- validate `assistContext` shape when present
- verify that `mentionedStudent.id`, if provided, is accessible to the current user
- pass `assistContext` into `runAiAssist`

Permission behavior:

- an invalid or inaccessible `mentionedStudent.id` is a request error
- this should not silently fall back to another student, because the user gave structured intent

## Orchestrator changes

`services/ai-assist/orchestrator.js` should be refactored into explicit phases:

### Phase 1: load conversation context

Retain current conversation loading and include:

- bound student id
- bound student display name
- recent messages
- recent tool calls

### Phase 2: resolve assist context

New helper:

- `resolveAssistContext({ message, assistContext, conversationContext })`

Output:

```json
{
  "resolvedStudent": {
    "id": "student_abby",
    "displayName": "Abby Student",
    "source": "mention"
  },
  "resolvedSkill": "identify_risk",
  "requestedSkill": "identify_risk",
  "unknownSkillText": null,
  "mode": "skill",
  "fallbackReason": null
}
```

Possible `source` values for student:

- `mention`
- `conversation`
- `auto_search`

Possible `mode` values:

- `skill`
- `general`

Possible fallback reasons:

- `unknown_skill`
- `no_skill_match`
- `skill_resolution_failed`

### Phase 3: build execution plan

New helper:

- `buildSkillExecutionPlan(resolution)`

Returns a predefined plan for the four v1 skills.

### Phase 4: execute plan

New helper:

- `executeSkillPlan({ req, resolution, plan })`

Behavior:

- use backend tool functions directly
- fetch required data in a fixed order
- call the model only for synthesis and phrasing
- do not allow the model to wander into unrelated tools during skill mode

### Phase 5: fallback general mode

If no skill is resolved, keep the current Responses API function-tool loop with improved instructions and the resolved context injected into input.

## V1 skill plans

### `summarize_student`

Primary data:

- `get_student_summary`
- `get_student_applications`
- `get_profile_documents`
- `get_latest_communications`

Output focus:

- current status
- assigned team
- application posture
- document completeness
- recent important changes
- immediate next actions

### `identify_risk`

Primary data:

- `get_student_applications`
- `get_latest_communications`

Synthesis rubric:

- blockers
- deadline risk
- missing decision-critical information
- communication urgency
- recommended next action

Output should prioritize actionable risk, not a generic recap.

### `review_messages`

Primary data:

- `get_latest_communications`

Optional supporting data:

- `get_student_summary` when more context is needed for roles or ownership

Output focus:

- what changed
- what needs reply
- what needs follow-up
- urgency and ownership

### `review_open_tasks`

Primary data:

- `get_profile_documents`
- `get_student_applications`
- `get_latest_communications`

Output focus:

- open tasks
- blockers
- missing documents or decisions
- next actions ordered by urgency

## Frontend Design

## Composer state model

Extend page state with structured assist context:

- `mentionedStudent: AIAssistPickerStudent | null`
- `requestedSkill: 'summarize_student' | 'identify_risk' | 'review_messages' | 'review_open_tasks' | null`
- `unknownSkillText: string | null`

This state sits alongside the raw text input rather than replacing it.

## Composer interaction

The recommended composer pattern is:

- persistent quick-skill chips above the input
- typed `@` student lookup menu
- typed `#` skill lookup menu
- resolved chips above the input showing the active student and skill

Behavior:

- clicking a skill chip updates structured state and may also insert or replace the visible `#skill` text
- selecting a student from `@` lookup binds the structured student object
- only one explicit student mention is supported in a message
- later explicit student selection overrides earlier explicit student selection in the current draft

## Unknown skill UX

If the user types an unsupported `#skill`:

- keep the raw text untouched
- set `unknownSkillText`
- do not set `requestedSkill`
- show a small hint such as `Unknown skill, using auto mode`
- allow normal send behavior

## Request sending

Both draft first-send and persisted conversation sends should include:

- `message`
- `assistContext`

When no structured context exists, `assistContext` may be omitted or sent with null fields.

## Transcript trust surfaces

Assistant messages should show:

- resolved skill used
- resolved student used
- expandable raw tool details

This should make it clear when the system ran a defined skill versus free-form tool mode.

## Response Shape

Keep the existing `trace` array of raw tool calls and add a top-level `skillTrace` payload to message-send responses.

Example:

```json
{
  "userMessage": {},
  "assistantMessage": {},
  "trace": [],
  "skillTrace": {
    "requestedSkill": "identify_risk",
    "resolvedSkill": "identify_risk",
    "mode": "skill",
    "student": {
      "id": "student_abby",
      "displayName": "Abby Student"
    },
    "status": "success",
    "steps": [
      "resolved_student",
      "loaded_applications",
      "loaded_recent_messages",
      "generated_risk_summary"
    ],
    "fallbackReason": null
  }
}
```

If the assistant response belongs to a persisted conversation, the transcript fetch path should also expose enough data for the frontend to render the skill-level trust surface for each assistant answer.

The least disruptive implementation is:

- return `skillTrace` on send responses immediately
- persist enough metadata to reconstruct skill mode per assistant message on conversation reload

## Persistence

The current `ai_assist_tool_calls` table is not enough by itself to express skill-level execution cleanly.

V1 should add lightweight persistence for assistant-message-level skill metadata. This can be implemented by either:

1. adding a new `ai_assist_skill_traces` table keyed by `assistantMessageId`, or
2. adding a nullable `skillTrace` JSON column to `ai_assist_messages`

Recommendation:

- use a nullable JSON column on `ai_assist_messages` for v1

Reasoning:

- one assistant message corresponds to one resolved execution mode
- retrieval becomes simple
- migration cost stays low
- no separate join table is needed unless multi-step skill analytics become a product requirement later

Suggested stored shape:

- `requestedSkill`
- `resolvedSkill`
- `mode`
- `student`
- `status`
- `steps`
- `fallbackReason`

## Error Handling

### Invalid structured student

- request fails with a clear 4xx error
- no fallback to guessed students

### Unknown explicit skill

- request succeeds through fallback behavior
- `skillTrace.fallbackReason = 'unknown_skill'`
- frontend may show passive fallback messaging

### Skill execution data failure

- request returns an assistant error path or controlled backend error, depending on existing AI Assist conventions
- `skillTrace.status = 'failed'`
- failed step is recorded in `steps` or a dedicated error field

### General-mode tool loop exhaustion

- keep current maximum tool round protection
- return existing controlled failure answer

## Testing Strategy

## Backend tests

Add or update tests to cover:

- `assistContext.mentionedStudent` overrides conversation-bound student
- valid explicit skill triggers skill mode
- skill mode uses fixed backend retrieval plan rather than free-form tool loop
- unknown explicit skill falls back without failing the request
- no skill can auto-resolve to one of the four fixed skills
- requests without `assistContext` still work
- skill trace metadata is returned and persisted

## Frontend tests

Add or update page tests to cover:

- skill chip selection updates structured skill state
- `@` mention selection updates structured student state
- one message keeps only one resolved student
- unknown `#skill` shows fallback hint and still sends
- send requests include `assistContext`
- assistant messages display skill-level trust info

## Regression tests

Retain coverage for:

- draft first-message creation flow
- existing conversation follow-up flow
- per-message raw tool trace rendering
- archive, rename, and conversation loading behavior

## Migration Plan

1. add persistence support for assistant-message-level skill metadata
2. extend request validation to accept `assistContext`
3. implement backend context resolution helpers
4. implement the four skill execution plans
5. retain and integrate the existing general tool loop as fallback
6. update frontend composer state and interactions for `@` and `#`
7. render skill-level trust surfaces in transcript
8. add backend and frontend tests

## Risks and Mitigations

- Risk: skill mode duplicates some general-mode logic
  - Mitigation: centralize shared conversation loading, persistence, and response writing

- Risk: automatic skill detection becomes opaque
  - Mitigation: always return resolved mode and skill in `skillTrace`

- Risk: frontend text and structured state drift apart
  - Mitigation: treat structured state as the execution contract and keep visible chips synchronized with composer edits

- Risk: conversations started with one student become confusing when a later message mentions another student
  - Mitigation: explicit per-message mention wins for that message only; the persisted conversation-bound student remains unchanged unless future product work defines a mutation model

- Risk: adding skill persistence complicates transcript load
  - Mitigation: store one compact JSON payload per assistant message instead of a separate high-volume event log

## Implementation Notes

- keep existing tool functions read-only
- prefer direct backend tool invocation in skill mode over model-selected tool calls
- keep model synthesis prompts short and rubric-driven for each skill
- continue matching the user's language and script exactly
- avoid introducing multi-student comparison behavior until a dedicated comparison skill is designed
