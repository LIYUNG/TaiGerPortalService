const makeTool = (name, description, properties, required = []) => ({
  type: 'function',
  name,
  description,
  parameters: {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  }
});

const stringProperty = (description) => ({
  type: 'string',
  description
});

const integerProperty = (description, maximum) => ({
  type: 'integer',
  description,
  minimum: 1,
  maximum
});

const aiAssistToolDefinitions = [
  makeTool(
    'search_students',
    'Search active TaiGer students accessible to the current user by name, Chinese name, email, or related query.',
    {
      query: stringProperty('Search text from the user question.'),
      limit: integerProperty('Maximum number of students to return.', 25)
    },
    ['query']
  ),
  makeTool(
    'get_student_context',
    'Get normalized profile context for one accessible TaiGer student.',
    {
      studentId: stringProperty('TaiGer student id returned by search_students.')
    },
    ['studentId']
  ),
  makeTool(
    'get_application_context',
    'Get normalized application context for one accessible TaiGer student, including status, risks, and next actions.',
    {
      studentId: stringProperty('TaiGer student id returned by search_students.')
    },
    ['studentId']
  ),
  makeTool(
    'get_recent_communication_context',
    'Get normalized recent communication context for one accessible TaiGer student (default 30 days).',
    {
      studentId: stringProperty('TaiGer student id returned by search_students.'),
      limit: integerProperty('Maximum number of messages to return.', 50),
      days: integerProperty('How many recent days to include.', 90)
    },
    ['studentId']
  ),
  makeTool(
    'get_all_communication_context',
    'Get normalized all-time communication context for one accessible TaiGer student with capped message volume.',
    {
      studentId: stringProperty('TaiGer student id returned by search_students.'),
      limit: integerProperty('Maximum number of messages to return.', 200)
    },
    ['studentId']
  ),
  makeTool(
    'get_document_context',
    'Get normalized profile document context for one accessible TaiGer student, including missing required documents.',
    {
      studentId: stringProperty('TaiGer student id returned by search_students.')
    },
    ['studentId']
  ),
  makeTool(
    'get_support_ticket_context',
    'Get normalized support ticket context for one accessible TaiGer student.',
    {
      studentId: stringProperty('TaiGer student id returned by search_students.'),
      limit: integerProperty('Maximum number of tickets to return.', 25)
    },
    ['studentId']
  ),
  makeTool(
    'get_document_thread_context',
    'Get normalized document thread status and recent messages for one accessible TaiGer student.',
    {
      studentId: stringProperty('TaiGer student id returned by search_students.')
    },
    ['studentId']
  ),
  makeTool(
    'get_crm_lead_meeting_context',
    'Get CRM lead + meetings transcript context for one accessible TaiGer student, with role and assignment checks.',
    {
      studentId: stringProperty('TaiGer student id returned by search_students.'),
      limit: integerProperty('Maximum number of meetings to return.', 20)
    },
    ['studentId']
  ),
  makeTool(
    'search_accessible_students',
    'Search active TaiGer students accessible to the current user by name, Chinese name, email, or related query.',
    {
      query: stringProperty('Search text from the user question.'),
      limit: integerProperty('Maximum number of students to return.', 25)
    },
    ['query']
  ),
  makeTool(
    'get_student_summary',
    'Get summary facts for one accessible TaiGer student, including assigned team and profile document statuses.',
    {
      studentId: stringProperty(
        'TaiGer student id returned by search_accessible_students.'
      )
    },
    ['studentId']
  ),
  makeTool(
    'get_student_applications',
    'Get application, admission, final enrolment, and program facts for one accessible TaiGer student.',
    {
      studentId: stringProperty(
        'TaiGer student id returned by search_accessible_students.'
      )
    },
    ['studentId']
  ),
  makeTool(
    'get_latest_communications',
    'Get recent communication messages for one accessible TaiGer student.',
    {
      studentId: stringProperty(
        'TaiGer student id returned by search_accessible_students.'
      ),
      limit: integerProperty('Maximum number of messages to return.', 50)
    },
    ['studentId']
  ),
  makeTool(
    'get_profile_documents',
    'Get profile document checklist and statuses for one accessible TaiGer student.',
    {
      studentId: stringProperty(
        'TaiGer student id returned by search_accessible_students.'
      )
    },
    ['studentId']
  ),
  makeTool(
    'get_admissions_overview',
    'Get admitted applications for one accessible TaiGer student.',
    {
      studentId: stringProperty(
        'TaiGer student id returned by search_accessible_students.'
      )
    },
    ['studentId']
  ),
  makeTool(
    'get_support_tickets',
    'Get support tickets. Pass studentId when the user asks about one specific student.',
    {
      studentId: stringProperty(
        'Optional TaiGer student id returned by search_accessible_students.'
      ),
      limit: integerProperty('Maximum number of tickets to return.', 25)
    }
  ),
  makeTool(
    'get_program_brief',
    'Get basic program facts for a TaiGer program id seen in prior tool output.',
    {
      programId: stringProperty('TaiGer program id from application tool output.')
    },
    ['programId']
  )
];

const aiAssistToolDefinitionsByName = aiAssistToolDefinitions.reduce(
  (definitions, definition) => ({
    ...definitions,
    [definition.name]: definition
  }),
  {}
);

const selectAiAssistToolDefinitions = (toolNames = []) =>
  toolNames
    .map((toolName) => aiAssistToolDefinitionsByName[toolName])
    .filter(Boolean);

module.exports = {
  aiAssistToolDefinitions,
  aiAssistToolDefinitionsByName,
  selectAiAssistToolDefinitions
};
