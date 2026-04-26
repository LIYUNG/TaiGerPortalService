# AI Assist Skill Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship AI Assist skill-aware orchestration with fixed `#skill` support, structured `@student` context, persisted `skillTrace`, and the mixed-mode composer UI.

**Architecture:** Extend the current AI Assist stack in two repos. In `TaiGerPortalService`, add a nullable `skill_trace` JSON column, accept structured `assistContext` on both send endpoints, and split orchestration into `resolveAssistContext -> executeSkillPlan | runGeneralMode`. In `TaiGerPortalStaticWebsite`, keep the existing page shell but add structured composer state for `@student` and `#skill`, send `assistContext` with requests, and render `skillTrace` next to the existing raw tool trace.

**Tech Stack:** Express, Drizzle ORM, Jest, React, MUI, Vitest, TypeScript

---

### Task 1: Add persisted `skillTrace` support in `TaiGerPortalService`

**Files:**
- Create: `TaiGerPortalService/drizzle/migrations/0005_ai_assist_skill_trace.sql`
- Modify: `TaiGerPortalService/drizzle/schema/aiAssist.js`
- Modify: `TaiGerPortalService/drizzle/schema/schema.js`
- Test: `TaiGerPortalService/__tests__/services/ai_assist.test.js`

- [ ] **Step 1: Write the failing backend test for assistant-message `skillTrace` persistence**

```javascript
it('stores skillTrace on the assistant message record', async () => {
  const { postgres, insertedValues } = createAiAssistPostgresWithContext({});

  await runAiAssist(postgres, {
    conversationId: 'conv_1',
    message: '@Abby Student #identify_risk focus on blockers',
    assistContext: {
      mentionedStudent: { id: 'student_abby', displayName: 'Abby Student' },
      requestedSkill: 'identify_risk',
      unknownSkillText: null
    },
    req: {
      user: { _id: 'agent_1', role: Role.Agent },
      db: { model: jest.fn() }
    }
  });

  expect(insertedValues[1]).toMatchObject({
    role: 'assistant',
    skillTrace: expect.objectContaining({
      requestedSkill: 'identify_risk',
      resolvedSkill: 'identify_risk',
      mode: 'skill'
    })
  });
});
```

- [ ] **Step 2: Run the focused backend suite and verify the new test fails because `skillTrace` is not in the schema**

Run:

```bash
cd C:/Users/ajex/repo/TaiGer/TaiGerPortalService
npx jest --config __tests__/ai-assist.jest.config.js --runInBand --watchAll=false
```

Expected:

```text
FAIL __tests__/services/ai_assist.test.js
  ● stores skillTrace on the assistant message record
```

- [ ] **Step 3: Add the migration and schema field**

```sql
ALTER TABLE ai_assist_messages
ADD COLUMN IF NOT EXISTS skill_trace jsonb;
```

```javascript
const aiAssistMessages = pgTable('ai_assist_messages', {
  id: text('id')
    .primaryKey()
    .notNull()
    .$defaultFn(() => nanoid()),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => aiAssistConversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  model: text('model'),
  responseId: text('response_id'),
  usage: jsonb('usage'),
  skillTrace: jsonb('skill_trace'),
  createdAt: timestamp('created_at').defaultNow()
});
```

- [ ] **Step 4: Re-run the backend suite and confirm the remaining failure is orchestration, not missing schema**

Run:

```bash
cd C:/Users/ajex/repo/TaiGer/TaiGerPortalService
npx jest --config __tests__/ai-assist.jest.config.js --runInBand --watchAll=false
```

Expected:

```text
FAIL __tests__/services/ai_assist.test.js
  ● stores skillTrace on the assistant message record
    Expected inserted assistant message to include a non-null skillTrace
```

- [ ] **Step 5: Commit the schema change in the service repo**

```bash
git -C C:/Users/ajex/repo/TaiGer/TaiGerPortalService add drizzle/migrations/0005_ai_assist_skill_trace.sql drizzle/schema/aiAssist.js drizzle/schema/schema.js __tests__/services/ai_assist.test.js
git -C C:/Users/ajex/repo/TaiGer/TaiGerPortalService commit -m "feat: add ai assist skill trace persistence"
```

