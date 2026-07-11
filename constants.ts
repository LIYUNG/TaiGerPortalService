import {
  ProfileNameType,
  Role,
  PROFILE_NAME,
  is_TaiGer_Editor,
  is_TaiGer_Student,
  is_TaiGer_Agent,
  is_TaiGer_AdminAgent,
  isProgramDecided,
  isProgramSubmitted,
  isProgramWithdraw
} from '@taiger-common/core';
import { differenceInDays } from 'date-fns';
import { Types } from 'mongoose';
import {
  DocumentStatusType,
  SCHOOL_TAGS,
  PROGRAM_SUBJECTS,
  IUser,
  IStudent,
  IApplication,
  IProgram,
  IDocumentthread,
  IUserProfileItem,
  IUserAcademicBackground,
  IUserApplicationPreference
} from '@taiger-common/model';

import { ORIGIN, ESCALATION_DEADLINE_DAYS_TRIGGER } from './config';
import {
  TENANT_WEBSITE,
  TENANT_NAME,
  TENANT_INSTAGRAM_LINK,
  TENANT_FACEBOOK_LINK,
  TENANT_MEDIUM_LINK,
  TENANT_LINKEDIN_LINK
} from './constants/common';

// ---------------------------------------------------------------------------
// Local "populated" view types.
//
// The helpers in this file operate on Mongoose aggregation results / fully
// populated documents (e.g. StudentDAO.getStudentsWithApplications, which
// $lookup's applications/courses onto each student), not on the raw
// unpopulated schema shapes exported by @taiger-common/model (where refs
// such as `programId` / `doc_thread_id` are typed as
// `ObjectId | string | <doc>` unions, and collections such as
// `applications` don't exist on IStudent at all). These local types describe
// what the code below actually reads: refs that are always populated
// objects, and collections that are always arrays — matching every access
// below, none of which guards against them being absent.
// ---------------------------------------------------------------------------
type ObjectIdLike = Types.ObjectId | string;

type UserWithId = IUser & { _id: ObjectIdLike };

interface PopulatedDocThread extends Omit<IDocumentthread, 'updatedAt'> {
  _id: ObjectIdLike;
  updatedAt: Date;
}

interface PopulatedThreadRef {
  isFinalVersion?: boolean;
  latest_message_left_by_id?: string;
  doc_thread_id: PopulatedDocThread;
  updatedAt: Date;
  createdAt?: Date;
}

interface PopulatedApplication
  extends Omit<IApplication, 'programId' | 'doc_modification_thread'> {
  programId: IProgram;
  doc_modification_thread: PopulatedThreadRef[];
}

interface PopulatedCourse {
  updatedAt: Date;
  analysis?: { updatedAt?: Date };
}

interface PopulatedStudent
  extends Omit<
    IStudent,
    | 'generaldocs_threads'
    | 'profile'
    | 'academic_background'
    | 'application_preference'
  > {
  _id: ObjectIdLike;
  generaldocs_threads: PopulatedThreadRef[];
  profile: IUserProfileItem[];
  academic_background: IUserAcademicBackground;
  application_preference: IUserApplicationPreference;
  applications: PopulatedApplication[];
  courses: PopulatedCourse[];
}

export const ACCOUNT_ACTIVATION_URL = new URL('/account/activation', ORIGIN)
  .href;
export const RESEND_ACTIVATION_URL = new URL(
  '/account/resend-activation',
  ORIGIN
).href;
export const PASSWORD_RESET_URL = new URL('/account/reset-password', ORIGIN)
  .href;
export const FORGOT_PASSWORD_URL = new URL('/forgot-password', ORIGIN).href;

export const CVMLRL_CENTER_URL = new URL('/cv-ml-rl-center', ORIGIN).href;
export const CVMLRL_FOR_EDITOR_URL = (studentId: string) =>
  new URL(`/student-database/${studentId}#cvmlrl`, ORIGIN).href;
export const UNI_ASSIST_FOR_STUDENT_URL = new URL('/uni-assist', ORIGIN).href;
export const UNI_ASSIST_FOR_AGENT_URL = (studentId: string) =>
  new URL(`/student-database/${studentId}#uniassist`, ORIGIN).href;
export const THREAD_URL = new URL('/document-modification', ORIGIN).href;
export const THREAD_ID_URL = (thread_id: string) =>
  new URL(`/document-modification/${thread_id}`, ORIGIN).href;
export const ARCHIVED_STUDENTS_URL = new URL('/archiv/students', ORIGIN).href;
export const BASE_DOCUMENT_URL = new URL('/base-documents', ORIGIN).href;
export const BASE_DOCUMENT_FOR_AGENT_URL = (studentId: string) =>
  new URL(`/student-database/${studentId}#profile`, ORIGIN).href;
export const STUDENT_COMMUNICATION_THREAD_URL = (studentId: string) =>
  new URL(`/communications/std/${studentId}`, ORIGIN).href;
export const INTERNAL_COMMUNICATION_THREAD_URL = (studentId: string) =>
  new URL(`/communications/t/${studentId}`, ORIGIN).href;
export const INTERVIEW_CENTER_URL = new URL('/interview-training', ORIGIN).href;
export const SINGLE_INTERVIEW_THREAD_URL = (interview_id: string) =>
  new URL(`/interview-training/${interview_id}`, ORIGIN).href;
