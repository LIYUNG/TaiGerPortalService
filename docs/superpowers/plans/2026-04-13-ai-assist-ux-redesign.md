# AI Assist UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved AI Assist UX redesign: draft-first conversations, student-first quick start, first-send persistence, per-message tool trace, and archive-based delete.

**Architecture:** Keep the current AI Assist route/controller/orchestrator stack, but add one first-message endpoint, one archive endpoint, durable conversation student context, and lightweight student picker endpoints. On the frontend, keep the page route and side rail structure, but introduce explicit draft state and group tool calls by `assistantMessageId` for transcript rendering.

**Tech Stack:** Express, Drizzle ORM, Jest, React, MUI, Vitest

---

### Task 1: Add backend conversation lifecycle contract

**Files:**
- Create: `TaiGerPortalService/drizzle/migrations/0004_ai_assist_conversation_context.sql`
- Modify: `TaiGerPortalService/drizzle/schema/aiAssist.js`
- Modify: `TaiGerPortalService/controllers/ai_assist.js`
- Modify: `TaiGerPortalService/routes/ai_assist.js`
- Test: `TaiGerPortalService/__tests__/services/ai_assist.test.js`

- [ ] **Step 1: Write the failing backend tests for first-message create and archive delete**

```javascript
it('creates a conversation only when first-message is called', async () => {
  const req = {
    user: { _id: 'agent_1', role: Role.Agent },
    body: {
      message: 'Summarize this student for me',
      studentId: 'student_abby',
      studentDisplayName: 'abby Student'
    }
  };
  const res = createResponse();

  await createConversationFromFirstMessage(req, res);

  expect(res.status).toHaveBeenCalledWith(201);
  expect(res.send.mock.calls[0][0].data.conversation).toMatchObject({
    status: 'active',
    studentId: 'student_abby',
    studentDisplayName: 'abby Student'
  });
});

it('archives a conversation instead of deleting rows', async () => {
  const req = {
    params: { conversationId: 'conv_1' },
    user: { _id: 'agent_1', role: Role.Agent }
  };
  const res = createResponse();

  await archiveConversation(req, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.send).toHaveBeenCalledWith({
    success: true,
    data: expect.objectContaining({ status: 'archived' })
  });
});
```

- [ ] **Step 2: Run backend AI Assist tests and verify the new tests fail for the expected reason**

Run:

```bash
cd TaiGerPortalService
npx jest --config __tests__/ai-assist.jest.config.js --runInBand --watchAll=false
```

Expected:

```text
FAIL __tests__/services/ai_assist.test.js
  ● createConversationFromFirstMessage is not a function
  ● archiveConversation is not a function
```

- [ ] **Step 3: Add conversation context columns and controller endpoints**

```sql
ALTER TABLE ai_assist_conversations
ADD COLUMN IF NOT EXISTS student_id text,
ADD COLUMN IF NOT EXISTS student_display_name text;

CREATE INDEX IF NOT EXISTS ai_assist_conversations_owner_status_idx
ON ai_assist_conversations(owner_user_id, status, updated_at);
```

```javascript
const requireActiveConversationOwner = async (postgres, conversationId, userId) => {
  const rows = await postgres
    .select()
    .from(aiAssistConversations)
    .where(
      and(
        eq(aiAssistConversations.id, conversationId),
        eq(aiAssistConversations.ownerUserId, userId),
        eq(aiAssistConversations.status, 'active')
      )
    )
    .limit(1);

  if (!rows.length) {
    throw new ErrorResponse(404, 'AI Assist conversation not found');
  }

  return rows[0];
};

const createConversationFromFirstMessage = asyncHandler(async (req, res) => {
  const postgres = getPostgresDb();
  const { message, studentId, studentDisplayName } = req.body;

  if (!message || typeof message !== 'string') {
    throw new ErrorResponse(400, 'message is required');
  }

  const [conversation] = await postgres
    .insert(aiAssistConversations)
    .values({
      ownerUserId: currentUserId(req),
      ownerRole: req.user.role,
      title: DEFAULT_TITLE,
      status: 'active',
      studentId: studentId || null,
      studentDisplayName: studentDisplayName || null
    })
    .returning();

  const result = await runAiAssist(postgres, {
    conversationId: conversation.id,
    message,
    req
  });

  await postgres
    .update(aiAssistConversations)
    .set({ updatedAt: new Date() })
    .where(eq(aiAssistConversations.id, conversation.id));

  res.status(201).send({
    success: true,
    data: {
      conversation,
      ...result
    }
  });
});

const archiveConversation = asyncHandler(async (req, res) => {
  const postgres = getPostgresDb();
  await requireActiveConversationOwner(
    postgres,
    req.params.conversationId,
    currentUserId(req)
  );

  const [conversation] = await postgres
    .update(aiAssistConversations)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(aiAssistConversations.id, req.params.conversationId))
    .returning();

  res.status(200).send({ success: true, data: conversation });
});
```