### Task 2: Extend the backend send contract with structured `assistContext`

**Files:**
- Modify: `TaiGerPortalService/controllers/ai_assist.js`
- Modify: `TaiGerPortalService/services/ai-assist/orchestrator.js`
- Test: `TaiGerPortalService/__tests__/services/ai_assist.test.js`

- [ ] **Step 1: Write the failing backend test for `assistContext` passthrough**

```javascript
it('passes assistContext through sendMessage into runAiAssist', async () => {
  const conversation = {
    id: 'conv_1',
    ownerUserId: 'agent_1',
    ownerRole: Role.Agent,
    status: 'active'
  };
  const postgres = createLifecyclePostgres(conversation);
  getPostgresDb.mockReturnValue(postgres);
  const res = createResponse();
  const runAiAssistSpy = jest.spyOn(require('../../services/ai-assist/orchestrator'), 'runAiAssist');

  await sendMessage(
    {
      params: { conversationId: 'conv_1' },
      user: { _id: 'agent_1', role: Role.Agent },
      body: {
        message: '@Abby Student #identify_risk',
        assistContext: {
          mentionedStudent: { id: 'student_abby', displayName: 'Abby Student' },
          requestedSkill: 'identify_risk',
          unknownSkillText: null
        }
      }
    },
    res
  );

  expect(runAiAssistSpy).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      assistContext: {
        mentionedStudent: { id: 'student_abby', displayName: 'Abby Student' },
        requestedSkill: 'identify_risk',
        unknownSkillText: null
      }
    })
  );
});
```

- [ ] **Step 2: Run the backend suite and verify the contract test fails before implementation**

Run:

```bash
cd C:/Users/ajex/repo/TaiGer/TaiGerPortalService
npx jest --config __tests__/ai-assist.jest.config.js --runInBand --watchAll=false
```

Expected:

```text
FAIL __tests__/services/ai_assist.test.js
  ● passes assistContext through sendMessage into runAiAssist
```

- [ ] **Step 3: Add backend parsing and validation for `assistContext`**

```javascript
const VALID_AI_ASSIST_SKILLS = new Set([
  'summarize_student',
  'identify_risk',
  'review_messages',
  'review_open_tasks'
]);

const resolveAssistContextPayload = async (req) => {
  const raw = req.body?.assistContext;
  if (!raw) {
    return undefined;
  }

  if (raw.mentionedStudent?.id) {
    await requireAccessibleStudent(req, raw.mentionedStudent.id);
  }

  const requestedSkill = VALID_AI_ASSIST_SKILLS.has(raw.requestedSkill)
    ? raw.requestedSkill
    : null;

  return {
    mentionedStudent: raw.mentionedStudent?.id
      ? {
          id: raw.mentionedStudent.id,
          displayName: raw.mentionedStudent.displayName || null
        }
      : null,
    requestedSkill,
    unknownSkillText:
      raw.requestedSkill && !requestedSkill
        ? raw.requestedSkill
        : raw.unknownSkillText || null
  };
};
```

```javascript
const assistantResult = await runAiAssist(tx, {
  conversationId,
  message,
  assistContext: await resolveAssistContextPayload(req),
  req
});
```

- [ ] **Step 4: Re-run the backend suite and confirm `assistContext` reaches the orchestrator**

Run:

```bash
cd C:/Users/ajex/repo/TaiGer/TaiGerPortalService
npx jest --config __tests__/ai-assist.jest.config.js --runInBand --watchAll=false
```

Expected:

```text
PASS __tests__/services/ai_assist.test.js
```

- [ ] **Step 5: Commit the backend contract change in the service repo**

```bash
git -C C:/Users/ajex/repo/TaiGer/TaiGerPortalService add controllers/ai_assist.js services/ai-assist/orchestrator.js __tests__/services/ai_assist.test.js
git -C C:/Users/ajex/repo/TaiGer/TaiGerPortalService commit -m "feat: add ai assist assistContext contract"
```

### Task 3: Refactor the orchestrator into skill mode plus general fallback

