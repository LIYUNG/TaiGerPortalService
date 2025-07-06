const {
  cv_ml_rl_escalation_summary,
  is_cv_ml_rl_task_response_needed,
  cv_ml_rl_editor_escalation_summary,
  cv_ml_rl_unfinished_summary,
  base_documents_summary,
  missing_academic_background,
  unsubmitted_applications_summary,
  unsubmitted_applications_escalation_summary,
  unsubmitted_applications_escalation_agent_summary,

  STUDENT_SURVEY_URL,
  cvmlrl_deadline_within30days_escalation_summary,
  is_deadline_within30days_needed,
  is_cv_ml_rl_reminder_needed,
  STUDENT_COURSE_URL,
  SURVEY_URL_FOR_AGENT_URL
} = require('../constants');

const { transporter, sendEmail } = require('./email/configuration');
const { asyncHandler } = require('../middlewares/error-handler');

const StudentTasksReminderEmail = asyncHandler(async (recipient, payload) => {
  const subject = `TaiGer Weekly Reminder: ${recipient.firstname} ${recipient.lastname}`;
  const unsubmitted_applications = unsubmitted_applications_summary(
    payload.student
  );

  const base_documents = base_documents_summary(payload.student);

  // TODO: it shows: "Technische Universität München (TUM) Computational Science and Engineering undefined"
  const unread_cv_ml_rl_thread = cv_ml_rl_unfinished_summary(
    payload.student,
    payload.student
  );
  // TODO: uni-assist if missing
  // TODO if english not passed and not registering any date, inform them
  const missing_uni_assist = '';
  const survey_not_complete = missing_academic_background(
    payload.student,
    payload.student
  );
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

${survey_not_complete}

${unread_cv_ml_rl_thread}

${base_documents}

${unsubmitted_applications}



`; // should be for admin/editor/agent/student

  if (
    !(
      survey_not_complete === '' &&
      unread_cv_ml_rl_thread === '' &&
      base_documents === '' &&
      unsubmitted_applications === ''
    )
  ) {
    return sendEmail(recipient, subject, message);
  }
});

const AgentTasksReminderEmail = asyncHandler(async (recipient, payload) => {
  const subject = `TaiGer Agent Reminder: ${recipient.firstname} ${recipient.lastname}`;
  let student_i = '';
  for (let i = 0; i < payload.students.length; i += 1) {
    const base_documents = base_documents_summary(payload.students[i]);
    const unread_cv_ml_rl_thread = cv_ml_rl_unfinished_summary(
      payload.students[i],
      payload.agent
    );
    // TODO
    const missing_uni_assist = '';
    const academic_background_not_complete = missing_academic_background(
      payload.students[i],
      payload.agent
    );
    const unsubmitted_applications = unsubmitted_applications_summary(
      payload.students[i]
    );
    if (
      academic_background_not_complete !== '' ||
      base_documents !== '' ||
      unread_cv_ml_rl_thread !== '' ||
      unsubmitted_applications !== ''
    ) {
      student_i += `
      <p><b>${payload.students[i].firstname} ${payload.students[i].lastname}</b>,</p>

      ${academic_background_not_complete}

      ${base_documents}
      
      ${unread_cv_ml_rl_thread}

      ${unsubmitted_applications}

`;
    }
  }

  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>The following is the overview of the current status for your each student:</p>

${student_i}


`; // should be for admin/editor/agent/student

  return sendEmail(recipient, subject, message);
});

const EditorTasksReminderEmail = asyncHandler(async (recipient, payload) => {
  const subject = `TaiGer Editor Reminder: ${recipient.firstname} ${recipient.lastname}`;
  let student_i = '';
  let first = true;
  payload.students.forEach((student) => {
    if (is_cv_ml_rl_task_response_needed(student, payload.editor)) {
      const unread_cv_ml_rl_thread = cv_ml_rl_unfinished_summary(
        student,
        payload.editor
      );
      const studentBlock = `
      <p><b>${student.firstname} ${student.lastname}</b>,</p>
      
      ${unread_cv_ml_rl_thread}
    `;
      student_i += first ? studentBlock : `${studentBlock}`;
      first = false;
    }
  });

  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

The following is the overview of the open tasks for your students

${student_i}



`; // should be for admin/editor/agent/student

  return sendEmail(recipient, subject, message);
});

const StudentApplicationsDeadline_Within30Days_DailyReminderEmail =
  asyncHandler(async (recipient, payload) => {
    const subject = `[Important] Applications Deadline very close: ${recipient.firstname} ${recipient.lastname}`;
    const unsubmitted_applications =
      unsubmitted_applications_escalation_summary(
        payload.student,
        payload.student,
        payload.trigger_days
      );

    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

${unsubmitted_applications}


`;

    return sendEmail(recipient, subject, message);
  });

const StudentCourseSelectionReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const subject = `[Courses Update] ${recipient.firstname} ${recipient.lastname}: 請更新您的課程，並為下學期選課做準備 | Please update courses and prepare the courses for the next semester!`;
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>為了確保您的課程符合度能符合之後申請學校的課程要求，TaiGer 提醒您前往 <a href="${STUDENT_COURSE_URL(
      payload.student._id.toString()
    )}">TaiGer Portal My Course</a> 更新您截至目前為止的課程，您的 Agent 會再次為您下學期的選課做準備。</p>

<p>為了您和 Agent 的溝通順暢，盡速更新課程，您的 Agent 會在您更新課程後，為您盡快分析課程。</p>