- [ ] **Step 4: Wire the routes and active-only list/get/send behavior**

```javascript
router
  .route('/conversations/first-message')
  .post(GeneralPOSTRequestRateLimiter, createConversationFromFirstMessage);

router
  .route('/conversations/:conversationId')
  .get(GeneralGETRequestRateLimiter, getConversation)
  .patch(GeneralPOSTRequestRateLimiter, updateConversation)
  .delete(GeneralPOSTRequestRateLimiter, archiveConversation);
```

```javascript
const conversations = await postgres
  .select()
  .from(aiAssistConversations)
  .where(
    and(
      eq(aiAssistConversations.ownerUserId, currentUserId(req)),
      eq(aiAssistConversations.status, 'active')
    )
  )
  .orderBy(desc(aiAssistConversations.updatedAt))
  .limit(25);
```

- [ ] **Step 5: Re-run backend tests and confirm green**

Run:

```bash
cd TaiGerPortalService
npx jest --config __tests__/ai-assist.jest.config.js --runInBand --watchAll=false
```

Expected:

```text
PASS __tests__/services/ai_assist.test.js
```

- [ ] **Step 6: Commit**

```bash
git add TaiGerPortalService/drizzle/migrations/0004_ai_assist_conversation_context.sql TaiGerPortalService/drizzle/schema/aiAssist.js TaiGerPortalService/controllers/ai_assist.js TaiGerPortalService/routes/ai_assist.js TaiGerPortalService/__tests__/services/ai_assist.test.js
git commit -m "feat: add ai assist conversation lifecycle endpoints"
```

### Task 2: Add student quick-start endpoints and durable orchestrator context

**Files:**
- Modify: `TaiGerPortalService/services/ai-assist/tools.js`
- Modify: `TaiGerPortalService/services/ai-assist/orchestrator.js`
- Modify: `TaiGerPortalService/controllers/ai_assist.js`
- Modify: `TaiGerPortalService/__tests__/services/ai_assist.test.js`

- [ ] **Step 1: Write failing tests for student picker endpoints and bound student context**

```javascript
it('returns recent students from active ai assist conversations', async () => {
  const req = { user: { _id: 'agent_1', role: Role.Agent } };
  const res = createResponse();

  await listRecentStudents(req, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.send.mock.calls[0][0].data[0]).toMatchObject({
    id: 'student_abby',
    name: 'abby Student'
  });
});

it('passes bound student context into the model input', async () => {
  await runAiAssist(postgres, {
    conversationId: 'conv_1',
    message: 'Review open tasks',
    req
  });

  expect(openAIClient.responses.create.mock.calls[0][0].input[0].content).toContain(
    '"boundStudentId": "student_abby"'
  );
});
```

- [ ] **Step 2: Run backend tests and verify failures are endpoint/context related**

Run:

```bash
cd TaiGerPortalService
npx jest --config __tests__/ai-assist.jest.config.js --runInBand --watchAll=false
```

Expected:

```text
FAIL __tests__/services/ai_assist.test.js
  ● listRecentStudents is not a function
  ● Expected substring: "boundStudentId"
```