**Files:**
- Modify: `TaiGerPortalService/services/ai-assist/orchestrator.js`
- Modify: `TaiGerPortalService/services/ai-assist/tools.js`
- Modify: `TaiGerPortalService/services/ai-assist/toolDefinitions.js`
- Test: `TaiGerPortalService/__tests__/services/ai_assist.test.js`

- [ ] **Step 1: Write failing tests for skill execution and unknown-skill fallback**

```javascript
it('runs identify_risk in skill mode with fixed tools', async () => {
  const req = {
    user: { _id: 'agent_1', role: Role.Agent },
    db: {
      model: jest.fn((name) => {
        if (name === 'Student') {
          return {
            find: jest.fn(() => ({
              select: jest.fn(() => ({
                limit: jest.fn(() => ({
                  lean: jest.fn().mockResolvedValue([
                    {
                      _id: 'student_abby',
                      firstname: 'Abby',
                      lastname: 'Student',
                      firstname_chinese: '',
                      lastname_chinese: '',
                      email: 'abby@example.com',
                      agents: [],
                      editors: [],
                      profile: [],
                      applying_program_count: 2
                    }
                  ])
                }))
              }))
            }))
          };
        }

        if (name === 'Application') {
          return {
            find: jest.fn(() => ({
              select: jest.fn(() => ({
                populate: jest.fn(() => ({
                  lean: jest.fn().mockResolvedValue([])
                }))
              }))
            }))
          };
        }

        if (name === 'Communication') {
          return {
            find: jest.fn(() => ({
              populate: jest.fn(() => ({
                sort: jest.fn(() => ({
                  limit: jest.fn(() => ({
                    lean: jest.fn().mockResolvedValue([])
                  }))
                }))
              }))
            }))
          };
        }

        throw new Error(`Unexpected model ${name}`);
      })
    }
  };
  const { postgres } = createAiAssistPostgresWithContext({});

  await runAiAssist(postgres, {
    conversationId: 'conv_1',
    message: '@Abby Student #identify_risk focus on blockers',
    assistContext: {
      mentionedStudent: { id: 'student_abby', displayName: 'Abby Student' },
      requestedSkill: 'identify_risk',
      unknownSkillText: null
    },
    req
  });

  expect(runTool).toHaveBeenNthCalledWith(
    1,
    req,
    'get_student_applications',
    { studentId: 'student_abby' }
  );
  expect(runTool).toHaveBeenNthCalledWith(
    2,
    req,
    'get_latest_communications',
    { studentId: 'student_abby', limit: 10 }
  );
});

it('falls back to general mode for unknown skill text', async () => {
  const { postgres } = createAiAssistPostgresWithContext({});

  await runAiAssist(postgres, {
    conversationId: 'conv_1',
    message: '@Abby Student #mystery_skill help',
    assistContext: {
      mentionedStudent: { id: 'student_abby', displayName: 'Abby Student' },
      requestedSkill: null,
      unknownSkillText: 'mystery_skill'
    },
    req: {
      user: { _id: 'agent_1', role: Role.Agent },
      db: { model: jest.fn(() => { throw new Error('general mode should not use direct models here'); }) }
    }
  });

  expect(openAIClient.responses.create.mock.calls[0][0].tools).toEqual(
    expect.arrayContaining(aiAssistToolDefinitions)
  );
});
```

- [ ] **Step 2: Run the backend suite and verify both tests fail because skill mode does not exist**

Run:

```bash
cd C:/Users/ajex/repo/TaiGer/TaiGerPortalService
npx jest --config __tests__/ai-assist.jest.config.js --runInBand --watchAll=false
```

Expected:

```text
FAIL __tests__/services/ai_assist.test.js
  ● runs identify_risk in skill mode with fixed tools
  ● falls back to general mode for unknown skill text
```

- [ ] **Step 3: Add `resolveAssistContext`, `autoDetectSkill`, and fixed skill plans**

