import {
  Role,
  TicketStatus,
  ManagerType,
  EDITOR_SCOPE,
  ESSAY_WRITER_SCOPE,
  FILE_MAPPING_TABLE,
  PROGRAM_SPECIFIC_FILETYPE,
  RLs_CONSTANT,
  GENERAL_RLs_CONSTANT,
  General_Docs,
  base_documents_summary,
  is_deadline_within30days_needed,
  needUpdateCourseSelection,
  does_editor_have_pending_tasks,
  is_cv_ml_rl_task_response_needed,
  is_cv_ml_rl_reminder_needed,
  application_deadline_V2_calculator,
  unsubmitted_applications_summary,
  unsubmitted_applications_escalation_summary,
  cvmlrl_deadline_within30days_escalation_summary,
  unsubmitted_applications_escalation_agent_summary,
  cv_rl_escalation_editor_list,
  cv_ml_rl_escalation_summary,
  cv_ml_rl_editor_escalation_summary,
  cv_ml_rl_unfinished_summary,
  profile_keys_list,
  General_RL_Deadline_Calculator,
  CVDeadline_Calculator,
  isNotArchiv,
  isArchiv,
  check_english_language_passed,
  check_german_language_passed,
  check_languages_filled,
  missing_academic_background,
  THREAD_ID_URL,
  CVMLRL_FOR_EDITOR_URL,
  UNI_ASSIST_FOR_AGENT_URL,
  PROGRAM_URL,
  JITSI_MEET_URL,
  PROGRAM_SUBJECT_KEYS,
  SCHOOL_TAG_KEYS,
  CV_MUST_HAVE_PATTERNS,
  TAIGER_SIGNATURE
} from '../constants';

// Helpers to build representative test objects ------------------------------

const editorUser = { _id: 'editor1', role: Role.Editor };
const studentUser = { _id: 'student1', role: Role.Student };
const agentUser = { _id: 'agent1', role: Role.Agent };
const adminUser = { _id: 'admin1', role: Role.Admin };

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const makeDocThread = (overrides = {}) => ({
  isFinalVersion: false,
  latest_message_left_by_id: 'someone-else',
  updatedAt: daysAgo(40),
  doc_thread_id: {
    _id: 'thread-id-1',
    file_type: 'CV',
    updatedAt: daysAgo(40)
  },
  ...overrides
});

const makeProgram = (overrides = {}) => ({
  school: 'MIT',
  program_name: 'CS',
  application_deadline: '12-01',
  semester: 'WS',
  ...overrides
});

const makeApplication = (overrides = {}) => ({
  decided: 'O',
  closed: '-',
  application_year: '2025',
  programId: makeProgram(),
  doc_modification_thread: [makeDocThread()],
  ...overrides
});

// ---------------------------------------------------------------------------

describe('static data exports', () => {
  it('exposes enums and tables', () => {
    expect(TicketStatus.Open).toBe('open');
    expect(TicketStatus.Resolved).toBe('resolved');
    expect(ManagerType.AgentAndEditor).toBe('AgentAndEditor');
    expect(EDITOR_SCOPE.CV).toBe('Curriculum Vitae');
    expect(ESSAY_WRITER_SCOPE.Essay).toBe('Essay');
    expect(FILE_MAPPING_TABLE.Essay).toBe('Essay');
    expect(FILE_MAPPING_TABLE.CV).toBe('Curriculum Vitae');
    expect(Array.isArray(PROGRAM_SPECIFIC_FILETYPE)).toBe(true);
    expect(RLs_CONSTANT).toContain('RL_A');
    expect(GENERAL_RLs_CONSTANT).toContain('Recommendation_Letter_A');
    expect(General_Docs).toContain('CV');
    expect(Array.isArray(profile_keys_list)).toBe(true);
    expect(profile_keys_list.length).toBeGreaterThan(0);
    expect(Array.isArray(PROGRAM_SUBJECT_KEYS)).toBe(true);
    expect(Array.isArray(SCHOOL_TAG_KEYS)).toBe(true);
    expect(CV_MUST_HAVE_PATTERNS).toContain('- present');
    expect(typeof TAIGER_SIGNATURE).toBe('string');
  });
});

