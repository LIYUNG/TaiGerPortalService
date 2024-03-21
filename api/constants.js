const { ORIGIN, ESCALATION_DEADLINE_DAYS_TRIGGER } = require('./config');
const Role = {
  Admin: 'Admin',
  Manager: 'Manager',
  Guest: 'Guest',
  Agent: 'Agent',
  Editor: 'Editor',
  Student: 'Student'
};
const ACCOUNT_ACTIVATION_URL = new URL('/account/activation', ORIGIN).href;
const RESEND_ACTIVATION_URL = new URL('/account/resend-activation', ORIGIN)
  .href;
const PASSWORD_RESET_URL = new URL('/account/reset-password', ORIGIN).href;
const FORGOT_PASSWORD_URL = new URL('/forgot-password', ORIGIN).href;

const ESSAY_CENTER_URL = new URL('/essay-center', ORIGIN).href;
const CVMLRL_CENTER_URL = new URL('/cv-ml-rl-center', ORIGIN).href;
const CVMLRL_FOR_EDITOR_URL = (studentId) =>
  new URL(`/student-database/${studentId}#cvmlrl`, ORIGIN).href;
const UNI_ASSIST_FOR_STUDENT_URL = new URL('/uni-assist', ORIGIN).href;
const UNI_ASSIST_FOR_AGENT_URL = (studentId) =>
  new URL(`/student-database/${studentId}#uniassist`, ORIGIN).href;
const THREAD_URL = new URL('/document-modification', ORIGIN).href;
const ARCHIVED_STUDENTS_URL = new URL('/archiv/students', ORIGIN).href;
const BASE_DOCUMENT_URL = new URL('/base-documents', ORIGIN).href;
const BASE_DOCUMENT_FOR_AGENT_URL = (studentId) =>
  new URL(`/student-database/${studentId}#profile`, ORIGIN).href;
const STUDENT_COMMUNICATION_THREAD_URL = (studentId) =>
  new URL(`/communications/std/${studentId}`, ORIGIN).href;
const INTERNAL_COMMUNICATION_THREAD_URL = (studentId) =>
  new URL(`/communications/t/${studentId}`, ORIGIN).href;
const TEMPLATE_DOWNLOAD_URL = new URL('/download', ORIGIN).href;
const STUDENT_APPLICATION_URL = new URL('/student-applications', ORIGIN).href;
const STUDENT_SURVEY_URL = new URL('/survey', ORIGIN).href;
const SURVEY_URL_FOR_AGENT_URL = (studentId) =>
  new URL(`/student-database/${studentId}#survey`, ORIGIN).href;
const SETTINGS_URL = new URL('/settings', ORIGIN).href;
const PROFILE_URL = new URL('/profile', ORIGIN).href;
const TEAMS_URL = new URL('/teams', ORIGIN).href;
const STUDENT_PROFILE_FOR_AGENT_URL = (studentId) =>
  new URL(`/student-database/${studentId}#profile`, ORIGIN).href;
const STUDENT_COURSE_URL = (studentId) =>
  new URL(`/my-courses/${studentId}`, ORIGIN).href;
const STUDENT_ANALYSED_COURSE_URL = (studentId) =>
  new URL(`/my-courses/analysis/${studentId}`, ORIGIN).href;
const AGENT_CALENDAR_EVENTS_URL = (taigerAgentId) =>
  new URL(`/events/taiger/${taigerAgentId}`, ORIGIN).href;
const STUDENT_CALENDAR_EVENTS_URL = (studentId) =>
  new URL(`/events/students/${studentId}`, ORIGIN).href;
const PROGRAM_URL = (program_id) =>
  new URL(`/programs/${program_id}`, ORIGIN).href;
const JITSI_MEET_URL = (studentId) =>
  new URL(`https://meet.jit.si/${studentId}`, ORIGIN).href;
const JITSI_MEET_INSTRUCTIONS_URL = new URL(
  '/docs/search/64eb25ec89ea0d1fcb39df73',
  ORIGIN
).href;

// const TAIGER_SIGNATURE = '<p><b>Your TaiGer Consultancy Team</b></p>';
const TAIGER_SIGNATURE = `<p><b>Your TaiGer Consultancy Team</b></p><p>Website: <a href="https://taigerconsultancy.com/">https://taigerconsultancy.com/</a></p>\
  <p>Facebook: <a href="https://www.facebook.com/profile.php?id=100063557155189">https://www.facebook.com/profile.php?id=100063557155189</a></p>\
  <p>Instagram: <a href="https://www.instagram.com/taiger_study_abroad/?hl=de">https://www.instagram.com/taiger_study_abroad/?hl=de</a></p>`;
const SPLIT_LINE = '-------------------------------------------------------';
const ENGLISH_BELOW = '(English version below)';
const CONTACT_AGENT = '如果您有任何疑問，請聯絡您的顧問。';

const TicketStatus = {
  Open: 'open',
  Resolved: 'resolved'
};

const ManagerType = {
  Agent: 'Agent',
  Editor: 'Editor',
  AgentAndEditor: 'AgentAndEditor',
  None: 'None'
};

const DocumentStatus = {
  Uploaded: 'uploaded',
  Missing: 'missing',
  Accepted: 'accepted',
  Rejected: 'rejected',
  NotNeeded: 'notneeded'
};

const CheckListStatus = {
  NotStarted: 'notstarted',
  Processing: 'processing',
  Finished: 'finished',
  NotNeeded: 'notneeded'
};

const getNumberOfDays = (start, end) => {
  const date1 = new Date(start);
  const date2 = new Date(end);

  // One day in milliseconds
  const oneDay = 1000 * 60 * 60 * 24;

  // Calculating the time difference between two dates
  const diffInTime = date2.getTime() - date1.getTime();

  // Calculating the no. of days between two dates
  const diffInDays = Math.round(diffInTime / oneDay);

  return diffInDays.toString();
};

const isNotArchiv = (user) => {
  if (user.archiv === undefined || !user.archiv) {
    return true;
  }
  return false;
};

const isArchiv = (user) => {
  return !!user.archiv;
};

const application_deadline_calculator = (student, application) => {
  if (application.closed === 'O') {
    return 'CLOSE';
  }
  if (application.closed === 'X') {
    return 'WITHDRAW';
  }
  const { application_deadline, semester } = application.programId;

  if (!application_deadline) {
    return 'No Data';
  }
  let application_year = '<TBD>';
  if (
    student.application_preference &&
    student.application_preference.expected_application_date !== ''
  ) {
    application_year = parseInt(
      student.application_preference.expected_application_date,
      10
    );
  }
  if (!application_deadline) {
    return `${application_year}-<TBD>`;
  }
  if (application_deadline.includes('olling')) {
    // include Rolling
    return `${application_year}-Rolling`;
  }
  let deadline_month = parseInt(
    application.programId.application_deadline.split('-')[0],
    10
  );
  let deadline_day = parseInt(
    application.programId.application_deadline.split('-')[1],
    10
  );
  if (semester === undefined) {
    return 'Err';
  }
  if (semester === 'WS') {
    if (deadline_month > 9) {
      application_year = application_year - 1;
    }
  }
  if (semester === 'SS') {
    if (deadline_month > 3) {
      application_year = application_year - 1;
    }
  }

  return `${application_year}/${
    application.programId.application_deadline.split('-')[0]
  }/${application.programId.application_deadline.split('-')[1]}`;
};