```javascript
const SKILL_PLANS = {
  summarize_student: {
    tools: [
      ['get_student_summary', (studentId) => ({ studentId })],
      ['get_student_applications', (studentId) => ({ studentId })],
      ['get_profile_documents', (studentId) => ({ studentId })],
      ['get_latest_communications', (studentId) => ({ studentId, limit: 10 })]
    ],
    instructions:
      'Summarize the student using current status, team ownership, applications, profile documents, and recent messages. End with the next actions.'
  },
  identify_risk: {
    tools: [
      ['get_student_applications', (studentId) => ({ studentId })],
      ['get_latest_communications', (studentId) => ({ studentId, limit: 10 })]
    ],
    instructions:
      'Identify blockers, deadline risk, missing information, communication urgency, and the next recommended action.'
  },
  review_messages: {
    tools: [['get_latest_communications', (studentId) => ({ studentId, limit: 10 })]],
    instructions:
      'Summarize what changed in recent messages, what needs a reply, what needs follow-up, and who should own it.'
  },
  review_open_tasks: {
    tools: [
      ['get_profile_documents', (studentId) => ({ studentId })],
      ['get_student_applications', (studentId) => ({ studentId })],
      ['get_latest_communications', (studentId) => ({ studentId, limit: 10 })]
    ],
    instructions:
      'List open tasks, blockers, missing documents or decisions, and order the next actions by urgency.'
  }
};

const autoDetectSkill = (message) => {
  const normalized = message.toLowerCase();
  if (normalized.includes('risk') || normalized.includes('blocker')) return 'identify_risk';
  if (normalized.includes('message') || normalized.includes('reply')) return 'review_messages';
  if (normalized.includes('task') || normalized.includes('follow-up')) return 'review_open_tasks';
  if (normalized.includes('summarize') || normalized.includes('summary')) return 'summarize_student';
  return null;
};
```

- [ ] **Step 4: Execute skill plans directly, synthesize with the model once, and persist `skillTrace`**

```javascript
const executeSkillPlan = async ({ req, resolution }) => {
  const plan = SKILL_PLANS[resolution.resolvedSkill];
  const trace = [];
  const toolPayload = {};

  for (const [toolName, buildArgs] of plan.tools) {
    const args = buildArgs(resolution.resolvedStudent.id);
    const result = await runTool(req, toolName, args);
    trace.push({
      toolName,
      arguments: args,
      result,
      status: 'success',
      durationMs: 0,
      permissionOutcome: { inheritedUserPermission: true }
    });
    toolPayload[toolName] = result.data;
  }

  const response = await openAIClient.responses.create({
    model: DEFAULT_MODEL,
    instructions: `${instructions}\n\nSkill mode rubric: ${plan.instructions}`,
    input: [
      {
        role: 'user',
        content: JSON.stringify(
          {
            currentUserMessage: resolution.message,
            resolvedStudent: resolution.resolvedStudent,
            resolvedSkill: resolution.resolvedSkill,
            toolPayload
          },
          null,
          2
        )
      }
    ]
  });

  return {
    response,
    answer: getResponseText(response),
    trace,
    skillTrace: {
      requestedSkill: resolution.requestedSkill,
      resolvedSkill: resolution.resolvedSkill,
      mode: 'skill',
      student: {
        id: resolution.resolvedStudent.id,
        displayName: resolution.resolvedStudent.displayName
      },
      status: 'success',
      steps: [
        'resolved_student',
        ...plan.tools.map(([toolName]) => `loaded_${toolName}`),
        `generated_${resolution.resolvedSkill}`
      ],
      fallbackReason: resolution.fallbackReason || null
    }
  };
};
```

- [ ] **Step 5: Re-run the backend suite and confirm skill-mode orchestration is green**

Run:

```bash
cd C:/Users/ajex/repo/TaiGer/TaiGerPortalService
npx jest --config __tests__/ai-assist.jest.config.js --runInBand --watchAll=false
```

Expected:

```text
PASS __tests__/services/ai_assist.test.js
```

- [ ] **Step 6: Commit the orchestrator refactor in the service repo**