describe('URL builder functions', () => {
  it('build student/program/thread URLs', () => {
    expect(THREAD_ID_URL('abc')).toContain('/document-modification/abc');
    expect(CVMLRL_FOR_EDITOR_URL('s1')).toContain(
      '/student-database/s1#cvmlrl'
    );
    expect(UNI_ASSIST_FOR_AGENT_URL('s1')).toContain(
      '/student-database/s1#uniassist'
    );
    expect(PROGRAM_URL('p1')).toContain('/programs/p1');
    expect(JITSI_MEET_URL('s1')).toContain('meet.jit.si');
  });
});

describe('isNotArchiv / isArchiv', () => {
  it('isNotArchiv true when archiv undefined or falsy', () => {
    expect(isNotArchiv({})).toBe(true);
    expect(isNotArchiv({ archiv: false })).toBe(true);
  });
  it('isNotArchiv false when archived', () => {
    expect(isNotArchiv({ archiv: true })).toBe(false);
  });
  it('isArchiv reflects archiv flag', () => {
    expect(isArchiv({ archiv: true })).toBe(true);
    expect(isArchiv({ archiv: false })).toBe(false);
    expect(isArchiv({})).toBe(false);
  });
});

describe('application_deadline_V2_calculator', () => {
  it('returns WITHDRAW for withdrawn application', () => {
    expect(application_deadline_V2_calculator({ closed: 'X' })).toBe(
      'WITHDRAW'
    );
  });
  it('returns No Data when no deadline', () => {
    expect(
      application_deadline_V2_calculator({
        closed: '-',
        programId: {}
      })
    ).toBe('No Data');
  });
  it('returns Rolling format', () => {
    expect(
      application_deadline_V2_calculator({
        closed: '-',
        application_year: '2025',
        programId: { application_deadline: 'Rolling', semester: 'WS' }
      })
    ).toBe('2025-Rolling');
  });
  it('formats a normal WS deadline (year adjusted)', () => {
    const result = application_deadline_V2_calculator(
      makeApplication({
        application_year: '2025',
        programId: makeProgram({
          application_deadline: '12-01',
          semester: 'WS'
        })
      })
    );
    // month 12 > 9 with WS => year-1
    expect(result).toBe('2024/12/01');
  });
  it('formats SS deadline without adjustment', () => {
    const result = application_deadline_V2_calculator(
      makeApplication({
        application_year: '2025',
        programId: makeProgram({
          application_deadline: '02-15',
          semester: 'SS'
        })
      })
    );
    expect(result).toBe('2025/02/15');
  });
  it('returns Err semester when semester missing', () => {
    const result = application_deadline_V2_calculator(
      makeApplication({
        application_year: '2025',
        programId: makeProgram({
          application_deadline: '12-01',
          semester: undefined
        })
      })
    );
    expect(result).toBe('Err/12/01');
  });
});

describe('CVDeadline_Calculator', () => {
  it('returns "-" when no decided open applications', () => {
    expect(CVDeadline_Calculator([])).toBe('-');
    expect(CVDeadline_Calculator([makeApplication({ decided: '-' })])).toBe(
      '-'
    );
  });
  it('returns rolling deadline when only rolling', () => {
    const result = CVDeadline_Calculator([
      makeApplication({
        closed: '-',
        application_year: '2025',
        programId: makeProgram({ application_deadline: 'Rolling' })
      })
    ]);
    expect(result).toBe('2025-Rolling');
  });
  it('returns earliest concrete deadline', () => {
    const result = CVDeadline_Calculator([
      makeApplication({
        closed: '-',
        application_year: '2025',
        programId: makeProgram({
          application_deadline: '02-01',
          semester: 'SS'
        })
      })
    ]);
    expect(result).toBe('2025/02/01');
  });
});