export const SINGLE_INTERVIEW_SURVEY_THREAD_URL = (interview_id: string) =>
  new URL(`/interview-training/${interview_id}/survey`, ORIGIN).href;
export const TEMPLATE_DOWNLOAD_URL = new URL('/download', ORIGIN).href;
export const STUDENT_APPLICATION_URL = new URL('/student-applications', ORIGIN)
  .href;
export const STUDENT_APPLICATION_STUDENT_URL = (student_id: string) =>
  new URL(`/student-applications/${student_id}`, ORIGIN).href;
export const STUDENT_SURVEY_URL = new URL('/survey', ORIGIN).href;
export const SURVEY_URL_FOR_AGENT_URL = (studentId: string) =>
  new URL(`/student-database/${studentId}#survey`, ORIGIN).href;
export const SETTINGS_URL = new URL('/settings', ORIGIN).href;
export const PROFILE_URL = new URL('/profile', ORIGIN).href;
export const TEAMS_URL = new URL('/teams', ORIGIN).href;
export const STUDENT_PROFILE_FOR_AGENT_URL = (studentId: string) =>
  new URL(`/student-database/${studentId}#profile`, ORIGIN).href;
export const STUDENT_COURSE_URL = (studentId: string) =>
  new URL(`/my-courses/${studentId}`, ORIGIN).href;
export const STUDENT_ANALYSED_COURSE_URL = (studentId: string) =>
  new URL(`/my-courses/analysis/${studentId}`, ORIGIN).href;
export const AGENT_CALENDAR_EVENTS_URL = (taigerAgentId: string) =>
  new URL(`/events/taiger/${taigerAgentId}`, ORIGIN).href;
export const STUDENT_CALENDAR_EVENTS_URL = (studentId: string) =>
  new URL(`/events/students/${studentId}`, ORIGIN).href;
export const PROGRAM_URL = (program_id: string) =>
  new URL(`/programs/${program_id}`, ORIGIN).href;
export const JITSI_MEET_URL = (studentId: string) =>
  new URL(`https://meet.jit.si/${studentId}`, ORIGIN).href;
export const JITSI_MEET_INSTRUCTIONS_URL = new URL(
  '/docs/search/64eb25ec89ea0d1fcb39df73',
  ORIGIN
).href;

export const TAIGER_SIGNATURE = `
<p><b>Your ${TENANT_NAME} Team</b></p><p>Website: <a href="${TENANT_WEBSITE}">${TENANT_WEBSITE}</a></p>
<div class="social-icons">
  <a href="${TENANT_INSTAGRAM_LINK}" target="_blank">
      <img src="https://upload.wikimedia.org/wikipedia/commons/a/a5/Instagram_icon.png" alt="Instagram">
  </a>
  <a href="${TENANT_FACEBOOK_LINK}" target="_blank">
     <img src="https://upload.wikimedia.org/wikipedia/commons/b/bd/Facebook_lg.png" alt="Facebook">
  </a>
  <a href="${TENANT_MEDIUM_LINK}" target="_blank">
     <img src="https://seeklogo.com/images/M/medium-logo-93CDCF6451-seeklogo.com.png" alt="Medium">
  </a>
  <a href="${TENANT_LINKEDIN_LINK}" target="_blank">
     <img src="https://upload.wikimedia.org/wikipedia/commons/c/ca/LinkedIn_logo_initials.png" alt="LinkedIn">
  </a>
  
</div>`;
export const SPLIT_LINE =
  '-------------------------------------------------------';
export const ENGLISH_BELOW = '(English version below)';
export const CONTACT_AGENT = '如果您有任何疑問，請聯絡您的顧問。';

export const TicketStatus = {
  Open: 'open',
  Resolved: 'resolved'
};

export const ManagerType = {
  Agent: 'Agent',
  Editor: 'Editor',
  AgentAndEditor: 'AgentAndEditor',
  None: 'None'
};

export const isNotArchiv = (user: IUser) => {
  if (user.archiv === undefined || !user.archiv) {
    return true;
  }
  return false;
};

export const isArchiv = (user: IUser) => !!user.archiv;

// `year` is a "year" value that's arithmetically decremented below. Callers
// pass `application.application_year`, which the schema types as `string`
// (IApplication.application_year?: string) even though it always holds a
// numeric string ("2024") — JS's `-` operator already coerces it to a number
// at runtime, so `Number(year)` here just makes that existing coercion
// explicit instead of changing the computed result.
const adjustYearForSemester = (
  year: number | string | undefined,
  month: number,
  semester: string | undefined
): number | string | undefined => {
  if (!semester) return 'Err';
  if ((semester === 'WS' && month > 9) || (semester === 'SS' && month > 3)) {
    return Number(year) - 1;
  }
  return year;
};

const formatApplicationDate = (
  year: number | string | undefined,
  date: string | undefined
) => {
  if (!date) return `${year}-<TBD>`;
  if (date.toLowerCase().includes('rolling')) return `${year}-Rolling`;

  const [month, day] = date.split('-');
  return `${year}/${month}/${day}`;
};