- [ ] **Step 3: Implement quick-start student queries in the AI Assist controller/service layer**

```javascript
const normalizePickerStudent = (student) => ({
  id: student._id?.toString?.() || student.id,
  name: [student.firstname, student.lastname].filter(Boolean).join(' '),
  chineseName: [student.lastname_chinese, student.firstname_chinese]
    .filter(Boolean)
    .join(''),
  email: student.email
});

const listMyStudents = asyncHandler(async (req, res) => {
  const filter = await getAccessibleStudentFilter(req);
  const students = await req.db
    .model('Student')
    .find(filter)
    .select('firstname lastname firstname_chinese lastname_chinese email')
    .limit(10)
    .lean();

  res.status(200).send({
    success: true,
    data: students.map(normalizePickerStudent)
  });
});
```

```javascript
const searchPickerStudents = asyncHandler(async (req, res) => {
  const result = await searchAccessibleStudents(req, {
    query: req.query.q,
    limit: 10
  });

  res.status(200).send(result);
});
```

- [ ] **Step 4: Extend orchestrator context with durable conversation metadata**

```javascript
const loadConversationContext = async (postgres, conversationId) => {
  const [conversationRows, messages, toolCalls] = await Promise.all([
    postgres
      .select()
      .from(aiAssistConversations)
      .where(eq(aiAssistConversations.id, conversationId))
      .limit(1),
    postgres
      .select()
      .from(aiAssistMessages)
      .where(eq(aiAssistMessages.conversationId, conversationId))
      .orderBy(desc(aiAssistMessages.createdAt))
      .limit(12),
    postgres
      .select()
      .from(aiAssistToolCalls)
      .where(eq(aiAssistToolCalls.conversationId, conversationId))
      .orderBy(desc(aiAssistToolCalls.createdAt))
      .limit(12)
  ]);

  const conversation = conversationRows[0];

  return {
    boundStudentId: conversation?.studentId || null,
    boundStudentDisplayName: conversation?.studentDisplayName || null,
    recentMessages: messages.slice().reverse().map(({ role, content }) => ({ role, content })),
    recentToolCalls: toolCalls.slice().reverse().map((toolCall) => ({
      toolName: toolCall.toolName,
      arguments: toolCall.arguments,
      result: toolCall.result,
      status: toolCall.status
    }))
  };
};
```

- [ ] **Step 5: Re-run backend tests and confirm the AI Assist suite is green**

Run:

```bash
cd TaiGerPortalService
npx jest --config __tests__/ai-assist.jest.config.js --runInBand --watchAll=false
```

Expected:

```text
PASS __tests__/services/ai_assist.test.js
```

- [ ] **Step 6: Commit**

```bash
git add TaiGerPortalService/services/ai-assist/tools.js TaiGerPortalService/services/ai-assist/orchestrator.js TaiGerPortalService/controllers/ai_assist.js TaiGerPortalService/__tests__/services/ai_assist.test.js
git commit -m "feat: add ai assist student quick start context"
```

### Task 3: Add frontend API contracts and draft conversation tests

**Files:**
- Modify: `TaiGerPortalStaticWebsite/src/api/types.ts`
- Modify: `TaiGerPortalStaticWebsite/src/api/apis.ts`
- Modify: `TaiGerPortalStaticWebsite/src/pages/AIAssist/AIAssistPage.test.tsx`

- [ ] **Step 1: Write failing frontend tests for draft state, starter actions, and keyboard send**