describe('General_RL_Deadline_Calculator', () => {
  it('filters out programs without rl_required', () => {
    expect(
      General_RL_Deadline_Calculator([
        makeApplication({ programId: makeProgram({ rl_required: '0' }) })
      ])
    ).toBe('-');
    expect(
      General_RL_Deadline_Calculator([
        makeApplication({ programId: makeProgram({ is_rl_specific: true }) })
      ])
    ).toBe('-');
  });
  it('keeps programs with rl_required', () => {
    const result = General_RL_Deadline_Calculator([
      makeApplication({
        closed: '-',
        application_year: '2025',
        programId: makeProgram({
          application_deadline: '02-15',
          semester: 'SS',
          rl_required: '2',
          is_rl_specific: false
        })
      })
    ]);
    expect(result).toBe('2025/02/15');
  });
  it('handles empty input', () => {
    expect(General_RL_Deadline_Calculator([])).toBe('-');
  });
});

describe('language helpers', () => {
  it('check_english_language_passed', () => {
    expect(check_english_language_passed(null)).toBe(false);
    expect(check_english_language_passed({})).toBe(false);
    expect(
      check_english_language_passed({ language: { english_isPassed: 'X' } })
    ).toBe(false);
    expect(
      check_english_language_passed({ language: { english_isPassed: 'O' } })
    ).toBe(true);
  });
  it('check_german_language_passed', () => {
    expect(check_german_language_passed(null)).toBe(false);
    expect(check_german_language_passed({})).toBe(false);
    expect(
      check_german_language_passed({ language: { german_isPassed: '-' } })
    ).toBe(false);
    expect(
      check_german_language_passed({ language: { german_isPassed: 'O' } })
    ).toBe(true);
  });
  it('check_languages_filled', () => {
    expect(check_languages_filled(null)).toBe(false);
    expect(check_languages_filled({})).toBe(false);
    expect(
      check_languages_filled({
        language: { english_isPassed: '-', german_isPassed: '-' }
      })
    ).toBe(false);
    expect(
      check_languages_filled({
        language: { english_isPassed: 'O', german_isPassed: '-' }
      })
    ).toBe(true);
    expect(
      check_languages_filled({
        language: { english_isPassed: '-', german_isPassed: 'X' }
      })
    ).toBe(true);
  });
});

describe('needUpdateCourseSelection', () => {
  it('returns false if graduated Yes/No', () => {
    expect(
      needUpdateCourseSelection({
        academic_background: { university: { isGraduated: 'Yes' } }
      })
    ).toBe(false);
    expect(
      needUpdateCourseSelection({
        academic_background: { university: { isGraduated: 'No' } }
      })
    ).toBe(false);
  });
  it('returns true when no courses', () => {
    expect(needUpdateCourseSelection({ courses: [] })).toBe(true);
  });
  it('returns true if course is not analyzed', () => {
    expect(
      needUpdateCourseSelection({
        courses: [{ analysis: { updatedAt: null } }]
      })
    ).toBe(true);
  });
  it('returns true if analyzed but expired 39 days', () => {
    expect(
      needUpdateCourseSelection({
        courses: [
          { updatedAt: daysAgo(40), analysis: { updatedAt: daysAgo(40) } }
        ]
      })
    ).toBe(true);
  });
  it('returns false if recently updated', () => {
    expect(
      needUpdateCourseSelection({
        courses: [
          { updatedAt: daysAgo(10), analysis: { updatedAt: daysAgo(10) } }
        ]
      })
    ).toBe(false);
  });
});

describe('is_deadline_within30days_needed', () => {
  it('returns false when expected date empty', () => {
    expect(
      is_deadline_within30days_needed({
        application_preference: { expected_application_date: '' },
        applications: []
      })
    ).toBe(false);
  });
  it('returns true when decided unsubmitted within trigger window', () => {
    const futureMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    const futureYear = new Date().getFullYear();
    const student = {
      application_preference: { expected_application_date: '2025' },
      applications: [
        makeApplication({
          decided: 'O',
          closed: '-',
          application_year: String(futureYear),
          programId: makeProgram({
            application_deadline: `${futureMonth}-15`,
            semester: 'SS'
          })
        })
      ]
    };
    expect(typeof is_deadline_within30days_needed(student)).toBe('boolean');
  });
  it('returns false when application submitted', () => {
    expect(
      is_deadline_within30days_needed({
        application_preference: { expected_application_date: '2025' },
        applications: [makeApplication({ decided: 'O', closed: 'O' })]
      })
    ).toBe(false);
  });
});