export const application_deadline_V2_calculator = (
  application: PopulatedApplication
) => {
  if (isProgramWithdraw(application)) {
    return 'WITHDRAW';
  }
  const { application_deadline, semester } = application?.programId || {};

  if (!application_deadline) {
    return 'No Data';
  }
  const { application_year } = application;

  if (!application_deadline) {
    return `${application_year}-<TBD>`;
  }
  if (application_deadline?.toLowerCase()?.includes('rolling')) {
    // include Rolling
    return `${application_year}-Rolling`;
  }
  // Use the already-narrowed local (guarded truthy above) rather than
  // re-reading `application.programId.application_deadline` — same value,
  // but keeps TS's narrowing since it doesn't track narrowing through a
  // re-read of the original property path.
  const deadline_month = parseInt(application_deadline.split('-')[0], 10);

  const adjusted_application_year = adjustYearForSemester(
    application_year,
    deadline_month,
    semester
  );

  return formatApplicationDate(adjusted_application_year, application_deadline);
};

export const EDITOR_SCOPE = {
  CV: 'Curriculum Vitae',
  CV_US: 'Curriculum Vitae (US)',
  ML: 'Motivation Letter',
  SOP: 'Statement of Purpose',
  PHS: 'Personal History of Statement',
  Portfolio: 'Portfolio',
  RL_A: 'Recommendation Letter',
  RL_B: 'Recommendation Letter',
  RL_C: 'Recommendation Letter',
  Recommendation_Letter_A: 'Recommendation Letter',
  Recommendation_Letter_B: 'Recommendation Letter',
  Recommendation_Letter_C: 'Recommendation Letter',
  Scholarship_Form: 'Scholarship'
};
export const ESSAY_WRITER_SCOPE = {
  Essay: 'Essay'
};
export const FILE_MAPPING_TABLE = { ...EDITOR_SCOPE, ...ESSAY_WRITER_SCOPE };
export const PROGRAM_SPECIFIC_FILETYPE = [
  {
    required: 'ml_required',
    fileType: 'ML'
  },
  {
    required: 'sop_required',
    fileType: 'SOP'
  },
  {
    required: 'phs_required',
    fileType: 'PHS'
  },
  {
    required: 'essay_required',
    fileType: 'Essay'
  },
  {
    required: 'portfolio_required',
    fileType: 'Portfolio'
  },
  {
    required: 'supplementary_form_required',
    fileType: 'Supplementary_Form'
  },
  {
    required: 'curriculum_analysis_required',
    fileType: 'Curriculum_Analysis'
  },
  {
    required: 'scholarship_form_required',
    fileType: 'Scholarship_Form'
  }
];

export const RLs_CONSTANT = ['RL_A', 'RL_B', 'RL_C'];
export const GENERAL_RLs_CONSTANT = [
  'Recommendation_Letter_A',
  'Recommendation_Letter_B',
  'Recommendation_Letter_C'
];
export const General_Docs = [
  'Recommendation_Letter_A',
  'Recommendation_Letter_B',
  'Recommendation_Letter_C',
  'Form_A',
  'Form_B',
  'CV',
  'CV_US',
  'Others'
];

export const is_deadline_within30days_needed = (student: PopulatedStudent) => {
  const today = new Date();
  if (student.application_preference.expected_application_date === '') {
    return false;
  }
  for (let k = 0; k < student.applications.length; k += 1) {
    const day_diff = differenceInDays(
      application_deadline_V2_calculator(student.applications[k]),
      today
    );
    // TODO: should pack all thread due soon in a student email,
    // not multiple email for 1 student  for daily reminder.
    if (
      isProgramDecided(student.applications[k]) &&
      !isProgramSubmitted(student.applications[k]) &&
      !isProgramWithdraw(student.applications[k]) &&
      day_diff < ESCALATION_DEADLINE_DAYS_TRIGGER &&
      day_diff > -30
    ) {
      return true;
    }
  }
  return false;
};

export const needUpdateCourseSelection = (student: PopulatedStudent) => {
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

  // necessary if courses or analysis expired 39 daays and is studying
  if (
    !student.courses[0].updatedAt ||
    !student.courses[0].analysis?.updatedAt
  ) {
    return true;
  }
  const course_aged_days = differenceInDays(
    new Date(),
    student.courses[0].updatedAt
  );
  const analyse_aged_days = differenceInDays(
    new Date(),
    student.courses[0].analysis.updatedAt
  );
  const trigger_days = 39;
  if (course_aged_days > trigger_days && analyse_aged_days > trigger_days) {
    return true;
  }

  return false;
};