```typescript
it('creates a draft conversation without calling createAIAssistConversation', async () => {
  const user = userEvent.setup();
  render(<AIAssistPage />);

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'New conversation' })).toBeTruthy();
  });

  await user.click(screen.getByRole('button', { name: 'New conversation' }));

  expect(apiMocks.createAIAssistConversation).not.toHaveBeenCalled();
  expect(screen.getByText('Choose student')).toBeTruthy();
});

it('prefills starter action text without auto-sending', async () => {
  const user = userEvent.setup();
  render(<AIAssistPage />);

  await user.click(screen.getByRole('button', { name: 'Choose student' }));
  await user.click(screen.getByRole('button', { name: 'abby Student' }));
  await user.click(screen.getByRole('button', { name: 'Find application risks' }));

  expect(screen.getByLabelText('Ask TaiGer AI')).toHaveValue(
    expect.stringContaining('identify the main risks')
  );
  expect(apiMocks.postAIAssistMessage).not.toHaveBeenCalled();
});

it('sends on Enter and keeps newline on Shift+Enter', async () => {
  const user = userEvent.setup();
  render(<AIAssistPage />);

  const input = screen.getByLabelText('Ask TaiGer AI');
  await user.type(input, 'line 1{Shift>}{Enter}{/Shift}line 2');
  expect(input).toHaveValue('line 1\nline 2');
  await user.type(input, '{Enter}');

  expect(apiMocks.postAIAssistFirstMessage).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused frontend test file and verify the new behaviors fail**

Run:

```bash
cd TaiGerPortalStaticWebsite
npm run test:ci -- src/pages/AIAssist/AIAssistPage.test.tsx
```

Expected:

```text
FAIL src/pages/AIAssist/AIAssistPage.test.tsx
  × creates a draft conversation without calling createAIAssistConversation
  × prefills starter action text without auto-sending
  × sends on Enter and keeps newline on Shift+Enter
```

- [ ] **Step 3: Add API types and functions for first-message, archive, and picker lists**

```typescript
export interface AIAssistPickerStudent {
    id: string;
    name: string;
    chineseName?: string;
    email?: string;
}

export interface PostAIAssistFirstMessagePayload {
    message: string;
    studentId?: string;
    studentDisplayName?: string;
}

export interface DeleteAIAssistConversationResponse {
    success: boolean;
    data: AIAssistConversation;
}
```

```typescript
export const postAIAssistFirstMessage = (
    payload: PostAIAssistFirstMessagePayload
) =>
    postData<PostAIAssistFirstMessageResponse>(
        '/api/ai-assist/conversations/first-message',
        payload
    );

export const deleteAIAssistConversation = (conversationId: string) =>
    deleteData<DeleteAIAssistConversationResponse>(
        `/api/ai-assist/conversations/${conversationId}`
    );

export const getAIAssistRecentStudents = () =>
    getData<GetAIAssistPickerStudentsResponse>('/api/ai-assist/students/recent');
```

- [ ] **Step 4: Update the test mocks to use the new API surface**

```typescript
const apiMocks = vi.hoisted(() => ({
    createAIAssistConversation: vi.fn(),
    deleteAIAssistConversation: vi.fn(),
    getAIAssistConversation: vi.fn(),
    getAIAssistConversations: vi.fn(),
    getAIAssistMyStudents: vi.fn(),
    getAIAssistRecentStudents: vi.fn(),
    postAIAssistFirstMessage: vi.fn(),
    postAIAssistMessage: vi.fn(),
    searchAIAssistStudents: vi.fn(),
    updateAIAssistConversation: vi.fn()
}));
```

- [ ] **Step 5: Re-run the focused frontend test file and confirm the API contract layer is ready**

Run:

```bash
cd TaiGerPortalStaticWebsite
npm run test:ci -- src/pages/AIAssist/AIAssistPage.test.tsx
```

Expected:

```text
FAIL src/pages/AIAssist/AIAssistPage.test.tsx
  × renders new quick-start UI
```

The remaining failures should now be page implementation failures, not missing API symbol failures.

- [ ] **Step 6: Commit**

```bash
git add TaiGerPortalStaticWebsite/src/api/types.ts TaiGerPortalStaticWebsite/src/api/apis.ts TaiGerPortalStaticWebsite/src/pages/AIAssist/AIAssistPage.test.tsx
git commit -m "test: define ai assist draft conversation contract"
```

### Task 4: Implement draft conversation UI, student-first start flow, and per-message trace

**Files:**
- Modify: `TaiGerPortalStaticWebsite/src/pages/AIAssist/AIAssistPage.tsx`
- Modify: `TaiGerPortalStaticWebsite/src/pages/AIAssist/AIAssistPage.test.tsx`

- [ ] **Step 1: Make the page tests fail on the exact final UX expectations**

```typescript
it('renders assistant tool calls under the matching assistant message', async () => {
    render(<AIAssistPage />);

    await waitFor(() => {
        expect(screen.getByText('mocked AI Assist answer')).toBeTruthy();
    });

    expect(screen.getByText('Tools used (1)')).toBeTruthy();
    expect(screen.getAllByText('search_accessible_students').length).toBeGreaterThan(0);
});