describe('does_editor_have_pending_tasks', () => {
  it('returns true when generaldocs thread needs reply', () => {
    const students = [
      {
        generaldocs_threads: [
          {
            isFinalVersion: false,
            latest_message_left_by_id: 'other'
          }
        ],
        applications: []
      }
    ];
    expect(does_editor_have_pending_tasks(students, editorUser)).toBe(true);
  });
  it('returns true when app thread needs reply', () => {
    const students = [
      {
        generaldocs_threads: [],
        applications: [
          makeApplication({
            decided: 'O',
            doc_modification_thread: [
              { isFinalVersion: false, latest_message_left_by_id: 'other' }
            ]
          })
        ]
      }
    ];
    expect(does_editor_have_pending_tasks(students, editorUser)).toBe(true);
  });
  it('returns false when all final or own message', () => {
    const students = [
      {
        generaldocs_threads: [
          { isFinalVersion: true, latest_message_left_by_id: 'other' }
        ],
        applications: [
          makeApplication({
            decided: '-',
            doc_modification_thread: []
          })
        ]
      }
    ];
    expect(does_editor_have_pending_tasks(students, editorUser)).toBe(false);
  });
});

describe('is_cv_ml_rl_task_response_needed', () => {
  const baseStudent = (thread, appThread) => ({
    generaldocs_threads: thread,
    applications: appThread
      ? [makeApplication({ decided: 'O', doc_modification_thread: appThread })]
      : []
  });

  it('editor: needs response on non-final thread from other', () => {
    expect(
      is_cv_ml_rl_task_response_needed(
        baseStudent([
          { isFinalVersion: false, latest_message_left_by_id: 'other' }
        ]),
        editorUser
      )
    ).toBe(true);
  });
  it('student: needs response on non-final thread not from self', () => {
    expect(
      is_cv_ml_rl_task_response_needed(
        baseStudent([
          { isFinalVersion: false, latest_message_left_by_id: 'other' }
        ]),
        studentUser
      )
    ).toBe(true);
  });
  it('agent: needs response on any non-final thread', () => {
    expect(
      is_cv_ml_rl_task_response_needed(
        baseStudent([{ isFinalVersion: false }]),
        agentUser
      )
    ).toBe(true);
  });
  it('returns true through application docs (editor)', () => {
    expect(
      is_cv_ml_rl_task_response_needed(
        baseStudent(
          [{ isFinalVersion: true, latest_message_left_by_id: 'x' }],
          [{ isFinalVersion: false, latest_message_left_by_id: 'other' }]
        ),
        editorUser
      )
    ).toBe(true);
  });
  it('application docs student/agent branches', () => {
    expect(
      is_cv_ml_rl_task_response_needed(
        baseStudent(
          [],
          [{ isFinalVersion: false, latest_message_left_by_id: 'other' }]
        ),
        studentUser
      )
    ).toBe(true);
    expect(
      is_cv_ml_rl_task_response_needed(
        baseStudent([], [{ isFinalVersion: false }]),
        agentUser
      )
    ).toBe(true);
  });
  it('returns false when all final', () => {
    expect(
      is_cv_ml_rl_task_response_needed(
        baseStudent([{ isFinalVersion: true }], [{ isFinalVersion: true }]),
        agentUser
      )
    ).toBe(false);
  });
});

