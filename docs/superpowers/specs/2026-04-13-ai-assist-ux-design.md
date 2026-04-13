# AI Assist UX Redesign

## Goal

Make AI Assist easier to start and easier to trust by:

- moving conversation creation to first send instead of pre-creating empty records
- making student-first entry the default guided path
- showing tooling per assistant message while still keeping a conversation-level trace
- allowing frontend archive/delete of conversations
- making keyboard send behavior match normal chat expectations

## Scope

This spec covers the existing AI Assist frontend in `TaiGerPortalStaticWebsite/src/pages/AIAssist` and the existing AI Assist backend in `TaiGerPortalService/controllers/ai_assist.js`, `TaiGerPortalService/routes/ai_assist.js`, and `TaiGerPortalService/services/ai-assist`.

In scope:

- new draft conversation UX on the frontend
- student-first conversation start flow
- first-message conversation creation flow
- per-message tool trace rendering
- archive/delete conversation flow
- conversation-bound student context
- lightweight student selection data endpoints for AI Assist quick start

Out of scope:

- streaming responses
- cross-conversation search
- multi-student conversations
- changing the core OpenAI tool loop beyond passing stronger context
- deep redesign of the overall page layout outside AI Assist

## Product Decisions

### 1. Conversation start model

- Clicking `New conversation` creates a frontend-only draft state.
- No backend conversation record is created until the user sends the first message.
- Draft conversations can hold:
  - selected student context
  - selected starter action
  - prefilled prompt text
- Blank drafts can also be opened without a student.

### 2. Student-first quick start

The empty-state start flow has two primary paths:

- `Choose student`
- `Blank chat`

If the user chooses a student, the page shows:

- `Recent students`
- `My students`
- `Search`

After the user picks a student, the page offers starter actions:

- `Summarize student`
- `Find application risks`
- `Check latest messages`
- `Review open tasks`

Selecting a starter action does not auto-send. It only prefills the composer with an editable prompt.

### 3. Composer behavior

- `Enter` sends the message
- `Shift+Enter` inserts a newline
- this applies to both draft conversations and persisted conversations

### 4. Conversation-bound student context

- Conversations started from the student path are bound to one student
- every follow-up message in that conversation inherits that student context
- the UI shows the active student as a removable chip
- blank conversations have no student context
- clearing or changing the student context should start a new draft conversation rather than mutating an existing persisted conversation that already has history

### 5. Tool trace visibility

- every assistant message shows its own tool usage block
- the right rail still shows a conversation-level trace timeline
- per-message trace is the primary trust surface
- conversation-level trace remains useful for full-session debugging

### 6. Delete behavior

- frontend exposes conversation delete
- backend implements delete as archive by setting conversation status to `archived`
- archived conversations are excluded from list and hidden from the frontend
- archived conversations cannot be loaded, renamed, or receive new messages

## UX Design

## Page states

### Empty AI Assist state

The main panel shows:

- primary buttons for `Choose student` and `Blank chat`
- optional helper text explaining that student mode keeps context attached for follow-up questions
- recent/my/search student selectors only after entering the student path

The right rail still shows conversation history if any active conversations exist.

### Draft conversation state

The main chat panel behaves like a conversation before persistence:

- no conversation id yet
- optional student chip at top of composer or below header
- starter action chips visible after student selection until first send
- composer contains editable prompt text

### Persisted conversation state

Once the first message succeeds:

- the backend returns the created conversation, user message, assistant message, and tool traces
- the draft state converts into a normal persisted conversation
- the conversation appears in the side rail

## Suggested prompt templates

Starter actions should prefill prompts that provide immediate structure but remain editable.

- `Summarize student`
  - `Summarize this student for me. Focus on current status, assigned team, documents, applications, and anything I should know first.`
- `Find application risks`
  - `Review this student's applications and identify the main risks, blockers, and deadlines I should pay attention to.`
- `Check latest messages`
  - `Check the latest messages for this student and summarize what changed, what needs follow-up, and any urgent issues.`
- `Review open tasks`
  - `Review this student's profile, applications, and recent communication. Summarize the open tasks and next actions.`

## Backend Design

## Data model changes

The existing `ai_assist_conversations` table should gain durable context fields:

- `studentId` nullable text
- `studentDisplayName` nullable text

These fields store the bound student context for the conversation. The display name is denormalized for side rail and response convenience; the source of truth for authorization remains the actual student record lookup.

Existing `status` remains the archive mechanism using values such as:

- `active`
- `archived`

No schema change is required for `ai_assist_tool_calls`, because the existing `assistantMessageId` already supports per-message trace grouping.

## API shape

### Keep

- `GET /api/ai-assist/conversations`
- `GET /api/ai-assist/conversations/:conversationId`
- `PATCH /api/ai-assist/conversations/:conversationId`
- `POST /api/ai-assist/conversations/:conversationId/messages`

### Add

- `POST /api/ai-assist/conversations/first-message`
  - creates a conversation
  - stores optional student context
  - stores the first user message
  - runs AI Assist
  - stores assistant message and tool calls
  - returns the full initial conversation payload

- `DELETE /api/ai-assist/conversations/:conversationId`
  - archives the conversation instead of hard deleting