const TaskStatus = {
  Finished: 'finished',
  Locked: 'locked',
  Open: 'Open',
  Pending: 'pending',
  NotNeeded: 'notneeded'
};

const EDITOR_SCOPE = {
  CV: 'Curriculum Vitae',
  ML: 'Motivation Letter',
  Portfolio: 'Portfolio',
  RL_A: 'Recommendation Letter',
  RL_B: 'Recommendation Letter',
  RL_C: 'Recommendation Letter',
  Recommendation_Letter_A: 'Recommendation Letter',
  Recommendation_Letter_B: 'Recommendation Letter',
  Recommendation_Letter_C: 'Recommendation Letter',
  Scholarship_Form: 'Scholarship'
};
const ESSAY_WRITER_SCOPE = {
  Essay: 'Essay'
};
const FILE_MAPPING_TABLE = { ...EDITOR_SCOPE, ...ESSAY_WRITER_SCOPE };
const RLs_CONSTANT = ['RL_A', 'RL_B', 'RL_C'];
const GENERAL_RLs_CONSTANT = [
  'Recommendation_Letter_A',
  'Recommendation_Letter_B',
  'Recommendation_Letter_C'
];
const General_Docs = [
  'Recommendation_Letter_A',
  'Recommendation_Letter_B',
  'Recommendation_Letter_C',
  'Form_A',
  'Form_B',
  'CV',
  'Others'
];
const profile_list = {
  High_School_Diploma: 'High School Diploma',
  High_School_Transcript: 'High School Transcript',
  University_Entrance_Examination_GSAT: 'GSAT/SAT/TVE Test (學測/統測)',
  Bachelor_Certificate: 'Bachelor Certificate/Enrolment',
  Bachelor_Transcript: 'Bachelor Transcript',
  Englisch_Certificate: 'TOEFL or IELTS',
  German_Certificate: 'TestDaF or Goethe-A1-C1',
  GRE: 'GRE',
  GMAT: 'GMAT',
  ECTS_Conversion: 'ECTS Conversion',
  Course_Description: 'Course Description',
  Internship: 'Internship Certificate',
  Exchange_Student_Certificate: 'Exchange Student Certificate',
  Employment_Certificate: 'Employment Certificate',
  Passport_Photo: 'Formal Profile Photo',
  Passport: 'Passport Copy',
  Others: 'Others'
};

const is_deadline_within30days_needed = (student) => {
  const today = new Date();
  if (student.application_preference.expected_application_date === '') {
    return false;
  }
  for (let k = 0; k < student.applications.length; k += 1) {
    const day_diff = getNumberOfDays(
      today,
      application_deadline_calculator(student, student.applications[k])
    );
    // TODO: should pack all thread due soon in a student email, not multiple email for 1 student  for daily reminder.
    if (
      student.applications[k].decided === 'O' &&
      student.applications[k].closed !== 'O' &&
      student.applications[k].closed !== 'X' &&
      day_diff < parseInt(ESCALATION_DEADLINE_DAYS_TRIGGER, 10) &&
      day_diff > -30
    ) {
      return true;
    }
  }
  return false;
};

const needUpdateCourseSelection = (student) => {
  // not necessary if have studied or not yet begin
  if (
    student.academic_background?.university?.isGraduated === 'Yes' ||
    student.academic_background?.university?.isGraduated === 'No'
  ) {
    return false;
  }
  // necessary if never updated course and is studying
  if (student.courses?.length === 0) {
    return true;
  }
  // necessary if never analyzed and is studying
  if (!student.courses[0].analysis?.updatedAt) {
    return true;
  }
  // necessary if courses or analysis expired 39 daays and is studying
  const course_aged_days = parseInt(
    getNumberOfDays(student.courses[0].updatedAt, new Date()),
    10
  );
  const analyse_aged_days = parseInt(
    getNumberOfDays(student.courses[0].analysis?.updatedAt, new Date()),
    10
  );
  const trigger_days = 1;
  if (course_aged_days > trigger_days || analyse_aged_days > trigger_days) {
    return true;
  }

  return true;
};