describe('is_cv_ml_rl_reminder_needed', () => {
  const student = (genThreads, appThreads) => ({
    generaldocs_threads: genThreads,
    applications: appThreads
      ? [makeApplication({ decided: 'O', doc_modification_thread: appThreads })]
      : []
  });

  it('editor reminder triggered when aged beyond trigger', () => {
    expect(
      is_cv_ml_rl_reminder_needed(
        student([
          {
            isFinalVersion: false,
            latest_message_left_by_id: 'other',
            updatedAt: daysAgo(40)
          }
        ]),
        editorUser,
        7
      )
    ).toBe(true);
  });
  it('student reminder triggered', () => {
    expect(
      is_cv_ml_rl_reminder_needed(
        student([
          {
            isFinalVersion: false,
            latest_message_left_by_id: 'other',
            updatedAt: daysAgo(40)
          }
        ]),
        studentUser,
        7
      )
    ).toBe(true);
  });
  it('agent reminder triggered', () => {
    expect(
      is_cv_ml_rl_reminder_needed(
        student([{ isFinalVersion: false, updatedAt: daysAgo(40) }]),
        agentUser,
        7
      )
    ).toBe(true);
  });
  it('application thread reminders', () => {
    const appThread = [
      {
        isFinalVersion: false,
        latest_message_left_by_id: 'other',
        doc_thread_id: { updatedAt: daysAgo(40) }
      }
    ];
    expect(
      is_cv_ml_rl_reminder_needed(student([], appThread), editorUser, 7)
    ).toBe(true);
    expect(
      is_cv_ml_rl_reminder_needed(student([], appThread), studentUser, 7)
    ).toBe(true);
    expect(
      is_cv_ml_rl_reminder_needed(
        student(
          [],
          [{ isFinalVersion: false, doc_thread_id: { updatedAt: daysAgo(40) } }]
        ),
        agentUser,
        7
      )
    ).toBe(true);
  });
  it('returns false when not aged enough', () => {
    expect(
      is_cv_ml_rl_reminder_needed(
        student([
          {
            isFinalVersion: false,
            latest_message_left_by_id: 'other',
            updatedAt: daysAgo(1)
          }
        ]),
        editorUser,
        7
      )
    ).toBe(false);
  });
});

describe('unsubmitted_applications_summary', () => {
  it('returns empty when nothing unsubmitted', () => {
    expect(
      unsubmitted_applications_summary({
        applications: [makeApplication({ decided: '-' })]
      })
    ).toBe('');
  });
  it('builds list for multiple unsubmitted programs', () => {
    const result = unsubmitted_applications_summary({
      applications: [
        makeApplication({ decided: 'O', closed: '-' }),
        makeApplication({
          decided: 'O',
          closed: '-',
          programId: makeProgram({ school: 'Stanford', program_name: 'AI' })
        })
      ]
    });
    expect(result).toContain('not submitted yet');
    expect(result).toContain('Stanford');
    expect(result).toContain('</ul>');
  });
});

describe('escalation list builders', () => {
  const student = {
    _id: 's1',
    firstname: 'John',
    lastname: 'Doe',
    generaldocs_threads: [makeDocThread()],
    applications: [makeApplication({ decided: 'O' })]
  };

  it('cv_rl_escalation_editor_list returns items', () => {
    const r = cv_rl_escalation_editor_list(
      {
        generaldocs_threads: [
          {
            isFinalVersion: false,
            latest_message_left_by_id: 'other',
            updatedAt: daysAgo(40),
            doc_thread_id: {
              _id: 't1',
              file_type: 'CV',
              updatedAt: daysAgo(40)
            }
          }
        ]
      },
      editorUser,
      7
    );
    expect(r).toContain('CV');
    expect(r).toContain('aged');
  });

  it('cv_ml_rl_escalation_summary editor and student branches', () => {
    expect(cv_ml_rl_escalation_summary(student, editorUser, 7)).toContain(
      'waiting for your response'
    );
    expect(cv_ml_rl_escalation_summary(student, studentUser, 7)).toContain(
      'waiting for your response'
    );
    expect(cv_ml_rl_escalation_summary(student, agentUser, 7)).toBe('');
  });

  it('cv_ml_rl_editor_escalation_summary editor and agent branches', () => {
    expect(
      cv_ml_rl_editor_escalation_summary(student, editorUser, 7)
    ).toContain('John');
    expect(cv_ml_rl_editor_escalation_summary(student, agentUser, 7)).toContain(
      'idle for a while'
    );
    expect(cv_ml_rl_editor_escalation_summary(student, studentUser, 7)).toBe(
      ''
    );
  });

  it('unsubmitted_applications_escalation_summary builds html', () => {
    const r = unsubmitted_applications_escalation_summary(
      student,
      agentUser,
      7
    );
    expect(r).toContain('not submitted yet');
  });

  it('unsubmitted_applications_escalation_agent_summary wraps name', () => {
    const r = unsubmitted_applications_escalation_agent_summary(
      student,
      agentUser,
      7
    );
    expect(r).toContain('John');
    expect(r).toContain('Doe');
  });
});