```bash
git -C C:/Users/ajex/repo/TaiGer/TaiGerPortalService add services/ai-assist/orchestrator.js services/ai-assist/tools.js services/ai-assist/toolDefinitions.js __tests__/services/ai_assist.test.js
git -C C:/Users/ajex/repo/TaiGer/TaiGerPortalService commit -m "feat: add ai assist skill mode orchestration"
```

### Task 4: Implement the mixed-mode composer in `TaiGerPortalStaticWebsite`

**Files:**
- Modify: `TaiGerPortalStaticWebsite/src/api/types.ts`
- Modify: `TaiGerPortalStaticWebsite/src/api/apis.ts`
- Modify: `TaiGerPortalStaticWebsite/src/pages/AIAssist/AIAssistPage.tsx`
- Test: `TaiGerPortalStaticWebsite/src/pages/AIAssist/AIAssistPage.test.tsx`
- Test: `TaiGerPortalStaticWebsite/src/pages/AIAssist/index.test.tsx`

- [ ] **Step 1: Write failing page tests for quick skill selection, structured `assistContext`, and unknown-skill fallback**

```typescript
it('sends selected quick skill and mentioned student as assistContext', async () => {
    const user = userEvent.setup();
    apiMocks.getAIAssistConversations.mockResolvedValue({ success: true, data: [] });
    render(<AIAssistPage />);

    await user.click(screen.getByRole('button', { name: 'Choose student' }));
    const recentSection = await screen.findByTestId('ai-assist-student-section-recent');
    await user.click(within(recentSection).getByRole('button', { name: 'Abby Student' }));
    await user.click(screen.getByRole('button', { name: '#identify_risk' }));
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(apiMocks.postAIAssistFirstMessage).toHaveBeenCalledWith(
        expect.objectContaining({
            assistContext: {
                mentionedStudent: { id: 'student_abby', displayName: 'Abby Student' },
                requestedSkill: 'identify_risk',
                unknownSkillText: null
            }
        })
    );
});

it('shows passive fallback messaging for an unknown skill tag', async () => {
    const user = userEvent.setup();
    apiMocks.getAIAssistConversations.mockResolvedValue({ success: true, data: [] });
    render(<AIAssistPage />);

    await user.click(screen.getByRole('button', { name: 'Blank chat' }));
    const input = screen.getByLabelText('Ask TaiGer AI');
    await user.type(input, '#mystery_skill please help');

    expect(screen.getByText('Unknown skill, using auto mode')).toBeTruthy();
});
```

- [ ] **Step 2: Run the focused frontend tests and verify the new behavior is missing**

Run:

```bash
cd C:/Users/ajex/repo/TaiGer/TaiGerPortalStaticWebsite
npm run test:ci -- src/pages/AIAssist/AIAssistPage.test.tsx src/pages/AIAssist/index.test.tsx
```

Expected:

```text
FAIL src/pages/AIAssist/AIAssistPage.test.tsx
  ● sends selected quick skill and mentioned student as assistContext
  ● shows passive fallback messaging for an unknown skill tag
```

- [ ] **Step 3: Add frontend `assistContext` and `skillTrace` types plus request payload support**

```typescript
export type AIAssistSkill =
    | 'summarize_student'
    | 'identify_risk'
    | 'review_messages'
    | 'review_open_tasks';

export interface AIAssistAssistContext {
    mentionedStudent: {
        id: string;
        displayName?: string | null;
    } | null;
    requestedSkill: AIAssistSkill | null;
    unknownSkillText?: string | null;
}

export interface AIAssistSkillTrace {
    requestedSkill: string | null;
    resolvedSkill: string | null;
    mode: 'skill' | 'general';
    student?: { id: string; displayName?: string | null } | null;
    status: 'success' | 'failed';
    steps: string[];
    fallbackReason?: string | null;
}
```

```typescript
export interface PostAIAssistFirstMessagePayload {
    message: string;
    assistContext?: AIAssistAssistContext;
}

export interface PostAIAssistMessagePayload {
    message: string;
    assistContext?: AIAssistAssistContext;
}
```

- [ ] **Step 4: Add quick-skill constants, structured composer state, and `assistContext` sending**