const does_editor_have_pending_tasks = (students, editor) => {
  for (let i = 0; i < students.length; i += 1) {
    // check CV tasks
    for (let j = 0; j < students[i].generaldocs_threads.length; j += 1) {
      if (
        !students[i].generaldocs_threads[j].isFinalVersion &&
        students[i].generaldocs_threads[j].latest_message_left_by_id !== '' &&
        students[i].generaldocs_threads[j].latest_message_left_by_id !==
          editor._id.toString()
      ) {
        return true;
      }
    }
    for (let k = 0; k < students[i].applications.length; k += 1) {
      if (students[i].applications[k].decided === 'O') {
        for (
          let j = 0;
          j < students[i].applications[k].doc_modification_thread.length;
          j += 1
        ) {
          if (
            !students[i].applications[k].doc_modification_thread[j]
              .isFinalVersion &&
            students[i].applications[k].doc_modification_thread[j]
              .latest_message_left_by_id !== '' &&
            students[i].applications[k].doc_modification_thread[j]
              .latest_message_left_by_id !== editor._id.toString()
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
};

const is_cv_ml_rl_task_response_needed = (student, user) => {
  for (let i = 0; i < student.generaldocs_threads.length; i += 1) {
    if (user.role === Role.Editor) {
      if (
        !student.generaldocs_threads[i].isFinalVersion &&
        student.generaldocs_threads[i].latest_message_left_by_id !== '' &&
        student.generaldocs_threads[i].latest_message_left_by_id !==
          user._id.toString()
      ) {
        return true;
      }
    } else if (user.role === Role.Student) {
      if (
        !student.generaldocs_threads[i].isFinalVersion &&
        student.generaldocs_threads[i].latest_message_left_by_id !==
          user._id.toString()
      ) {
        return true;
      }
    } else if (user.role === Role.Agent) {
      if (!student.generaldocs_threads[i].isFinalVersion) {
        return true;
      }
    }
  }
  for (let i = 0; i < student.applications.length; i += 1) {
    if (student.applications[i].decided === 'O') {
      for (
        let j = 0;
        j < student.applications[i].doc_modification_thread.length;
        j += 1
      ) {
        if (user.role === Role.Editor) {
          if (
            !student.applications[i].doc_modification_thread[j]
              .isFinalVersion &&
            student.applications[i].doc_modification_thread[j]
              .latest_message_left_by_id !== '' &&
            student.applications[i].doc_modification_thread[j]
              .latest_message_left_by_id !== user._id.toString()
          ) {
            return true;
          }
        } else if (user.role === Role.Student) {
          if (
            !student.applications[i].doc_modification_thread[j]
              .isFinalVersion &&
            student.applications[i].doc_modification_thread[j]
              .latest_message_left_by_id !== user._id.toString()
          ) {
            return true;
          }
        } else if (user.role === Role.Agent) {
          if (
            !student.applications[i].doc_modification_thread[j].isFinalVersion
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
};

const is_cv_ml_rl_reminder_needed = (student, user, trigger_days) => {
  const today = new Date();
  for (let i = 0; i < student.generaldocs_threads.length; i += 1) {
    const day_diff = parseInt(
      getNumberOfDays(student.generaldocs_threads[i].updatedAt, today),
      10
    );
    if (user.role === Role.Editor) {
      if (
        !student.generaldocs_threads[i].isFinalVersion &&
        student.generaldocs_threads[i].latest_message_left_by_id !== '' &&
        student.generaldocs_threads[i].latest_message_left_by_id !==
          user._id.toString() &&
        day_diff > trigger_days
      ) {
        return true;
      }
    } else if (user.role === Role.Student) {
      if (
        !student.generaldocs_threads[i].isFinalVersion &&
        student.generaldocs_threads[i].latest_message_left_by_id !==
          user._id.toString() &&
        day_diff > trigger_days
      ) {
        return true;
      }
    } else if (user.role === Role.Agent) {
      if (
        !student.generaldocs_threads[i].isFinalVersion &&
        day_diff > trigger_days
      ) {
        return true;
      }
    }
  }
  for (let i = 0; i < student.applications.length; i += 1) {
    if (student.applications[i].decided === 'O') {
      for (
        let j = 0;
        j < student.applications[i].doc_modification_thread.length;
        j += 1
      ) {
        const day_diff_2 = parseInt(
          getNumberOfDays(
            student.applications[i].doc_modification_thread[j].doc_thread_id
              .updatedAt,
            today
          ),
          10
        );
        if (user.role === Role.Editor) {
          if (
            !student.applications[i].doc_modification_thread[j]
              .isFinalVersion &&
            student.applications[i].doc_modification_thread[j]
              .latest_message_left_by_id !== '' &&
            student.applications[i].doc_modification_thread[j]
              .latest_message_left_by_id !== user._id.toString() &&
            day_diff_2 > trigger_days
          ) {
            return true;
          }
        } else if (user.role === Role.Student) {
          if (
            !student.applications[i].doc_modification_thread[j]
              .isFinalVersion &&
            student.applications[i].doc_modification_thread[j]
              .latest_message_left_by_id !== user._id.toString() &&
            day_diff_2 > trigger_days
          ) {
            return true;
          }
        } else if (user.role === Role.Agent) {
          if (
            !student.applications[i].doc_modification_thread[j]
              .isFinalVersion &&
            day_diff_2 > trigger_days
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
};

const unsubmitted_applications_summary = (student) => {
  let unsubmitted_applications = '';
  let x = 0;
  for (let i = 0; i < student.applications.length; i += 1) {
    if (
      student.applications[i].decided === 'O' &&
      student.applications[i].closed !== 'O' &&
      student.applications[i].closed !== 'X'
    ) {
      if (x === 0) {
        unsubmitted_applications = `
        The following program(s) are not submitted yet: 
        <ul>
        <li>${student.applications[i].programId.school} ${student.applications[i].programId.program_name}</li>`;
        x += 1;
      } else {
        unsubmitted_applications += `<li>${student.applications[i].programId.school} - ${student.applications[i].programId.program_name}</li>`;
      }
    }
  }
  if (unsubmitted_applications !== '') {
    unsubmitted_applications += '</ul>';
    unsubmitted_applications += `<p>If there is any updates, please go to <a href="${STUDENT_APPLICATION_URL}">Applications Overview</a> and update them.</p>`;
  }
  return unsubmitted_applications;
};

const cv_rl_escalation_editor_list = (student, user, trigger_days) => {
  let missing_doc_list = '';
  const today = new Date();

  for (let i = 0; i < student.generaldocs_threads.length; i += 1) {
    const day_diff = parseInt(
      getNumberOfDays(
        student.generaldocs_threads[i].doc_thread_id.updatedAt,
        today
      ),
      10
    );
    if (
      !student.generaldocs_threads[i].isFinalVersion &&
      student.generaldocs_threads[i].latest_message_left_by_id !== '' &&
      student.generaldocs_threads[i].latest_message_left_by_id !==
        user._id.toString() &&
      day_diff > trigger_days
    ) {
      missing_doc_list += `<li><a href="${THREAD_URL}/${student.generaldocs_threads[
        i
      ].doc_thread_id._id.toString()}">${
        student.generaldocs_threads[i].doc_thread_id.file_type
      }</a> - aged ${day_diff} days.</li>`;
    }
  }
  return missing_doc_list;
};

const cv_rl_escalation_agent_list = (student, user, trigger_days) => {
  let missing_doc_list = '';
  const today = new Date();

  for (let i = 0; i < student.generaldocs_threads.length; i += 1) {
    const day_diff = parseInt(
      getNumberOfDays(
        student.generaldocs_threads[i].doc_thread_id.updatedAt,
        today
      ),
      10
    );
    if (
      !student.generaldocs_threads[i].isFinalVersion &&
      day_diff > trigger_days
    ) {
      missing_doc_list += `<li><a href="${THREAD_URL}/${student.generaldocs_threads[
        i
      ].doc_thread_id._id.toString()}">${
        student.generaldocs_threads[i].doc_thread_id.file_type
      }</a> - aged ${day_diff} days.</li>`;
    }
  }
  return missing_doc_list;
};

const cv_rl_escalation_student_list = (student, user, trigger_days) => {
  let missing_doc_list = '';
  const today = new Date();

  for (let i = 0; i < student.generaldocs_threads.length; i += 1) {
    const day_diff = parseInt(
      getNumberOfDays(
        student.generaldocs_threads[i].doc_thread_id.updatedAt,
        today
      ),
      10
    );
    if (
      !student.generaldocs_threads[i].isFinalVersion &&
      student.generaldocs_threads[i].latest_message_left_by_id !==
        user._id.toString() &&
      day_diff > trigger_days
    ) {
      missing_doc_list += `<li><a href="${THREAD_URL}/${student.generaldocs_threads[
        i
      ].doc_thread_id._id.toString()}">${
        student.generaldocs_threads[i].doc_thread_id.file_type
      }</a> - aged ${day_diff} days.</li>`;
    }
  }
  return missing_doc_list;
};

const ml_essay_escalation_editor_single_program_list = (
  student,
  user,
  trigger_days,
  application
) => {
  let missing_doc_list = '';
  const today = new Date();

  if (application.decided === 'O') {
    for (let j = 0; j < application.doc_modification_thread.length; j += 1) {
      const day_diff_2 = parseInt(
        getNumberOfDays(
          application.doc_modification_thread[j].doc_thread_id.updatedAt,
          today
        ),
        10
      );
      if (
        !application.doc_modification_thread[j].isFinalVersion &&
        application.doc_modification_thread[j].latest_message_left_by_id !==
          '' &&
        application.doc_modification_thread[j].latest_message_left_by_id !==
          user._id.toString() &&
        day_diff_2 > trigger_days
      ) {
        missing_doc_list += `<li><a href="${THREAD_URL}/${application.doc_modification_thread[
          j
        ].doc_thread_id._id.toString()}">${application.programId.school} ${
          application.programId.program_name
        } ${
          application.doc_modification_thread[j].doc_thread_id.file_type
        }</a> - aged ${day_diff_2} days.</li>`;
      }
    }
  }

  return missing_doc_list;
};

const ml_essay_escalation_editor_list = (student, user, trigger_days) => {
  let missing_doc_list = '';

  for (let i = 0; i < student.applications.length; i += 1) {
    missing_doc_list += ml_essay_escalation_editor_single_program_list(
      student,
      user,
      trigger_days,
      student.applications[i]
    );
  }
  return missing_doc_list;
};

const ml_essay_escalation_student_list = (student, user, trigger_days) => {
  let missing_doc_list = '';
  const today = new Date();

  for (let i = 0; i < student.applications.length; i += 1) {
    if (student.applications[i].decided === 'O') {
      for (
        let j = 0;
        j < student.applications[i].doc_modification_thread.length;
        j += 1
      ) {
        const day_diff_2 = parseInt(
          getNumberOfDays(
            student.applications[i].doc_modification_thread[j].doc_thread_id
              .updatedAt,
            today
          ),
          10
        );
        if (
          !student.applications[i].doc_modification_thread[j].isFinalVersion &&
          student.applications[i].doc_modification_thread[j]
            .latest_message_left_by_id !== user._id.toString() &&
          day_diff_2 > trigger_days
        ) {
          missing_doc_list += `<li><a href="${THREAD_URL}/${student.applications[
            i
          ].doc_modification_thread[j].doc_thread_id._id.toString()}">${
            student.applications[i].programId.school
          } ${student.applications[i].programId.program_name} ${
            student.applications[i].doc_modification_thread[j].doc_thread_id
              .file_type
          }</a> - aged ${day_diff_2} days.</li>`;
        }
      }
    }
  }
  return missing_doc_list;
};

const ml_essay_escalation_agent_single_program_list = (
  student,
  user,
  trigger_days,
  application
) => {
  let missing_doc_list = '';
  const today = new Date();

  if (application.decided === 'O') {
    for (let j = 0; j < application.doc_modification_thread.length; j += 1) {
      const day_diff_2 = parseInt(
        getNumberOfDays(
          application.doc_modification_thread[j].doc_thread_id.updatedAt,
          today
        ),
        10
      );
      if (!application.doc_modification_thread[j].isFinalVersion) {
        missing_doc_list += `<li><a href="${THREAD_URL}/${application.doc_modification_thread[
          j
        ].doc_thread_id._id.toString()}">${application.programId.school} ${
          application.programId.program_name
        } ${
          application.doc_modification_thread[j].doc_thread_id.file_type
        }</a> - aged ${day_diff_2} days.</li>`;
      }
    }
  }
  return missing_doc_list;
};

const ml_essay_escalation_agent_list = (student, user, trigger_days) => {
  let missing_doc_list = '';

  for (let i = 0; i < student.applications.length; i += 1) {
    missing_doc_list += ml_essay_escalation_agent_single_program_list(
      student,
      user,
      trigger_days,
      student.applications[i]
    );
  }
  return missing_doc_list;
};

const cv_ml_rl_escalation_summary = (student, user, trigger_days) => {
  let missing_doc_list = '';
  if (user.role === Role.Editor) {
    missing_doc_list = `
        The following documents are waiting for your response, please <b>reply</b> it as soon as possible:
        <ul>
        ${cv_rl_escalation_editor_list(student, user, trigger_days)}
        ${ml_essay_escalation_editor_list(student, user, trigger_days)}
        </ul>`;
  } else if (user.role === Role.Student) {
    missing_doc_list = `
        The following documents are waiting for your response, please <b>reply</b> it as soon as possible:
        <ul>
        ${cv_rl_escalation_student_list(student, user, trigger_days)}
        ${ml_essay_escalation_student_list(student, user, trigger_days)}
        </ul>`;
  }
  return missing_doc_list;
};

const unsubmitted_applications_list = (student, user, trigger_days) => {
  let unsubmitted_applications_li = '';
  const today = new Date();
  for (let i = 0; i < student.applications.length; i += 1) {
    const day_diff = getNumberOfDays(
      today,
      application_deadline_calculator(student, student.applications[i])
    );
    if (
      student.applications[i].decided === 'O' &&
      student.applications[i].closed !== 'O' &&
      student.applications[i].closed !== 'X' &&
      day_diff < parseInt(ESCALATION_DEADLINE_DAYS_TRIGGER, 10) &&
      day_diff > -30
    ) {
      unsubmitted_applications_li += `<li>${
        student.applications[i].programId.school
      } ${
        student.applications[i].programId.program_name
      }: <b> Deadline ${application_deadline_calculator(
        student,
        student.applications[i]
      )} </b>
      <ul>
      ${ml_essay_escalation_agent_single_program_list(
        student,
        user,
        trigger_days,
        student.applications[i]
      )}
      </ul>
      </li>
      `;
    }
  }
  return unsubmitted_applications_li;
};

const unsubmitted_applications_escalation_summary = (
  student,
  user,
  trigger_days
) => {
  let unsubmitted_applications = '';
  unsubmitted_applications = `
        The following program(s) are not submitted yet and very close to <b>deadline</b>: 
        <ul>
        ${unsubmitted_applications_list(student, user, trigger_days)}
        </ul>
        <ul>
        ${cv_rl_escalation_agent_list(student, user, trigger_days)}
        </ul>
        <p>If the applications are already submitted, please go to <a href="${STUDENT_APPLICATION_URL}">Applications Overview</a> and update them.</p>`;
  return unsubmitted_applications;
};

const unsubmitted_applications_escalation_agent_summary = (
  student,
  user,
  trigger_days
) => {
  let unsubmitted_applications = '';
  unsubmitted_applications = `
        <b><a href="${STUDENT_PROFILE_FOR_AGENT_URL(student._id.toString())}">${
    student.firstname
  } ${student.lastname}</a></b><br />
  ${unsubmitted_applications_escalation_summary(student, user, trigger_days)}
  `;
  return unsubmitted_applications;
};

const cv_ml_rl_editor_escalation_summary = (student, user, trigger_days) => {
  let missing_doc_list = '';
  if (user.role === Role.Editor) {
    missing_doc_list = `
        <b><a href="${STUDENT_PROFILE_FOR_AGENT_URL(student._id.toString())}">${
      student.firstname
    } ${student.lastname}</a></b><br />
        The following documents are waiting for your response, please <b>reply</b> it as soon as possible:
        <ul>
        ${cv_rl_escalation_editor_list(student, user, trigger_days)}
        ${ml_essay_escalation_editor_list(student, user, trigger_days)}
        </ul>`;
  }
  if (user.role === Role.Agent) {
    missing_doc_list = `
        <b><a href="${STUDENT_PROFILE_FOR_AGENT_URL(student._id.toString())}">${
      student.firstname
    } ${student.lastname}</a></b><br />

        The following documents are idle for a while, please <b>inform</b> student / editor as soon as possible:
        <ul>
        ${cv_rl_escalation_agent_list(student, user, trigger_days)}
        ${ml_essay_escalation_agent_list(student, user, trigger_days)}
        </ul>`;
  }

  return missing_doc_list;
};

const cv_ml_rl_unfinished_summary = (student, user) => {
  let missing_doc_list = '';
  let kk = 0;
  for (let i = 0; i < student.generaldocs_threads.length; i += 1) {
    if (user.role === Role.Editor) {
      if (
        !student.generaldocs_threads[i].isFinalVersion &&
        student.generaldocs_threads[i].latest_message_left_by_id !== '' &&
        student.generaldocs_threads[i].latest_message_left_by_id !==
          user._id.toString()
      ) {
        if (kk === 0) {
          missing_doc_list = `
        The following documents are waiting for your response, please <b>reply</b> it as soon as possible:
        <ul>
        <li><a href="${THREAD_URL}/${student.generaldocs_threads[
            i
          ].doc_thread_id._id.toString()}">${
            student.generaldocs_threads[i].doc_thread_id.file_type
          }</a></li>`;
          kk += 1;
        } else {
          missing_doc_list += `<li><a href="${THREAD_URL}/${student.generaldocs_threads[
            i
          ].doc_thread_id._id.toString()}">${
            student.generaldocs_threads[i].doc_thread_id.file_type
          }</a></li>`;
        }
      }
    } else if (user.role === Role.Student) {
      if (
        !student.generaldocs_threads[i].isFinalVersion &&
        student.generaldocs_threads[i].latest_message_left_by_id !==
          user._id.toString()
      ) {
        if (kk === 0) {
          missing_doc_list = `
        The following documents are waiting for your response, please <b>reply</b> it as soon as possible:
        <ul>
        <li><a href="${THREAD_URL}/${student.generaldocs_threads[
            i
          ].doc_thread_id._id.toString()}">${
            student.generaldocs_threads[i].doc_thread_id.file_type
          }</a></li>`;
          kk += 1;
        } else {
          missing_doc_list += `<li><a href="${THREAD_URL}/${student.generaldocs_threads[
            i
          ].doc_thread_id._id.toString()}">${
            student.generaldocs_threads[i].doc_thread_id.file_type
          }</a></li>`;
        }
      }
    } else if (user.role === Role.Agent) {
      if (!student.generaldocs_threads[i].isFinalVersion) {
        if (kk === 0) {
          missing_doc_list = `
        The following documents are not finished:
        <ul>
        <li><a href="${THREAD_URL}/${student.generaldocs_threads[
            i
          ].doc_thread_id._id.toString()}">${
            student.generaldocs_threads[i].doc_thread_id.file_type
          }</a></li>`;
          kk += 1;
        } else {
          missing_doc_list += `<li><a href="${THREAD_URL}/${student.generaldocs_threads[
            i
          ].doc_thread_id._id.toString()}">${
            student.generaldocs_threads[i].doc_thread_id.file_type
          }</a></li>`;
        }
      }
    }
  }

  for (let i = 0; i < student.applications.length; i += 1) {
    if (student.applications[i].decided === 'O') {
      for (
        let j = 0;
        j < student.applications[i].doc_modification_thread.length;
        j += 1
      ) {
        if (user.role === Role.Editor) {
          if (
            !student.applications[i].doc_modification_thread[j]
              .isFinalVersion &&
            student.applications[i].doc_modification_thread[j]
              .latest_message_left_by_id !== '' &&
            student.applications[i].doc_modification_thread[j]
              .latest_message_left_by_id !== user._id.toString()
          ) {
            if (kk === 0) {
              missing_doc_list = `
        The following documents are waiting for your response, please <b>reply</b> it as soon as possible:
        <ul>
        <li><a href="${THREAD_URL}/${student.applications[
                i
              ].doc_modification_thread[j].doc_thread_id._id.toString()}">${
                student.applications[i].programId.school
              } ${student.applications[i].programId.program_name} ${
                student.applications[i].doc_modification_thread[j].doc_thread_id
                  .file_type
              }</a></li>`;
              kk += 1;
            } else {
              missing_doc_list += `<li><a href="${THREAD_URL}/${student.applications[
                i
              ].doc_modification_thread[j].doc_thread_id._id.toString()}">${
                student.applications[i].programId.school
              } ${student.applications[i].programId.program_name} ${
                student.applications[i].doc_modification_thread[j].doc_thread_id
                  .file_type
              }</a></li>`;
            }
          }
        } else if (user.role === Role.Student) {
          if (
            !student.applications[i].doc_modification_thread[j]
              .isFinalVersion &&
            student.applications[i].doc_modification_thread[j]
              .latest_message_left_by_id !== user._id.toString()
          ) {
            if (kk === 0) {
              missing_doc_list = `
        The following documents are waiting for your response, please <b>reply</b> it as soon as possible:
        <ul>
        <li><a href="${THREAD_URL}/${student.applications[
                i
              ].doc_modification_thread[j].doc_thread_id._id.toString()}">${
                student.applications[i].programId.school
              } ${student.applications[i].programId.program_name} ${
                student.applications[i].doc_modification_thread[j].doc_thread_id
                  .file_type
              }</a></li>`;
              kk += 1;
            } else {
              missing_doc_list += `<li><a href="${THREAD_URL}/${student.applications[
                i
              ].doc_modification_thread[j].doc_thread_id._id.toString()}">${
                student.applications[i].programId.school
              } ${student.applications[i].programId.program_name} ${
                student.applications[i].doc_modification_thread[j].doc_thread_id
                  .file_type
              }</a></li>`;
            }
          }
        } else if (user.role === Role.Agent) {
          if (
            !student.applications[i].doc_modification_thread[j].isFinalVersion
          ) {
            if (kk === 0) {
              missing_doc_list = `
        The following documents are not finished:
        <ul>
        <li><a href="${THREAD_URL}/${student.applications[
                i
              ].doc_modification_thread[j].doc_thread_id._id.toString()}">${
                student.applications[i].programId.school
              } ${student.applications[i].programId.program_name} ${
                student.applications[i].doc_modification_thread[j].doc_thread_id
                  .file_type
              }</a></li>`;
              kk += 1;
            } else {
              missing_doc_list += `<li><a href="${THREAD_URL}/${student.applications[
                i
              ].doc_modification_thread[j].doc_thread_id._id.toString()}">${
                student.applications[i].programId.school
              } ${student.applications[i].programId.program_name} ${
                student.applications[i].doc_modification_thread[j].doc_thread_id
                  .file_type
              }</a></li>`;
            }
          }
        }
      }
    }
  }
  if (missing_doc_list !== '') {
    missing_doc_list += '</ul>';
  }
  return missing_doc_list;
};
const profile_keys_list = [
  'High_School_Diploma',
  'High_School_Transcript',
  'University_Entrance_Examination_GSAT',
  'Bachelor_Certificate',
  'Bachelor_Transcript',
  'Englisch_Certificate',
  'German_Certificate',
  'GRE',
  'GMAT',
  'ECTS_Conversion',
  'Course_Description',
  'Internship',
  'Exchange_Student_Certificate',
  'Employment_Certificate',
  'Passport',
  'Others'
];

const check_english_language_passed = (academic_background) => {
  if (!academic_background || !academic_background.language) {
    return false;
  }
  if (academic_background.language.english_isPassed === 'O') {
    return true;
  }

  return false;
};

const check_german_language_passed = (academic_background) => {
  if (!academic_background || !academic_background.language) {
    return false;
  }
  if (academic_background.language.german_isPassed === 'O') {
    return true;
  }

  return false;
};

const check_languages_filled = (academic_background) => {
  if (!academic_background || !academic_background.language) {
    return false;
  }
  if (
    !academic_background.language ||
    ((!academic_background.language.english_isPassed ||
      academic_background.language.english_isPassed === '-') &&
      (!academic_background.language.german_isPassed ||
        academic_background.language.german_isPassed === '-'))
  ) {
    return false;
  }

  return true;
};

const missing_academic_background = (student, user) => {
  let missing_background_fields = '';
  if (
    !student.academic_background ||
    !student.academic_background.university ||
    !student.academic_background.language ||
    !student.application_preference
  ) {
    missing_background_fields = `<p>問卷內的以下欄位尚未填寫:</p>
    <p>The following fields in Survey not finished yet:</p>
    <ul>`;
    if (
      student.academic_background ||
      !student.academic_background.university
    ) {
      missing_background_fields += `
    <li>High School Name</li>
    <li>High School already graduated?</li>
    <li>High School Graduate Year</li>
    <li>University Name</li>
    <li>University Program</li>
    <li>Already Bachelor graduated ?</li>
    <li>Exchange Student Experience ?</li>
    <li>Internship Experience ?</li>
    <li>Full-Time Job Experience ?</li>
    `;
    }
    if (!student.application_preference) {
      missing_background_fields += `
    <li>Expected Application Year</li>
    <li>Expected Application Semester</li>
    <li>Target Application Fields</li>
    <li>Target Degree Programs</li>`;
    }
    if (student.academic_background || !student.academic_background.language) {
      missing_background_fields += `
    <li><b>English passed?</b></li>
    <li>English Certificate?</li>
    <li><b>German passed?</b></li>
    <li>German Certificate?</li>
    <li><b>GRE passed?</b></li>
    <li>GRE Certificate?</li
    <li><b>GMAT passed?</b></li>
    <li>GMAT Certificate?</li`;
    }
    missing_background_fields += '</ul>';
    if (user.role === Role.Admin || user.role === Role.Agent) {
      missing_background_fields += `
      <p>請至 <a href="${SURVEY_URL_FOR_AGENT_URL(
        student._id.toString()
      )}">Survey</a> 並<b>更新</b>.</p>
      <p>Please go to <a href="${SURVEY_URL_FOR_AGENT_URL(
        student._id.toString()
      )}">Survey</a> and <b>update</b> them.</p>`;
    } else {
      missing_background_fields += `
      <p>請至 <a href="${STUDENT_SURVEY_URL}">Survey</a> 並更新.</p>
      <p>Please go to <a href="${STUDENT_SURVEY_URL}">Survey</a> and update them.</p>`;
    }
    return missing_background_fields;
  }
  // TODO: can add more mandatory field
  if (
    !student.academic_background.university.attended_high_school ||
    !student.academic_background.university.high_school_isGraduated ||
    student.academic_background.university.high_school_isGraduated === '-' ||
    !student.academic_background.university.high_school_graduated_year ||
    !student.academic_background.university.attended_university ||
    !student.academic_background.university.attended_university_program ||
    !student.academic_background.university.isGraduated ||
    student.academic_background.university.isGraduated === '-' ||
    !student.academic_background.university.Has_Exchange_Experience ||
    student.academic_background.university.Has_Exchange_Experience === '-' ||
    !student.academic_background.university.Has_Internship_Experience ||
    student.academic_background.university.Has_Internship_Experience === '-' ||
    !student.academic_background.university.Has_Working_Experience ||
    student.academic_background.university.Has_Working_Experience === '-' ||
    !student.application_preference.expected_application_date ||
    !student.application_preference.expected_application_semester ||
    !student.application_preference.target_application_field ||
    !student.application_preference.target_degree ||
    student.academic_background.language.english_isPassed === '-' ||
    student.academic_background.language.english_isPassed === 'X' ||
    student.academic_background.language.german_isPassed === '-' ||
    student.academic_background.language.german_isPassed === 'X' ||
    student.academic_background.language.gre_isPassed === '-' ||
    student.academic_background.language.gre_isPassed === 'X' ||
    student.academic_background.language.gmat_isPassed === '-' ||
    student.academic_background.language.gmat_isPassed === 'X'
    // ||
    // !student.academic_background.university.isGraduated
  ) {
    missing_background_fields +=
      '<p>The following fields in Survey not finished yet:</p><ul>';
    if (!student.academic_background.university.attended_high_school) {
      missing_background_fields += '<li>High School Name</li>';
    }
    if (
      !student.academic_background.university.high_school_isGraduated ||
      student.academic_background.university.high_school_isGraduated === '-'
    ) {
      missing_background_fields += '<li>High School already graduated?</li>';
    }
    if (!student.academic_background.university.high_school_graduated_year) {
      missing_background_fields += '<li>High School Graduate year</li>';
    }
    if (!student.academic_background.university.attended_university) {
      missing_background_fields += '<li>University Name</li>';
    }
    if (!student.academic_background.university.attended_university_program) {
      missing_background_fields += '<li>University Program</li>';
    }
    if (
      !student.academic_background.university.isGraduated ||
      student.academic_background.university.isGraduated === '-'
    ) {
      missing_background_fields += ' <li>Already Bachelor graduated?</li>';
    }
    if (
      !student.academic_background.university.Has_Exchange_Experience ||
      student.academic_background.university.Has_Exchange_Experience === '-'
    ) {
      missing_background_fields += ' <li>Exchange Student Experience ?</li>';
    }
    if (
      !student.academic_background.university.Has_Internship_Experience ||
      student.academic_background.university.Has_Internship_Experience === '-'
    ) {
      missing_background_fields += ' <li>Internship Experience ?</li>';
    }
    if (
      !student.academic_background.university.Has_Working_Experience ||
      student.academic_background.university.Has_Working_Experience === '-'
    ) {
      missing_background_fields += ' <li>Full-Time Job Experience ?</li>';
    }
    if (!student.application_preference.expected_application_date) {
      missing_background_fields += '<li>Expected Application Year</li>';
    }
    if (!student.application_preference.expected_application_semester) {
      missing_background_fields += '<li>Expected Application Semester</li>';
    }
    if (!student.application_preference.target_application_field) {
      missing_background_fields += '<li>Target Application Fields</li>';
    }
    if (!student.application_preference.target_degree) {
      missing_background_fields += '<li>Target Degree Programs</li>';
    }
    if (student.academic_background.language.english_isPassed === '-') {
      missing_background_fields += '<li><b>English passed?</b></li>';
    }
    if (student.academic_background.language.english_isPassed === 'X') {
      if (student.academic_background.language.english_certificate === '') {
        missing_background_fields += '<li>English Certificate?</li>';
      }
      if (student.academic_background.language.english_test_date === '') {
        missing_background_fields += '<li>English Test Date?</li>';
      } else {
        // After test date 1 day:
        const today = new Date();
        if (
          parseInt(
            getNumberOfDays(
              student.academic_background.language.english_test_date,
              today
            ),
            10
          ) > 1
        ) {
          missing_background_fields += `<li>English test date : <b>expired ${getNumberOfDays(
            student.academic_background.language.english_test_date,
            today
          )} days</b>
          </li>`;
        }
      }
    }
    if (student.academic_background.language.german_isPassed === '-') {
      missing_background_fields += '<li>German passed?</li>';
    }
    if (student.academic_background.language.german_isPassed === 'X') {
      if (student.academic_background.language.german_certificate === '') {
        missing_background_fields += '<li>German Certificate?</li>';
      }
      if (student.academic_background.language.german_test_date === '') {
        missing_background_fields += '<li>German Test Date?</li>';
      } else {
        // After test date 1 day:
        const today = new Date();
        if (
          parseInt(
            getNumberOfDays(
              student.academic_background.language.german_test_date,
              today
            ),
            10
          ) > 1
        ) {
          missing_background_fields += `<li>German test date : <b>expired ${getNumberOfDays(
            student.academic_background.language.german_test_date,
            today
          )} days</b>
          </li>`;
        }
      }
    }
    if (student.academic_background.language.gre_isPassed === '-') {
      missing_background_fields += '<li>GRE passed?</li>';
    }
    if (student.academic_background.language.gre_isPassed === 'X') {
      if (student.academic_background.language.gre_certificate === '') {
        missing_background_fields += '<li>GRE Certificate?</li>';
      }
      if (student.academic_background.language.gre_test_date === '') {
        missing_background_fields += '<li>GRE Test Date?</li>';
      } else {
        // After test date 1 day:
        const today = new Date();
        if (
          parseInt(
            getNumberOfDays(
              student.academic_background.language.gre_test_date,
              today
            ),
            10
          ) > 1
        ) {
          missing_background_fields += `<li>GRE test date : <b>expired ${getNumberOfDays(
            student.academic_background.language.gre_test_date,
            today
          )} days</b>
          </li>`;
        }
      }
    }
    if (student.academic_background.language.gmat_isPassed === '-') {
      missing_background_fields += '<li>GMAT passed?</li>';
    }
    if (student.academic_background.language.gmat_isPassed === 'X') {
      if (student.academic_background.language.gmat_certificate === '') {
        missing_background_fields += '<li>GMAT Certificate?</li>';
      }
      if (student.academic_background.language.gmat_test_date === '') {
        missing_background_fields += '<li>GMAT Test Date?</li>';
      } else {
        // After test date 1 day:
        const today = new Date();
        if (
          parseInt(
            getNumberOfDays(
              student.academic_background.language.gmat_test_date,
              today
            ),
            10
          ) > 1
        ) {
          missing_background_fields += `<li>GMAT test date : <b>expired ${getNumberOfDays(
            student.academic_background.language.gmat_test_date,
            today
          )} days</b>
          </li>`;
        }
      }
    }
    if (user.role === Role.Agent || user.role === 'Admin') {
      missing_background_fields += `<p>Please go to <a href="${SURVEY_URL_FOR_AGENT_URL(
        student._id.toString()
      )}">Survey</a> and update them.</p>`;
    } else {
      missing_background_fields += `<p>Please go to <a href="${STUDENT_SURVEY_URL}">Survey</a> and update them.</p>`;
    }
    missing_background_fields += '</ul>';
  }

  return missing_background_fields;
};

const profile_name_list = {
  High_School_Diploma: 'High_School_Diploma',
  High_School_Transcript: 'High_School_Transcript',
  University_Entrance_Examination_GSAT: 'University_Entrance_Examination_GSAT',
  Bachelor_Certificate: 'Bachelor_Certificate',
  Bachelor_Transcript: 'Bachelor_Transcript',
  Englisch_Certificate: 'Englisch_Certificate',
  German_Certificate: 'German_Certificate',
  GRE: 'GRE',
  GMAT: 'GMAT',
  ECTS_Conversion: 'ECTS_Conversion',
  Course_Description: 'Course_Description',
  Internship: 'Internship',
  Exchange_Student_Certificate: 'Exchange_Student_Certificate',
  Employment_Certificate: 'Employment_Certificate',
  Passport: 'Passport',
  Others: 'Others'
};

const CVDeadline_Calculator = (student) => {
  let daysLeftMin = 3000;
  let CVDeadline = '';
  let CVDeadlineRolling = '';
  let hasRolling = false;
  const today = new Date();
  for (let i = 0; i < student.applications.length; i += 1) {
    if (student.applications[i].decided === 'O') {
      const application_deadline_temp = application_deadline_calculator(
        student,
        student.applications[i]
      );
      if (application_deadline_temp?.includes('olling')) {
        hasRolling = true;
        CVDeadlineRolling = application_deadline_temp;
      }
      const day_left = parseInt(
        getNumberOfDays(today, application_deadline_temp),
        10
      );
      if (daysLeftMin > day_left) {
        daysLeftMin = day_left;
        CVDeadline = application_deadline_temp;
      }
    }
  }
  return daysLeftMin === 3000
    ? hasRolling
      ? CVDeadlineRolling
      : '-'
    : CVDeadline;
};

const cvmlrl_deadline_within30days_escalation_summary = (student) => {
  const today = new Date();
  let missing_doc_list = '';
  let kk = 0;
  const CVDeadline = CVDeadline_Calculator(student);
  const CV_day_diff = getNumberOfDays(today, CVDeadline);
  for (let i = 0; i < student.generaldocs_threads.length; i += 1) {
    if (
      CV_day_diff < parseInt(ESCALATION_DEADLINE_DAYS_TRIGGER, 10) &&
      CV_day_diff > -30
    ) {
      if (!student.generaldocs_threads[i].isFinalVersion) {
        if (kk === 0) {
          missing_doc_list = `
        <b><a href="${STUDENT_PROFILE_FOR_AGENT_URL(student._id.toString())}">${
            student.firstname
          } ${student.lastname}</a></b><br />

        The following documents deadline are close, please <b>make sure</b> to close them as soon as possible:
        <ul>
        <li><a href="${THREAD_URL}/${student.generaldocs_threads[
            i
          ].doc_thread_id._id.toString()}">${
            student.generaldocs_threads[i].doc_thread_id.file_type
          }</a> - deadline ${CVDeadline_Calculator(
            student
          )} ${CV_day_diff} days left!</li>`;
          kk += 1;
        } else {
          missing_doc_list += `<li><a href="${THREAD_URL}/${student.generaldocs_threads[
            i
          ].doc_thread_id._id.toString()}">${
            student.generaldocs_threads[i].doc_thread_id.file_type
          }</a> - deadline ${CVDeadline_Calculator(
            student
          )} ${CV_day_diff} days left!</li>`;
        }
      }
    }
  }
  for (let i = 0; i < student.applications.length; i += 1) {
    const day_diff = getNumberOfDays(
      today,
      application_deadline_calculator(student, student.applications[i])
    );
    if (
      student.applications[i].decided === 'O' &&
      student.applications[i].closed !== 'O' &&
      day_diff < parseInt(ESCALATION_DEADLINE_DAYS_TRIGGER, 10) &&
      day_diff > -30
    ) {
      for (
        let j = 0;
        j < student.applications[i].doc_modification_thread.length;
        j += 1
      ) {
        if (
          !student.applications[i].doc_modification_thread[j].isFinalVersion
        ) {
          if (kk === 0) {
            missing_doc_list = `
        <b><a href="${STUDENT_PROFILE_FOR_AGENT_URL(student._id.toString())}">${
              student.firstname
            } ${student.lastname}</a></b><br />

        The following documents deadline are close, please <b>make sure</b> to close them as soon as possible:
        <ul>
        <li><a href="${THREAD_URL}/${student.applications[
              i
            ].doc_modification_thread[j].doc_thread_id._id.toString()}">${
              student.applications[i].programId.school
            } ${student.applications[i].programId.program_name} ${
              student.applications[i].doc_modification_thread[j].doc_thread_id
                .file_type
            }</a> - deadline ${application_deadline_calculator(
              student,
              student.applications[i]
            )} ${day_diff} days left!</li>`;
            kk += 1;
          } else {
            missing_doc_list += `<li><a href="${THREAD_URL}/${student.applications[
              i
            ].doc_modification_thread[j].doc_thread_id._id.toString()}">${
              student.applications[i].programId.school
            } ${student.applications[i].programId.program_name} ${
              student.applications[i].doc_modification_thread[j].doc_thread_id
                .file_type
            }</a> - deadline ${application_deadline_calculator(
              student,
              student.applications[i]
            )} ${day_diff} days left!</li>`;
          }
        }
      }
    }
  }
  if (missing_doc_list !== '') {
    missing_doc_list += '</ul>';
  }
  return missing_doc_list;
};

const base_documents_summary = (student) => {
  let rejected_base_documents = '';
  let missing_base_documents = '';
  const object_init = {};
  for (let i = 0; i < profile_keys_list.length; i += 1) {
    object_init[profile_keys_list[i]] = 'missing';
  }
  for (let i = 0; i < student.profile.length; i += 1) {
    if (student.profile[i].status === 'uploaded') {
      object_init[student.profile[i].name] = 'uploaded';
    } else if (student.profile[i].status === 'accepted') {
      object_init[student.profile[i].name] = 'accepted';
    } else if (student.profile[i].status === 'rejected') {
      object_init[student.profile[i].name] = 'rejected';
    } else if (student.profile[i].status === 'missing') {
      object_init[student.profile[i].name] = 'missing';
    } else if (student.profile[i].status === 'notneeded') {
      object_init[student.profile[i].name] = 'notneeded';
    }
  }
  let xx = 0;
  let yy = 0;
  for (let i = 0; i < profile_keys_list.length; i += 1) {
    if (object_init[profile_keys_list[i]] === 'missing') {
      if (xx === 0) {
        xx += 1;
        missing_base_documents = `
        <p>以下文件仍然未上傳, 請<b>盡速上傳</b>:</p>
        <p>The following base documents are still missing, please <b>upload</b> them as soon as possible:</p>
        <ul>
        <li>${profile_list[profile_keys_list[i]]}</li>`;
      } else {
        missing_base_documents += `<li>${
          profile_list[profile_keys_list[i]]
        }</li>`;
      }
    }
    if (object_init[profile_keys_list[i]] === 'rejected') {
      if (yy === 0) {
        yy += 1;
        rejected_base_documents = `
        <p>以下文件仍然<b>不合格</b>, 請<b>盡速補上</b>:</p>
        <p>The following base documents are <b>not okay</b>, please <b>upload</b> them again as soon as possible:</p>
        <ul>
        <li>${profile_list[profile_keys_list[i]]}</li>`;
      } else {
        rejected_base_documents += `<li>${
          profile_list[profile_keys_list[i]]
        }</li>`;
      }
    }
  }
  if (missing_base_documents !== '') {
    missing_base_documents += '</ul>';
  }
  if (rejected_base_documents !== '') {
    rejected_base_documents += '</ul>';
  }
  let base_documents = `

  ${missing_base_documents}

  ${rejected_base_documents}
  `;
  if (missing_base_documents !== '' || rejected_base_documents !== '') {
    base_documents += `<p>Please go to <a href="${BASE_DOCUMENT_URL}">Base Documents</a> and upload them.</p>`;
  }
  return missing_base_documents !== '' || rejected_base_documents !== ''
    ? base_documents
    : '';
};

module.exports = {
  TicketStatus,
  ManagerType,
  DocumentStatus,
  CheckListStatus,
  TaskStatus,
  EDITOR_SCOPE,
  ESSAY_WRITER_SCOPE,
  FILE_MAPPING_TABLE,
  RLs_CONSTANT,
  GENERAL_RLs_CONSTANT,
  General_Docs,
  base_documents_summary,
  is_deadline_within30days_needed,
  needUpdateCourseSelection,
  does_editor_have_pending_tasks,
  is_cv_ml_rl_task_response_needed,
  is_cv_ml_rl_reminder_needed,
  application_deadline_calculator,
  unsubmitted_applications_summary,
  unsubmitted_applications_escalation_summary,
  cvmlrl_deadline_within30days_escalation_summary,
  unsubmitted_applications_escalation_agent_summary,
  cv_rl_escalation_editor_list,
  cv_ml_rl_escalation_summary,
  cv_ml_rl_editor_escalation_summary,
  cv_ml_rl_unfinished_summary,
  profile_list,
  profile_keys_list,
  profile_name_list,
  getNumberOfDays,
  CVDeadline_Calculator,
  isNotArchiv,
  isArchiv,
  check_english_language_passed,
  check_german_language_passed,
  check_languages_filled,
  missing_academic_background,
  ACCOUNT_ACTIVATION_URL,
  RESEND_ACTIVATION_URL,
  TEAMS_URL,
  PASSWORD_RESET_URL,
  FORGOT_PASSWORD_URL,
  ESSAY_CENTER_URL,
  CVMLRL_CENTER_URL,
  CVMLRL_FOR_EDITOR_URL,
  UNI_ASSIST_FOR_STUDENT_URL,
  UNI_ASSIST_FOR_AGENT_URL,
  THREAD_URL,
  ARCHIVED_STUDENTS_URL,
  BASE_DOCUMENT_URL,
  STUDENT_COMMUNICATION_THREAD_URL,
  INTERNAL_COMMUNICATION_THREAD_URL,
  BASE_DOCUMENT_FOR_AGENT_URL,
  SURVEY_URL_FOR_AGENT_URL,
  TEMPLATE_DOWNLOAD_URL,
  STUDENT_APPLICATION_URL,
  STUDENT_SURVEY_URL,
  SETTINGS_URL,
  PROFILE_URL,
  STUDENT_PROFILE_FOR_AGENT_URL,
  STUDENT_COURSE_URL,
  STUDENT_ANALYSED_COURSE_URL,
  AGENT_CALENDAR_EVENTS_URL,
  STUDENT_CALENDAR_EVENTS_URL,
  PROGRAM_URL,
  JITSI_MEET_URL,
  JITSI_MEET_INSTRUCTIONS_URL,
  TAIGER_SIGNATURE,
  SPLIT_LINE,
  ENGLISH_BELOW,
  CONTACT_AGENT
};