it('archives and removes a conversation from the side rail', async () => {
    const user = userEvent.setup();
    render(<AIAssistPage />);

    await waitFor(() => {
        expect(screen.getByText('Latest risk review')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'Delete Latest risk review' }));

    await waitFor(() => {
        expect(apiMocks.deleteAIAssistConversation).toHaveBeenCalledWith('conv_latest');
    });
    expect(screen.queryByText('Latest risk review')).toBeNull();
});
```

- [ ] **Step 2: Run the focused frontend test and verify these final UX assertions fail**

Run:

```bash
cd TaiGerPortalStaticWebsite
npm run test:ci -- src/pages/AIAssist/AIAssistPage.test.tsx
```

Expected:

```text
FAIL src/pages/AIAssist/AIAssistPage.test.tsx
  × renders assistant tool calls under the matching assistant message
  × archives and removes a conversation from the side rail
```

- [ ] **Step 3: Implement draft state, student quick start, and first-send persistence**

```typescript
const [draftConversation, setDraftConversation] = useState<{
    studentId: string | null;
    studentDisplayName: string | null;
    starterAction: string | null;
} | null>(null);

const handleNewConversation = (): void => {
    setConversationId(null);
    setMessages([]);
    setTrace([]);
    setDraftConversation({
        studentId: null,
        studentDisplayName: null,
        starterAction: null
    });
};

const handleSubmit = async (): Promise<void> => {
    const trimmedInput = input.trim();
    if (!trimmedInput || isSending) {
        return;
    }

    setIsSending(true);
    try {
        if (!conversationId) {
            const response = await postAIAssistFirstMessage({
                message: trimmedInput,
                studentId: draftConversation?.studentId || undefined,
                studentDisplayName:
                    draftConversation?.studentDisplayName || undefined
            });
            const { conversation, userMessage, assistantMessage, trace: responseTrace } =
                response.data.data;
            addConversationToTop(conversation);
            setConversationId(conversation.id);
            setDraftConversation(null);
            setMessages([userMessage, assistantMessage]);
            setTrace(responseTrace || []);
            return;
        }

        const response = await postAIAssistMessage(conversationId, {
            message: trimmedInput
        });
        setMessages((previous) => [
            ...previous,
            response.data.data.userMessage,
            response.data.data.assistantMessage
        ]);
        setTrace(response.data.data.trace || []);
    } finally {
        setIsSending(false);
    }
};
```

- [ ] **Step 4: Implement keyboard submit, per-message trace grouping, and archive delete**

```typescript
const traceByAssistantMessageId = trace.reduce<Record<string, AIAssistToolCall[]>>(
    (accumulator, toolCall) => {
        if (!toolCall.assistantMessageId) {
            return accumulator;
        }
        accumulator[toolCall.assistantMessageId] = [
            ...(accumulator[toolCall.assistantMessageId] || []),
            toolCall
        ];
        return accumulator;
    },
    {}
);

const handleComposerKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void handleSubmit();
    }
};