export const does_editor_have_pending_tasks = (
  students: PopulatedStudent[],
  editor: UserWithId
) => {
  for (let i = 0; i < students.length; i += 1) {
    // check CV tasks
    for (let j = 0; j < students[i].generaldocs_threads.length; j += 1) {
      const thread = students[i].generaldocs_threads[j];
      if (
        !thread.isFinalVersion &&
        thread.latest_message_left_by_id !== '' &&
        thread.latest_message_left_by_id !== editor._id.toString()
      ) {
        return true;
      }
    }
    for (let k = 0; k < students[i].applications.length; k += 1) {
      const app = students[i].applications[k];
      if (isProgramDecided(app)) {
        for (let j = 0; j < app.doc_modification_thread.length; j += 1) {
          if (
            !app.doc_modification_thread[j].isFinalVersion &&
            app.doc_modification_thread[j].latest_message_left_by_id !== '' &&
            app.doc_modification_thread[j].latest_message_left_by_id !==
              editor._id.toString()
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
};

export const is_cv_ml_rl_task_response_needed = (
  student: PopulatedStudent,
  user: UserWithId
) => {
  for (let i = 0; i < student.generaldocs_threads.length; i += 1) {
    const thread = student.generaldocs_threads[i];
    if (is_TaiGer_Editor(user)) {
      if (
        !thread.isFinalVersion &&
        thread.latest_message_left_by_id !== '' &&
        thread.latest_message_left_by_id !== user._id.toString()
      ) {
        return true;
      }
    } else if (is_TaiGer_Student(user)) {
      if (
        !thread.isFinalVersion &&
        thread.latest_message_left_by_id !== user._id.toString()
      ) {
        return true;
      }
    } else if (is_TaiGer_Agent(user)) {
      if (!thread.isFinalVersion) {
        return true;
      }
    }
  }
  for (let i = 0; i < student.applications.length; i += 1) {
    const app = student.applications[i];
    if (isProgramDecided(app)) {
      for (let j = 0; j < app.doc_modification_thread.length; j += 1) {
        if (is_TaiGer_Editor(user)) {
          if (
            !app.doc_modification_thread[j].isFinalVersion &&
            app.doc_modification_thread[j].latest_message_left_by_id !== '' &&
            app.doc_modification_thread[j].latest_message_left_by_id !==
              user._id.toString()
          ) {
            return true;
          }
        } else if (is_TaiGer_Student(user)) {
          if (
            !app.doc_modification_thread[j].isFinalVersion &&
            app.doc_modification_thread[j].latest_message_left_by_id !==
              user._id.toString()
          ) {
            return true;
          }
        } else if (is_TaiGer_Agent(user)) {
          if (!app.doc_modification_thread[j].isFinalVersion) {
            return true;
          }
        }
      }
    }
  }
  return false;
};

export const is_cv_ml_rl_reminder_needed = (
  student: PopulatedStudent,
  user: UserWithId,
  trigger_days: number
) => {
  const today = new Date();
  for (let i = 0; i < student.generaldocs_threads.length; i += 1) {
    const thread = student.generaldocs_threads[i];
    const day_diff = differenceInDays(today, thread.updatedAt);
    if (is_TaiGer_Editor(user)) {
      if (
        !thread.isFinalVersion &&
        thread.latest_message_left_by_id !== '' &&
        thread.latest_message_left_by_id !== user._id.toString() &&
        day_diff > trigger_days
      ) {
        return true;
      }
    } else if (is_TaiGer_Student(user)) {
      if (
        !thread.isFinalVersion &&
        thread.latest_message_left_by_id !== user._id.toString() &&
        day_diff > trigger_days
      ) {
        return true;
      }
    } else if (is_TaiGer_Agent(user)) {
      if (!thread.isFinalVersion && day_diff > trigger_days) {
        return true;
      }
    }
  }
  for (let i = 0; i < student.applications.length; i += 1) {
    const app = student.applications[i];
    if (isProgramDecided(app)) {
      for (let j = 0; j < app.doc_modification_thread.length; j += 1) {
        const day_diff_2 = differenceInDays(
          today,
          app.doc_modification_thread[j].doc_thread_id.updatedAt
        );
        if (is_TaiGer_Editor(user)) {
          if (
            !app.doc_modification_thread[j].isFinalVersion &&
            app.doc_modification_thread[j].latest_message_left_by_id !== '' &&
            app.doc_modification_thread[j].latest_message_left_by_id !==
              user._id.toString() &&
            day_diff_2 > trigger_days
          ) {
            return true;
          }
        } else if (is_TaiGer_Student(user)) {
          if (
            !app.doc_modification_thread[j].isFinalVersion &&
            app.doc_modification_thread[j].latest_message_left_by_id !==
              user._id.toString() &&
            day_diff_2 > trigger_days
          ) {
            return true;
          }
        } else if (is_TaiGer_Agent(user)) {
          if (
            !app.doc_modification_thread[j].isFinalVersion &&
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

export const unsubmitted_applications_summary = (student: PopulatedStudent) => {
  let unsubmitted_applications = '';
  let x = 0;
  for (let i = 0; i < student.applications.length; i += 1) {
    const app = student.applications[i];
    if (
      isProgramDecided(app) &&
      !isProgramSubmitted(app) &&
      !isProgramWithdraw(app)
    ) {
      if (x === 0) {
        unsubmitted_applications = `
        The following program(s) are not submitted yet: 
        <ul>
        <li>${app.programId.school} ${app.programId.program_name}</li>`;
        x += 1;
      } else {
        unsubmitted_applications += `<li>${app.programId.school} - ${app.programId.program_name}</li>`;
      }
    }
  }
  if (unsubmitted_applications !== '') {
    unsubmitted_applications += '</ul>';
    unsubmitted_applications += `<p>If there is any updates, please go to <a href="${STUDENT_APPLICATION_URL}">Applications Overview</a> and update them.</p>`;
  }
  return unsubmitted_applications;
};

export const cv_rl_escalation_editor_list = (
  student: PopulatedStudent,
  user: UserWithId,
  trigger_days: number
) => {
  let missing_doc_list = '';
  const today = new Date();

  for (let i = 0; i < student.generaldocs_threads.length; i += 1) {
    const day_diff = differenceInDays(
      today,
      student.generaldocs_threads[i].doc_thread_id.updatedAt
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

const cv_rl_escalation_agent_list = (
  student: PopulatedStudent,
  user: UserWithId,
  trigger_days: number
) => {
  let missing_doc_list = '';
  const today = new Date();

  for (let i = 0; i < student.generaldocs_threads.length; i += 1) {
    const day_diff = differenceInDays(
      today,
      student.generaldocs_threads[i].doc_thread_id.updatedAt
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

const cv_rl_escalation_student_list = (
  student: PopulatedStudent,
  user: UserWithId,
  trigger_days: number
) => {
  let missing_doc_list = '';
  const today = new Date();

  for (let i = 0; i < student.generaldocs_threads.length; i += 1) {
    const day_diff = differenceInDays(
      today,
      student.generaldocs_threads[i].doc_thread_id.updatedAt
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
  student: PopulatedStudent,
  user: UserWithId,
  trigger_days: number,
  application: PopulatedApplication
) => {
  let missing_doc_list = '';
  const today = new Date();

  if (isProgramDecided(application)) {
    for (let j = 0; j < application.doc_modification_thread.length; j += 1) {
      const day_diff_2 = differenceInDays(
        today,
        application.doc_modification_thread[j].doc_thread_id.updatedAt
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

const ml_essay_escalation_editor_list = (
  student: PopulatedStudent,
  user: UserWithId,
  trigger_days: number
) => {
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

const ml_essay_escalation_student_list = (
  student: PopulatedStudent,
  user: UserWithId,
  trigger_days: number
) => {
  let missing_doc_list = '';
  const today = new Date();

  for (let i = 0; i < student.applications.length; i += 1) {
    if (isProgramDecided(student.applications[i])) {
      for (
        let j = 0;
        j < student.applications[i].doc_modification_thread.length;
        j += 1
      ) {
        const day_diff_2 = differenceInDays(
          today,
          student.applications[i].doc_modification_thread[j].doc_thread_id
            .updatedAt
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
  application: PopulatedApplication
) => {
  let missing_doc_list = '';
  const today = new Date();

  if (isProgramDecided(application)) {
    for (let j = 0; j < application.doc_modification_thread.length; j += 1) {
      const day_diff_2 = differenceInDays(
        today,
        application.doc_modification_thread[j].doc_thread_id.updatedAt
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

const ml_essay_escalation_agent_list = (student: PopulatedStudent) => {
  let missing_doc_list = '';

  for (let i = 0; i < student.applications.length; i += 1) {
    missing_doc_list += ml_essay_escalation_agent_single_program_list(
      student.applications[i]
    );
  }
  return missing_doc_list;
};

export const cv_ml_rl_escalation_summary = (
  student: PopulatedStudent,
  user: UserWithId,
  trigger_days: number
) => {
  let missing_doc_list = '';
  if (is_TaiGer_Editor(user)) {
    missing_doc_list = `
        The following documents are waiting for your response, please <b>reply</b> it as soon as possible:
        <ul>
        ${cv_rl_escalation_editor_list(student, user, trigger_days)}
        ${ml_essay_escalation_editor_list(student, user, trigger_days)}
        </ul>`;
  } else if (is_TaiGer_Student(user)) {
    missing_doc_list = `
        The following documents are waiting for your response, please <b>reply</b> it as soon as possible:
        <ul>
        ${cv_rl_escalation_student_list(student, user, trigger_days)}
        ${ml_essay_escalation_student_list(student, user, trigger_days)}
        </ul>`;
  }
  return missing_doc_list;
};

const unsubmitted_applications_list = (student: PopulatedStudent) => {
  let unsubmitted_applications_li = '';
  const today = new Date();
  for (let i = 0; i < student.applications.length; i += 1) {
    const app = student.applications[i];
    const day_diff = differenceInDays(
      application_deadline_V2_calculator(app),
      today
    );
    if (
      isProgramDecided(app) &&
      !isProgramSubmitted(app) &&
      !isProgramWithdraw(app) &&
      day_diff < ESCALATION_DEADLINE_DAYS_TRIGGER &&
      day_diff > -30
    ) {
      unsubmitted_applications_li += `<li>${app.programId.school} ${
        app.programId.program_name
      }: <b> Deadline ${application_deadline_V2_calculator(app)} </b>
      <ul>
      ${ml_essay_escalation_agent_single_program_list(app)}
      </ul>
      </li>
      `;
    }
  }
  return unsubmitted_applications_li;
};

export const unsubmitted_applications_escalation_summary = (
  student: PopulatedStudent,
  user: UserWithId,
  trigger_days: number
) => {
  let unsubmitted_applications = '';
  unsubmitted_applications = `
        The following program(s) are not submitted yet and very close to <b>deadline</b>: 
        <ul>
        ${unsubmitted_applications_list(student)}
        </ul>
        <ul>
        ${cv_rl_escalation_agent_list(student, user, trigger_days)}
        </ul>
        <p>If the applications are already submitted, please go to <a href="${STUDENT_APPLICATION_URL}">Applications Overview</a> and update them.</p>`;
  return unsubmitted_applications;
};

export const unsubmitted_applications_escalation_agent_summary = (
  student: PopulatedStudent,
  user: UserWithId,
  trigger_days: number
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

export const cv_ml_rl_editor_escalation_summary = (
  student: PopulatedStudent,
  user: UserWithId,
  trigger_days: number
) => {
  let missing_doc_list = '';
  if (is_TaiGer_Editor(user)) {
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
  if (is_TaiGer_Agent(user)) {
    missing_doc_list = `
        <b><a href="${STUDENT_PROFILE_FOR_AGENT_URL(student._id.toString())}">${
      student.firstname
    } ${student.lastname}</a></b><br />

        The following documents are idle for a while, please <b>inform</b> student / editor as soon as possible:
        <ul>
        ${cv_rl_escalation_agent_list(student, user, trigger_days)}
        ${ml_essay_escalation_agent_list(student)}
        </ul>`;
  }

  return missing_doc_list;
};

export const cv_ml_rl_unfinished_summary = (
  student: PopulatedStudent,
  user: UserWithId
) => {
  let missing_doc_list = '';
  let kk = 0;
  for (let i = 0; i < student.generaldocs_threads.length; i += 1) {
    if (is_TaiGer_Editor(user)) {
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
    } else if (is_TaiGer_Student(user)) {
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
    } else if (is_TaiGer_Agent(user)) {
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
    const app = student.applications[i];
    if (isProgramDecided(app)) {
      for (let j = 0; j < app.doc_modification_thread.length; j += 1) {
        if (is_TaiGer_Editor(user)) {
          if (
            // TODO: filter non-editor scope files
            !app.doc_modification_thread[j].isFinalVersion &&
            app.doc_modification_thread[j].latest_message_left_by_id !== '' &&
            app.doc_modification_thread[j].latest_message_left_by_id !==
              user._id.toString()
          ) {
            const docThread = app.doc_modification_thread[j].doc_thread_id;
            const threadUrl = `${THREAD_URL}/${docThread._id}`;
            const programInfo = `${app.programId.school} ${app.programId.program_name} ${docThread.file_type}`;
            const listItem = `<li><a href="${threadUrl}">${programInfo}</a></li>`;

            if (kk === 0) {
              missing_doc_list = `
    The following documents are waiting for your response, please <b>reply</b> as soon as possible:
    <ul>
      ${listItem}`;
              kk += 1;
            } else {
              missing_doc_list += listItem;
            }
          }
        } else if (is_TaiGer_Student(user)) {
          if (
            !app.doc_modification_thread[j].isFinalVersion &&
            app.doc_modification_thread[j].latest_message_left_by_id !==
              user._id.toString()
          ) {
            if (kk === 0) {
              missing_doc_list = `
        The following documents are waiting for your response, please <b>reply</b> it as soon as possible:
        <ul>
        <li><a href="${THREAD_URL}/${app.doc_modification_thread[
                j
              ].doc_thread_id._id.toString()}">${app.programId.school} ${
                app.programId.program_name
              } ${
                app.doc_modification_thread[j].doc_thread_id.file_type
              }</a></li>`;
              kk += 1;
            } else {
              missing_doc_list += `<li><a href="${THREAD_URL}/${app.doc_modification_thread[
                j
              ].doc_thread_id._id.toString()}">${app.programId.school} ${
                app.programId.program_name
              } ${
                app.doc_modification_thread[j].doc_thread_id.file_type
              }</a></li>`;
            }
          }
        } else if (is_TaiGer_Agent(user)) {
          if (!app.doc_modification_thread[j].isFinalVersion) {
            if (kk === 0) {
              missing_doc_list = `
        The following documents are not finished:
        <ul>
        <li><a href="${THREAD_URL}/${app.doc_modification_thread[
                j
              ].doc_thread_id._id.toString()}">${app.programId.school} ${
                app.programId.program_name
              } ${
                app.doc_modification_thread[j].doc_thread_id.file_type
              }</a></li>`;
              kk += 1;
            } else {
              missing_doc_list += `<li><a href="${THREAD_URL}/${app.doc_modification_thread[
                j
              ].doc_thread_id._id.toString()}">${app.programId.school} ${
                app.programId.program_name
              } ${
                app.doc_modification_thread[j].doc_thread_id.file_type
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
// `PROFILE_NAME` is keyed by the same set of profile document names as
// `ProfileNameType`; the cast lets `PROFILE_NAME[profile_keys_list[i]]`
// below index it without widening to `string`.
export const profile_keys_list = Object.keys(ProfileNameType) as Array<
  keyof typeof PROFILE_NAME
>;

export const check_english_language_passed = (
  academic_background: IUserAcademicBackground
) => {
  if (!academic_background || !academic_background.language) {
    return false;
  }
  if (academic_background.language.english_isPassed === 'O') {
    return true;
  }

  return false;
};

export const check_german_language_passed = (
  academic_background: IUserAcademicBackground
) => {
  if (!academic_background || !academic_background.language) {
    return false;
  }
  if (academic_background.language.german_isPassed === 'O') {
    return true;
  }

  return false;
};

export const check_languages_filled = (
  academic_background: IUserAcademicBackground
) => {
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

export const missing_academic_background = (
  student: PopulatedStudent,
  user: UserWithId
) => {
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
    // FLAGGED BUG (pre-existing, not fixed per task scope): this condition
    // looks like it should be `!student.academic_background || ...` (see the
    // sibling checks below it) — as written, given academic_background is
    // guaranteed truthy here (we're inside a block reached only when NOT all
    // of academic_background/university/language/application_preference are
    // present, but academic_background itself may still be truthy), this
    // makes the `||`'s right-hand side dead code, which strict typing now
    // reports as "Property does not exist on type 'never'". Suppressed
    // rather than "fixed" to avoid changing behavior, per task instructions.
    // FLAGGED BUG (see comment above): the `||`'s right-hand side is effectively
    // dead code. The cast preserves the exact runtime behaviour while satisfying
    // strict typing (replaces a stale `@ts-expect-error` that no longer matched
    // the reported line).
    if (
      student.academic_background ||
      !(student.academic_background as { university?: unknown }).university
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
    // FLAGGED BUG (pre-existing, not fixed per task scope): same pattern as
    // the `.university` check above — likely meant `!student.academic_background`.
    // @ts-expect-error -- see FLAGGED BUG comment above the `.university` check
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
    if (is_TaiGer_AdminAgent(user)) {
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
    !student.application_preference.target_program_language ||
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
    if (!student.application_preference.target_program_language) {
      missing_background_fields += '<li>Target Program Language</li>';
    }
    if (!student.application_preference.target_degree) {
      missing_background_fields += '<li>Target Degree Programs</li>';
    }
    if (student.academic_background.language.english_isPassed === '-') {
      missing_background_fields += '<li><b>English passed?</b></li>';
    }
    if (student.academic_background.language.english_isPassed === 'O') {
      if (student.academic_background.language.english_test_date === '') {
        missing_background_fields += '<li>English Test Date missing.</li>';
      }
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
          differenceInDays(
            today,
            // Non-null assertion: guaranteed set here — the `else` branch
            // above already ruled out the empty-string ('') case, so the
            // only remaining possibility per the schema (`?: string`) would
            // be `undefined`, which isn't expected once english_isPassed is
            // 'X'. No behavior change (`!` is erased at compile time).
            student.academic_background.language.english_test_date!
          ) > 1
        ) {
          missing_background_fields += `<li>English test date : <b>expired ${differenceInDays(
            today,
            student.academic_background.language.english_test_date!
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
          differenceInDays(
            today,
            // Non-null assertion: see the english_test_date comment above.
            student.academic_background.language.german_test_date!
          ) > 1
        ) {
          missing_background_fields += `<li>German test date : <b>expired ${differenceInDays(
            today,
            student.academic_background.language.german_test_date!
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
          differenceInDays(
            today,
            // Non-null assertion: see the english_test_date comment above.
            student.academic_background.language.gre_test_date!
          ) > 1
        ) {
          missing_background_fields += `<li>GRE test date : <b>expired ${differenceInDays(
            today,
            student.academic_background.language.gre_test_date!
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
          differenceInDays(
            today,
            // Non-null assertion: see the english_test_date comment above.
            student.academic_background.language.gmat_test_date!
          ) > 1
        ) {
          missing_background_fields += `<li>GMAT test date : <b>expired ${differenceInDays(
            today,
            student.academic_background.language.gmat_test_date!
          )} days</b>
          </li>`;
        }
      }
    }
    if (is_TaiGer_AdminAgent(user)) {
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

export const CVDeadline_Calculator = (applications: PopulatedApplication[]) => {
  let daysLeftMin = 3000;
  let CVDeadline = '';
  let CVDeadlineRolling = '';
  let hasRolling = false;
  const today = new Date();
  for (let i = 0; i < applications.length; i += 1) {
    const app = applications[i];
    if (isProgramDecided(app) && app.closed === '-') {
      const application_deadline_temp = application_deadline_V2_calculator(app);
      if (application_deadline_temp?.toLowerCase()?.includes('rolling')) {
        hasRolling = true;
        CVDeadlineRolling = application_deadline_temp;
      }
      // differenceInDays already returns a number; parseInt was a no-op
      // redundant string-conversion wrapper (parseInt coerces numbers to
      // strings internally either way), dropped for the same numeric result.
      const day_left = differenceInDays(application_deadline_temp, today);
      if (daysLeftMin > day_left) {
        daysLeftMin = day_left;
        CVDeadline = application_deadline_temp;
      }
    }
  }
  if (daysLeftMin === 3000) {
    return hasRolling ? CVDeadlineRolling : '-';
  }

  return CVDeadline;
};

export const General_RL_Deadline_Calculator = (
  applications: PopulatedApplication[]
) => {
  const RLrequiredApplications = applications?.filter((app) => {
    const program = app?.programId;
    if (
      !program ||
      !program.rl_required ||
      program.rl_required === '0' ||
      program.is_rl_specific
    ) {
      return false;
    }
    return true;
  });

  return CVDeadline_Calculator(RLrequiredApplications);
};

export const cvmlrl_deadline_within30days_escalation_summary = (
  student: PopulatedStudent,
  applications: PopulatedApplication[]
) => {
  const today = new Date();
  let missing_doc_list = '';
  let kk = 0;
  const CVDeadline = CVDeadline_Calculator(applications);
  const CV_day_diff = differenceInDays(CVDeadline, today);
  for (let i = 0; i < student.generaldocs_threads.length; i += 1) {
    if (CV_day_diff < ESCALATION_DEADLINE_DAYS_TRIGGER && CV_day_diff > -30) {
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
            applications
          )} ${CV_day_diff} days left!</li>`;
          kk += 1;
        } else {
          missing_doc_list += `<li><a href="${THREAD_URL}/${student.generaldocs_threads[
            i
          ].doc_thread_id._id.toString()}">${
            student.generaldocs_threads[i].doc_thread_id.file_type
          }</a> - deadline ${CVDeadline_Calculator(
            applications
          )} ${CV_day_diff} days left!</li>`;
        }
      }
    }
  }
  for (let i = 0; i < applications.length; i += 1) {
    const app = applications[i];
    const day_diff = differenceInDays(
      application_deadline_V2_calculator(app),
      today
    );
    if (
      isProgramDecided(app) &&
      !isProgramSubmitted(app) &&
      day_diff < ESCALATION_DEADLINE_DAYS_TRIGGER &&
      day_diff > -30
    ) {
      for (let j = 0; j < app.doc_modification_thread.length; j += 1) {
        if (!app.doc_modification_thread[j].isFinalVersion) {
          if (kk === 0) {
            missing_doc_list = `
        <b><a href="${STUDENT_PROFILE_FOR_AGENT_URL(student._id.toString())}">${
              student.firstname
            } ${student.lastname}</a></b><br />

        The following documents deadline are close, please <b>make sure</b> to close them as soon as possible:
        <ul>
          <li><a href="${THREAD_URL}/${app.doc_modification_thread[
              j
            ].doc_thread_id._id.toString()}">${app.programId.school} ${
              app.programId.program_name
            } ${
              app.doc_modification_thread[j].doc_thread_id.file_type
            }</a> - deadline ${application_deadline_V2_calculator(
              app
            )} ${day_diff} days left!</li>`;
            kk += 1;
          } else {
            missing_doc_list += `<li><a href="${THREAD_URL}/${app.doc_modification_thread[
              j
            ].doc_thread_id._id.toString()}">${app.programId.school} ${
              app.programId.program_name
            } ${
              app.doc_modification_thread[j].doc_thread_id.file_type
            }</a> - deadline ${application_deadline_V2_calculator(
              app
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

export const base_documents_summary = (student: PopulatedStudent) => {
  let rejected_base_documents = '';
  let missing_base_documents = '';
  const object_init: Record<string, DocumentStatusType> = {};
  for (let i = 0; i < profile_keys_list.length; i += 1) {
    object_init[profile_keys_list[i]] = DocumentStatusType.Missing;
  }
  for (let i = 0; i < student.profile.length; i += 1) {
    const profile = student.profile[i];
    if (profile.status === DocumentStatusType.Uploaded) {
      object_init[profile.name] = DocumentStatusType.Uploaded;
    } else if (profile.status === DocumentStatusType.Accepted) {
      object_init[profile.name] = DocumentStatusType.Accepted;
    } else if (profile.status === DocumentStatusType.Rejected) {
      object_init[profile.name] = DocumentStatusType.Rejected;
    } else if (profile.status === DocumentStatusType.Missing) {
      object_init[profile.name] = DocumentStatusType.Missing;
    } else if (profile.status === DocumentStatusType.NotNeeded) {
      object_init[profile.name] = DocumentStatusType.NotNeeded;
    }
  }
  let xx = 0;
  let yy = 0;
  for (let i = 0; i < profile_keys_list.length; i += 1) {
    if (object_init[profile_keys_list[i]] === DocumentStatusType.Missing) {
      if (xx === 0) {
        xx += 1;
        missing_base_documents = `
        <p>以下文件仍然未上傳, 請<b>盡速上傳</b>:</p>
        <p>The following base documents are still missing, please <b>upload</b> them as soon as possible:</p>
        <ul>
        <li>${PROFILE_NAME[profile_keys_list[i]]}</li>`;
      } else {
        missing_base_documents += `<li>${
          PROFILE_NAME[profile_keys_list[i]]
        }</li>`;
      }
    }
    if (object_init[profile_keys_list[i]] === DocumentStatusType.Rejected) {
      if (yy === 0) {
        yy += 1;
        rejected_base_documents = `
        <p>以下文件仍然<b>不合格</b>, 請<b>盡速補上</b>:</p>
        <p>The following base documents are <b>not okay</b>, please <b>upload</b> them again as soon as possible:</p>
        <ul>
        <li>${PROFILE_NAME[profile_keys_list[i]]}</li>`;
      } else {
        rejected_base_documents += `<li>${
          PROFILE_NAME[profile_keys_list[i]]
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

export const SCHOOL_TAG_KEYS = Object.keys(SCHOOL_TAGS ?? {});

export const CV_MUST_HAVE_PATTERNS = [
  '- present',
  '– present',
  '- current',
  '– current',
  '- now',
  '– now',
  '- jetzt',
  '– jetzt',
  'til now',
  'til present'
];

export const PROGRAM_SUBJECT_KEYS = Object.keys(PROGRAM_SUBJECTS ?? {});

export { Role };