<p>若您已經大學畢業，或是尚未就讀大學，請更新 <a href="${STUDENT_SURVEY_URL}">My Profile</a> 中 <b>Already Bachelor graduated ?</b> 為<b>Yes 已畢業</b> 或是<b>No 未開始就讀</b> ，您將不會在收到此 Email</p>


`;

    return sendEmail(recipient, subject, message);
  }
);

const AgentCourseSelectionReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const subject = `[Courses Update] ${payload.student.firstname} ${payload.student.lastname}: 課程過時。請提醒學生，並為下學期選課做準備 | Please remind the student for courses selection next semester!`;
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>為了確保學生課程符合度能符合之後申請學校的課程要求，TaiGer 提醒您前往 <a href="${STUDENT_COURSE_URL(
      payload.student._id.toString()
    )}">${payload.student.firstname} ${
      payload.student.lastname
    } Course</a> 檢查是否已更新課程分析。</p>

<p>若學生已經大學畢業，或是尚未就讀大學，請更新 <a href="${SURVEY_URL_FOR_AGENT_URL(
      payload.student._id.toString()
    )}">My Profile</a> 中 <b>Already Bachelor graduated ?</b> 為<b>Yes 已畢業</b> 或是<b>No 未開始就讀</b> ，您將不會在收到此 Email</p>


`;

    return sendEmail(recipient, subject, message);
  }
);

const StudentCVMLRLEssay_NoReplyAfter3Days_DailyReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const subject = `[Action Required] ${recipient.firstname} ${recipient.lastname}: Your Editor is waiting for you!`;
    const unread_cv_ml_rl_thread = cv_ml_rl_escalation_summary(
      payload.student,
      payload.student,
      payload.trigger_days // after 3 days
    );
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

${unread_cv_ml_rl_thread}


`;

    return sendEmail(recipient, subject, message);
  }
);

const EditorCVMLRLEssay_NoReplyAfter7Days_DailyReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const subject = `[Action Required] ${recipient.firstname} ${recipient.lastname}: Your Students are waiting for your response!`;
    let unread_cv_ml_rl_threads = '';
    for (let i = 0; i < payload.students.length; i += 1) {
      unread_cv_ml_rl_threads += `
    ${
      is_cv_ml_rl_reminder_needed(
        payload.students[i],
        payload.editor,
        payload.trigger_days
      )
        ? cv_ml_rl_editor_escalation_summary(
            payload.students[i],
            payload.editor,
            payload.trigger_days // after 7 days
          )
        : ''
    }
    `;
    }
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

${unread_cv_ml_rl_threads}


`;

    return sendEmail(recipient, subject, message);
  }
);

const AgentCVMLRLEssay_NoReplyAfterXDays_DailyReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const subject = `[Escalation] ${recipient.firstname} ${recipient.lastname}: The documents are idle for ${payload.trigger_days} days!`;
    let unread_cv_ml_rl_threads = '';
    for (let i = 0; i < payload.students.length; i += 1) {
      unread_cv_ml_rl_threads += `
    ${
      is_cv_ml_rl_reminder_needed(
        payload.students[i],
        payload.agent,
        payload.trigger_days
      )
        ? cv_ml_rl_editor_escalation_summary(
            payload.students[i],
            payload.agent,
            payload.trigger_days // after 7 days
          )
        : ''
    }
    `;
    }
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

${unread_cv_ml_rl_threads}


`;

    return sendEmail(recipient, subject, message);
  }
);

const AgentApplicationsDeadline_Within30Days_DailyReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const subject = `[Action Required] ${recipient.firstname} ${recipient.lastname}: Your students' applications deadline very close`;
    let unsubmitted_applications_students = '';
    for (let i = 0; i < payload.students.length; i += 1) {
      unsubmitted_applications_students += `
    ${
      is_deadline_within30days_needed(payload.students[i])
        ? unsubmitted_applications_escalation_agent_summary(
            payload.students[i],
            payload.agent,
            payload.trigger_days
          )
        : ''
    }`;
    }

    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

${unsubmitted_applications_students}


`;

    return sendEmail(recipient, subject, message);
  }
);

const EditorCVMLRLEssayDeadline_Within30Days_DailyReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const subject = `[Escalation] ${recipient.firstname} ${recipient.lastname}: These Tasks deadline very close!`;
    let cvmlrl_deadline_soon = '';
    let hasContent = false;
    for (let i = 0; i < payload.students.length; i += 1) {
      const temp_text = cvmlrl_deadline_within30days_escalation_summary(
        payload.students[i]
      );
      if (temp_text !== '') {
        cvmlrl_deadline_soon += `${temp_text}`;
        hasContent = true;
      }
    }

    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

${cvmlrl_deadline_soon}


`;
    if (hasContent) {
      return sendEmail(recipient, subject, message);
    }
  }
);

module.exports = {
  StudentTasksReminderEmail,
  AgentTasksReminderEmail,
  EditorTasksReminderEmail,
  StudentApplicationsDeadline_Within30Days_DailyReminderEmail,
  StudentCourseSelectionReminderEmail,
  AgentCourseSelectionReminderEmail,
  StudentCVMLRLEssay_NoReplyAfter3Days_DailyReminderEmail,
  EditorCVMLRLEssay_NoReplyAfter7Days_DailyReminderEmail,
  AgentCVMLRLEssay_NoReplyAfterXDays_DailyReminderEmail,
  EditorCVMLRLEssayDeadline_Within30Days_DailyReminderEmail,
  AgentApplicationsDeadline_Within30Days_DailyReminderEmail
};