- lightweight quick-start student endpoints under AI Assist:
  - `GET /api/ai-assist/students/recent`
  - `GET /api/ai-assist/students/mine`
  - `GET /api/ai-assist/students/search?q=...`

These endpoints should return small result shapes optimized for picker UI, not full student payloads.

## Response shape changes

`GET /conversations/:conversationId` and both message-send endpoints should return trace in two forms:

- `trace`: full conversation-level trace list for the right rail
- per-assistant-message tool call association for transcript rendering

The least disruptive shape is:

- keep existing flat `trace`
- add `toolCalls` to assistant message objects in API responses when assembling transcript data

Alternative acceptable shape:

- keep message objects unchanged
- frontend groups flat trace by `assistantMessageId`

Recommendation: keep backend payload mostly unchanged and group on the frontend for the page render, because `assistantMessageId` already exists.

## Authorization and access rules

- conversation owner must still match current user
- student quick-start endpoints must reuse the same accessible-student permission rules as AI Assist tools
- archived conversations are treated as not found for normal fetch/send/update operations
- first-message endpoint must verify that any provided student id is accessible to the current user before storing it on the conversation

## Orchestrator changes

The orchestrator currently loads recent messages and tool calls as `conversationContext`. It should also include durable conversation metadata:

- bound student id
- bound student display name

This metadata should be included in the initial model input so follow-up messages do not need to rediscover the student with search unless the user explicitly switches context.

The instructions should also explicitly tell the model:

- when bound student context exists, prefer that student unless the user clearly asks about another one
- use tooling that matches the request: summary, application review, message review, document review, or ticket/program lookup

## Student quick-start backend logic

### Recent students

Use the current user's latest AI Assist conversations with non-null `studentId`, ordered by conversation update time, deduplicated by student id, then enriched with accessible student names.

### My students

Use the existing accessible student filter logic, but return a capped list of the most likely candidates for the current user:

- assigned students only
- active students only
- deterministic ordering

### Search

Reuse the existing student search behavior already present in `search_accessible_students`, but expose it as a lightweight HTTP endpoint for the picker.

## Frontend Design

## State model

The page state should distinguish between:

- no active conversation
- draft conversation
- persisted conversation

Recommended local state:

- `activeConversationId | null`
- `draftConversation` object or `null`
- `messages`
- `trace`
- quick-start student lists and loading states

Draft state should contain:

- `studentId | null`
- `studentDisplayName | null`
- `starterAction | null`
- `input`

## Side rail behavior

- `New conversation` opens a blank draft instead of calling backend create
- persisted active conversations stay listed as today
- archived conversations disappear immediately after delete
- delete action should sit next to rename in the conversation row

## Transcript behavior

Messages continue to render in chronological order.

For each assistant message:

- show message content
- show `Tools used (n)` disclosure if there are matching tool calls
- expand panel reveals tool name, status, duration, and formatted input/output summary

The right-rail trace panel remains conversation-level and uses the existing flat trace array.

## Error handling

- first-message failures must keep the draft intact so the user can retry
- if archive fails, keep the conversation visible and show an error toast/alert
- if student quick-start lists fail, the user can still use blank chat or manual search
- if search returns no students, prompt the user to refine the search rather than blocking the draft flow

## Testing Strategy

## Frontend tests

Add or update page tests to cover:

- empty state shows `Choose student` and `Blank chat`
- `New conversation` creates draft only and does not call backend create
- selecting student path loads recent/my/search pickers
- starter action prefills composer without sending
- `Enter` sends and `Shift+Enter` inserts newline
- first send calls `first-message` endpoint instead of old create flow
- per-message tool calls render under the correct assistant message
- delete archives conversation and removes it from list
- failed first send preserves draft input and student chip

## Backend tests

Add or update tests to cover:

- `first-message` creates conversation only on successful request path
- supplied student id is permission-checked
- archived conversations are excluded from list/get/send/update
- delete route archives instead of removing rows
- orchestrator input includes bound student context
- recent student endpoint deduplicates and only returns accessible students

## Migration Plan

1. add conversation context columns
2. add archive and first-message endpoints
3. add quick-start student endpoints
4. update frontend draft conversation flow
5. update transcript trace rendering
6. add delete/archive control
7. add tests for new lifecycle and message-level trace behavior

## Risks and Mitigations

- Risk: first-message flow duplicates logic with existing send endpoint
  - Mitigation: factor shared persistence/send logic into a helper used by both endpoints

- Risk: conversation-bound student context could drift from actual permissions
  - Mitigation: re-check accessibility when sending new messages, not only when conversation is created

- Risk: per-message trace can become visually noisy
  - Mitigation: use collapsed disclosure by default and keep the right rail for full detail

- Risk: recent students list may show stale names for archived or no-longer-accessible students
  - Mitigation: always rehydrate recent student ids through current access filtering before returning results

## Open Implementation Notes

- prefer frontend grouping of trace by `assistantMessageId` over reshaping the backend transcript payload unless tests show this becomes awkward
- keep conversation title generation behavior unchanged for now unless first-message endpoint makes it cheap to improve later
- do not preserve a persisted conversation when the user switches bound student after history exists; start a new draft instead