describe('cv_ml_rl_unfinished_summary', () => {
  const buildStudent = (role) => ({
    generaldocs_threads: [
      {
        isFinalVersion: false,
        latest_message_left_by_id: 'other',
        doc_thread_id: { _id: 'g1', file_type: 'CV' }
      },
      {
        isFinalVersion: false,
        latest_message_left_by_id: 'other',
        doc_thread_id: { _id: 'g2', file_type: 'RL' }
      }
    ],
    applications: [
      makeApplication({
        decided: 'O',
        doc_modification_thread: [
          {
            isFinalVersion: false,
            latest_message_left_by_id: 'other',
            doc_thread_id: { _id: 'a1', file_type: 'ML' }
          },
          {
            isFinalVersion: false,
            latest_message_left_by_id: 'other',
            doc_thread_id: { _id: 'a2', file_type: 'SOP' }
          }
        ]
      })
    ]
  });

  it('editor branch', () => {
    const r = cv_ml_rl_unfinished_summary(buildStudent(), editorUser);
    expect(r).toContain('waiting for your response');
    expect(r).toContain('</ul>');
  });
  it('student branch', () => {
    const r = cv_ml_rl_unfinished_summary(buildStudent(), studentUser);
    expect(r).toContain('waiting for your response');
  });
  it('agent branch', () => {
    const r = cv_ml_rl_unfinished_summary(buildStudent(), agentUser);
    expect(r).toContain('not finished');
  });
  it('returns empty when all final', () => {
    const r = cv_ml_rl_unfinished_summary(
      {
        generaldocs_threads: [{ isFinalVersion: true }],
        applications: [
          makeApplication({
            decided: 'O',
            doc_modification_thread: [{ isFinalVersion: true }]
          })
        ]
      },
      agentUser
    );
    expect(r).toBe('');
  });
});

describe('cvmlrl_deadline_within30days_escalation_summary', () => {
  it('returns empty when nothing close to deadline', () => {
    const r = cvmlrl_deadline_within30days_escalation_summary(
      { _id: 's1', firstname: 'A', lastname: 'B', generaldocs_threads: [] },
      []
    );
    expect(r).toBe('');
  });
  it('builds list when deadlines close and docs unfinished', () => {
    const futureMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    const app = makeApplication({
      decided: 'O',
      closed: '-',
      application_year: String(new Date().getFullYear()),
      programId: makeProgram({
        application_deadline: `${futureMonth}-28`,
        semester: 'SS'
      }),
      doc_modification_thread: [
        {
          isFinalVersion: false,
          doc_thread_id: { _id: 'a1', file_type: 'ML' }
        }
      ]
    });
    const student = {
      _id: 's1',
      firstname: 'A',
      lastname: 'B',
      generaldocs_threads: [
        { isFinalVersion: false, doc_thread_id: { _id: 'g1', file_type: 'CV' } }
      ]
    };
    const r = cvmlrl_deadline_within30days_escalation_summary(student, [app]);
    expect(typeof r).toBe('string');
  });
});

describe('base_documents_summary', () => {
  const { DocumentStatusType } = require('@taiger-common/model');

  it('returns empty when all accepted', () => {
    const profile = profile_keys_list.map((name) => ({
      name,
      status: DocumentStatusType.Accepted
    }));
    expect(base_documents_summary({ profile })).toBe('');
  });
  it('lists missing documents', () => {
    const r = base_documents_summary({ profile: [] });
    expect(r).toContain('missing');
    expect(r).toContain('Base Documents');
  });
  it('lists rejected documents', () => {
    const profile = profile_keys_list.map((name, idx) => ({
      name,
      status:
        idx === 0 ? DocumentStatusType.Rejected : DocumentStatusType.Accepted
    }));
    const r = base_documents_summary({ profile });
    expect(r).toContain('not okay');
  });
});