```typescript
const QUICK_SKILLS: Array<{ id: AIAssistSkill; label: string }> = [
    { id: 'summarize_student', label: '#summarize_student' },
    { id: 'identify_risk', label: '#identify_risk' },
    { id: 'review_messages', label: '#review_messages' },
    { id: 'review_open_tasks', label: '#review_open_tasks' }
];

const [mentionedStudent, setMentionedStudent] =
    useState<AIAssistPickerStudent | null>(null);
const [requestedSkill, setRequestedSkill] = useState<AIAssistSkill | null>(null);
const [unknownSkillText, setUnknownSkillText] = useState<string | null>(null);

const buildAssistContext = (): AIAssistAssistContext | undefined => {
    if (!mentionedStudent && !requestedSkill && !unknownSkillText) {
        return undefined;
    }

    return {
        mentionedStudent: mentionedStudent
            ? { id: mentionedStudent.id, displayName: mentionedStudent.name }
            : null,
        requestedSkill,
        unknownSkillText
    };
};
```

```typescript
await postAIAssistFirstMessage({
    message: trimmedInput,
    assistContext: buildAssistContext()
});
```

- [ ] **Step 5: Render the quick skill chips and passive unknown-skill hint**

```tsx
<Stack direction="row" spacing={1} flexWrap="wrap">
    {QUICK_SKILLS.map((skill) => (
        <Button
            key={skill.id}
            onClick={() => {
                setRequestedSkill(skill.id);
                setUnknownSkillText(null);
            }}
            variant={requestedSkill === skill.id ? 'contained' : 'outlined'}
        >
            {skill.label}
        </Button>
    ))}
</Stack>

{unknownSkillText ? (
    <Alert severity="info">Unknown skill, using auto mode</Alert>
) : null}
```

- [ ] **Step 6: Re-run the focused frontend tests and confirm the mixed-mode composer is green**

Run:

```bash
cd C:/Users/ajex/repo/TaiGer/TaiGerPortalStaticWebsite
npm run test:ci -- src/pages/AIAssist/AIAssistPage.test.tsx src/pages/AIAssist/index.test.tsx
```

Expected:

```text
PASS src/pages/AIAssist/AIAssistPage.test.tsx
PASS src/pages/AIAssist/index.test.tsx
```

- [ ] **Step 7: Commit the frontend composer in the website repo**

```bash
git -C C:/Users/ajex/repo/TaiGer/TaiGerPortalStaticWebsite add src/api/types.ts src/api/apis.ts src/pages/AIAssist/AIAssistPage.tsx src/pages/AIAssist/AIAssistPage.test.tsx src/pages/AIAssist/index.test.tsx
git -C C:/Users/ajex/repo/TaiGer/TaiGerPortalStaticWebsite commit -m "feat: add ai assist structured mention composer"
```

### Task 5: Return and render `skillTrace`, then verify the integrated slice

**Files:**
- Modify: `TaiGerPortalService/controllers/ai_assist.js`
- Modify: `TaiGerPortalService/services/ai-assist/orchestrator.js`
- Test: `TaiGerPortalService/__tests__/services/ai_assist.test.js`
- Modify: `TaiGerPortalStaticWebsite/src/api/types.ts`
- Modify: `TaiGerPortalStaticWebsite/src/pages/AIAssist/AIAssistPage.tsx`
- Test: `TaiGerPortalStaticWebsite/src/pages/AIAssist/AIAssistPage.test.tsx`

- [ ] **Step 1: Write failing tests for `skillTrace` in send responses and transcript rendering**

```javascript
it('returns skillTrace with sendMessage responses', async () => {
  const conversation = {
    id: 'conv_1',
    ownerUserId: 'agent_1',
    ownerRole: Role.Agent,
    status: 'active'
  };
  const postgres = createLifecyclePostgres(conversation);
  getPostgresDb.mockReturnValue(postgres);
  const res = createResponse();

  await sendMessage(
    {
      params: { conversationId: 'conv_1' },
      user: { _id: 'agent_1', role: Role.Agent },
      body: {
        message: '@Abby Student #identify_risk',
        assistContext: {
          mentionedStudent: { id: 'student_abby', displayName: 'Abby Student' },
          requestedSkill: 'identify_risk',
          unknownSkillText: null
        }
      }
    },
    res
  );

  expect(res.send.mock.calls[0][0].data.skillTrace).toMatchObject({
    resolvedSkill: 'identify_risk',
    mode: 'skill'
  });
});
```