const handleDeleteConversation = async (id: string): Promise<void> => {
    await deleteAIAssistConversation(id);
    setConversations((previous) => previous.filter((item) => item.id !== id));
    if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
        setTrace([]);
        setDraftConversation(null);
    }
};
```

- [ ] **Step 5: Run the focused frontend test file and then the full AI Assist frontend tests**

Run:

```bash
cd TaiGerPortalStaticWebsite
npm run test:ci -- src/pages/AIAssist/AIAssistPage.test.tsx src/pages/AIAssist/index.test.tsx
```

Expected:

```text
PASS src/pages/AIAssist/AIAssistPage.test.tsx
PASS src/pages/AIAssist/index.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git add TaiGerPortalStaticWebsite/src/pages/AIAssist/AIAssistPage.tsx TaiGerPortalStaticWebsite/src/pages/AIAssist/AIAssistPage.test.tsx
git commit -m "feat: ship ai assist draft conversation ux"
```

### Task 5: Verify the integrated backend and frontend slices

**Files:**
- Modify: `TaiGerPortalService/__tests__/services/ai_assist.test.js`
- Modify: `TaiGerPortalStaticWebsite/src/pages/AIAssist/AIAssistPage.test.tsx`

- [ ] **Step 1: Add one integrated regression test per side**

```javascript
it('treats archived conversations as not found for sendMessage', async () => {
  getPostgresDb.mockReturnValue({
    select: jest.fn(() => ({
      from: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn().mockResolvedValue([])
        }))
      }))
    }))
  });

  await expect(
    sendMessage(
      {
        params: { conversationId: 'conv_archived' },
        user: { _id: 'agent_1', role: Role.Agent },
        body: { message: 'hello' }
      },
      createResponse()
    )
  ).rejects.toThrow('AI Assist conversation not found');
});
```

```typescript
it('keeps the draft intact when first-message fails', async () => {
    apiMocks.postAIAssistFirstMessage.mockRejectedValueOnce(
        new Error('Request failed')
    );
    const user = userEvent.setup();
    render(<AIAssistPage />);

    await user.click(screen.getByRole('button', { name: 'Blank chat' }));
    await user.type(screen.getByLabelText('Ask TaiGer AI'), 'Need help');
    await user.type(screen.getByLabelText('Ask TaiGer AI'), '{Enter}');

    await waitFor(() => {
        expect(screen.getByText('Request failed')).toBeTruthy();
    });
    expect(screen.getByLabelText('Ask TaiGer AI')).toHaveValue('Need help');
});
```

- [ ] **Step 2: Run backend and frontend AI Assist suites back to back**

Run:

```bash
cd TaiGerPortalService
npx jest --config __tests__/ai-assist.jest.config.js --runInBand --watchAll=false
cd ../TaiGerPortalStaticWebsite
npm run test:ci -- src/pages/AIAssist/AIAssistPage.test.tsx src/pages/AIAssist/index.test.tsx
```

Expected:

```text
PASS __tests__/services/ai_assist.test.js
PASS src/pages/AIAssist/AIAssistPage.test.tsx
PASS src/pages/AIAssist/index.test.tsx
```

- [ ] **Step 3: Run lightweight static checks for touched frontend code**

Run:

```bash
cd TaiGerPortalStaticWebsite
npm run typecheck
```

Expected:

```text
Found 0 errors.
```

- [ ] **Step 4: If typecheck exposes unrelated pre-existing errors, capture only the AI Assist-specific result in the commit message**

```text
Typecheck note: global project has pre-existing errors outside AI Assist scope; AI Assist page and API modules compile clean in editor and targeted tests pass.
```

- [ ] **Step 5: Commit**

```bash
git add TaiGerPortalService/__tests__/services/ai_assist.test.js TaiGerPortalStaticWebsite/src/pages/AIAssist/AIAssistPage.test.tsx TaiGerPortalStaticWebsite/src/pages/AIAssist/AIAssistPage.tsx TaiGerPortalStaticWebsite/src/api/apis.ts TaiGerPortalStaticWebsite/src/api/types.ts TaiGerPortalService/controllers/ai_assist.js TaiGerPortalService/routes/ai_assist.js TaiGerPortalService/services/ai-assist/orchestrator.js TaiGerPortalService/services/ai-assist/tools.js TaiGerPortalService/drizzle/schema/aiAssist.js TaiGerPortalService/drizzle/migrations/0004_ai_assist_conversation_context.sql
git commit -m "test: verify ai assist redesign end to end"
```