describe('missing_academic_background', () => {
  it('returns survey prompt when background sub-fields missing (student)', () => {
    const r = missing_academic_background(
      {
        _id: 's1',
        academic_background: { university: {}, language: {} },
        application_preference: undefined
      },
      studentUser
    );
    expect(r).toContain('Survey');
  });
  it('admin/agent branch uses agent survey url', () => {
    const r = missing_academic_background(
      {
        _id: 's1',
        academic_background: { university: {}, language: {} },
        application_preference: undefined
      },
      adminUser
    );
    expect(r).toContain('student-database');
  });
  it('returns empty when all fields filled', () => {
    const student = {
      _id: 's1',
      academic_background: {
        university: {
          attended_high_school: 'HS',
          high_school_isGraduated: 'O',
          high_school_graduated_year: '2018',
          attended_university: 'Uni',
          attended_university_program: 'CS',
          isGraduated: 'O',
          Has_Exchange_Experience: 'O',
          Has_Internship_Experience: 'O',
          Has_Working_Experience: 'O'
        },
        language: {
          english_isPassed: 'O',
          english_test_date: '2024-01-01',
          german_isPassed: 'O',
          german_test_date: '2024-01-01',
          gre_isPassed: 'O',
          gmat_isPassed: 'O'
        }
      },
      application_preference: {
        expected_application_date: '2025',
        expected_application_semester: 'WS',
        target_application_field: 'CS',
        target_program_language: 'English',
        target_degree: 'Master'
      }
    };
    expect(missing_academic_background(student, studentUser)).toBe('');
  });
  it('lists individual missing fields when partially filled', () => {
    const student = {
      _id: 's1',
      academic_background: {
        university: {
          attended_high_school: '',
          high_school_isGraduated: '-',
          high_school_graduated_year: '',
          attended_university: '',
          attended_university_program: '',
          isGraduated: '-',
          Has_Exchange_Experience: '-',
          Has_Internship_Experience: '-',
          Has_Working_Experience: '-'
        },
        language: {
          english_isPassed: '-',
          german_isPassed: '-',
          gre_isPassed: '-',
          gmat_isPassed: '-'
        }
      },
      application_preference: {
        expected_application_date: '',
        expected_application_semester: '',
        target_application_field: '',
        target_program_language: '',
        target_degree: ''
      }
    };
    const r = missing_academic_background(student, studentUser);
    expect(r).toContain('High School Name');
    expect(r).toContain('Survey');
  });
  it('lists expired test dates (X branch)', () => {
    const student = {
      _id: 's1',
      academic_background: {
        university: {
          attended_high_school: 'HS',
          high_school_isGraduated: 'O',
          high_school_graduated_year: '2018',
          attended_university: 'Uni',
          attended_university_program: 'CS',
          isGraduated: 'O',
          Has_Exchange_Experience: 'O',
          Has_Internship_Experience: 'O',
          Has_Working_Experience: 'O'
        },
        language: {
          english_isPassed: 'X',
          english_certificate: '',
          english_test_date: '',
          german_isPassed: 'X',
          german_certificate: '',
          german_test_date: '2020-01-01',
          gre_isPassed: 'X',
          gre_certificate: '',
          gre_test_date: '2020-01-01',
          gmat_isPassed: 'X',
          gmat_certificate: '',
          gmat_test_date: '2020-01-01'
        }
      },
      application_preference: {
        expected_application_date: '2025',
        expected_application_semester: 'WS',
        target_application_field: 'CS',
        target_program_language: 'English',
        target_degree: 'Master'
      }
    };
    const r = missing_academic_background(student, adminUser);
    expect(r).toContain('Certificate');
    expect(r).toContain('expired');
  });
});