```typescript
it('shows skill used and student used under the assistant message', async () => {
    render(<AIAssistPage />);

    await waitFor(() => {
        expect(screen.getByText('mocked AI Assist answer')).toBeTruthy();
    });

    expect(screen.getByText('Skill used: identify_risk')).toBeTruthy();
    expect(screen.getByText('Student: Abby Student')).toBeTruthy();
});
```

- [ ] **Step 2: Run backend and frontend suites to verify `skillTrace` is not yet surfaced end to end**

Run:

```bash
cd C:/Users/ajex/repo/TaiGer/TaiGerPortalService
npx jest --config __tests__/ai-assist.jest.config.js --runInBand --watchAll=false
cd ../TaiGerPortalStaticWebsite
npm run test:ci -- src/pages/AIAssist/AIAssistPage.test.tsx
```

Expected:

```text
FAIL __tests__/services/ai_assist.test.js
  ● returns skillTrace with sendMessage responses
FAIL src/pages/AIAssist/AIAssistPage.test.tsx
  ● shows skill used and student used under the assistant message
```

- [ ] **Step 3: Return `skillTrace` from the service and hydrate it on conversation reload**

```javascript
const assistantMessage = await createAssistantMessage(postgres, {
  conversationId,
  content: answer,
  response: result.response,
  skillTrace: result.skillTrace || null
});

return {
  userMessage,
  assistantMessage,
  answer,
  trace,
  skillTrace: result.skillTrace || null,
  usage: result.response?.usage
};
```

- [ ] **Step 4: Render `skillTrace` in the transcript while keeping raw tool trace expandable**

```tsx
{message.role === 'assistant' && message.skillTrace ? (
    <Stack spacing={0.5} sx={{ mt: 1 }}>
        <Typography variant="caption" fontWeight={700}>
            Skill used: {message.skillTrace.resolvedSkill || 'auto'}
        </Typography>
        {message.skillTrace.student?.displayName ? (
            <Typography variant="caption" color="text.secondary">
                Student: {message.skillTrace.student.displayName}
            </Typography>
        ) : null}
    </Stack>
) : null}
```

```typescript
export interface AIAssistMessage {
    id: string;
    conversationId?: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    skillTrace?: AIAssistSkillTrace | null;
    model?: string;
    responseId?: string;
    usage?: Record<string, unknown>;
    createdAt?: string;
}
```

- [ ] **Step 5: Run the full targeted verification set**

Run:

```bash
cd C:/Users/ajex/repo/TaiGer/TaiGerPortalService
npx jest --config __tests__/ai-assist.jest.config.js --runInBand --watchAll=false
cd ../TaiGerPortalStaticWebsite
npm run test:ci -- src/pages/AIAssist/AIAssistPage.test.tsx src/pages/AIAssist/index.test.tsx
npm run typecheck
```

Expected:

```text
PASS __tests__/services/ai_assist.test.js
PASS src/pages/AIAssist/AIAssistPage.test.tsx
PASS src/pages/AIAssist/index.test.tsx
Found 0 errors.
```

- [ ] **Step 6: Commit the final integration in both repos**

```bash
git -C C:/Users/ajex/repo/TaiGer/TaiGerPortalService add controllers/ai_assist.js services/ai-assist/orchestrator.js __tests__/services/ai_assist.test.js
git -C C:/Users/ajex/repo/TaiGer/TaiGerPortalService commit -m "feat: return ai assist skill trace payload"
git -C C:/Users/ajex/repo/TaiGer/TaiGerPortalStaticWebsite add src/api/types.ts src/pages/AIAssist/AIAssistPage.tsx src/pages/AIAssist/AIAssistPage.test.tsx
git -C C:/Users/ajex/repo/TaiGer/TaiGerPortalStaticWebsite commit -m "feat: show ai assist skill trace in transcript"
```
