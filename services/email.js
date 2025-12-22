const ical = require('ical-generator');
const queryString = require('query-string');
const { DocumentStatusType } = require('@taiger-common/core');

const {
  ACCOUNT_ACTIVATION_URL,
  TEAMS_URL,
  RESEND_ACTIVATION_URL,
  PASSWORD_RESET_URL,
  FORGOT_PASSWORD_URL,
  ARCHIVED_STUDENTS_URL,
  CVMLRL_CENTER_URL,
  CVMLRL_FOR_EDITOR_URL,
  UNI_ASSIST_FOR_STUDENT_URL,
  UNI_ASSIST_FOR_AGENT_URL,
  THREAD_URL,
  BASE_DOCUMENT_URL,
  BASE_DOCUMENT_FOR_AGENT_URL,
  TEMPLATE_DOWNLOAD_URL,
  STUDENT_APPLICATION_URL,
  SETTINGS_URL,
  STUDENT_COURSE_URL,
  SURVEY_URL_FOR_AGENT_URL,
  SPLIT_LINE,
  ENGLISH_BELOW,
  CONTACT_AGENT,
  STUDENT_COMMUNICATION_THREAD_URL,
  STUDENT_ANALYSED_COURSE_URL,
  JITSI_MEET_INSTRUCTIONS_URL,
  AGENT_CALENDAR_EVENTS_URL,
  STUDENT_CALENDAR_EVENTS_URL,
  PROGRAM_URL,
  SINGLE_INTERVIEW_THREAD_URL,
  INTERVIEW_CENTER_URL,
  STUDENT_PROFILE_FOR_AGENT_URL,
  THREAD_ID_URL,
  SINGLE_INTERVIEW_SURVEY_THREAD_URL,
  STUDENT_APPLICATION_STUDENT_URL
} = require('../constants');

const { ORIGIN } = require('../config');
const { htmlContent } = require('./emailTemplate');
const { transporter, sendEmail } = require('./email/configuration');
const {
  senderName,
  taigerNotReplyGmail,
  appDomain
} = require('../constants/email');
const { asyncHandler } = require('../middlewares/error-handler');

const sendEventEmail = (
  to,
  subject,
  message,
  meeting_event,
  cc, // array
  event_title,
  isUpdatingEvent,
  toDelete
) => {
  const cc_event_list = cc.map((c) => ({
    email: c.email,
    name: `${c.firstname} ${c.lastname}`,
    status: 'ACCEPTED',
    rsvp: true,
    type: 'INDIVIDUAL',
    role: 'REQ-PARTICIPANT'
  }));

  const cc_receiver_list = cc.map((c) => ({
    address: c.email,
    name: `${c.firstname} ${c.lastname}`
  }));

  const event = ical({
    domain: appDomain,
    prodId: '//TaiGer Portal//taigerconsultancy-portal.com//EN',
    method: 'request', // publish (manually add) or request : receiver can choose yes or no. (but not good. info not sync with portal.)
    events: [
      {
        start: new Date(meeting_event.start), // Start date of the event
        end: new Date(meeting_event.end), // End date of the event (1 hour later in this example)
        summary: event_title,
        sequence: isUpdatingEvent ? 1 : 0, // Set the SEQUENCE to 1
        id: meeting_event._id.toString(), // Set a custom UID here
        description: meeting_event.description,
        status: toDelete ? 'CANCELLED' : 'CONFIRMED', // for delete event
        location: meeting_event.meetingLink,
        organizer: {
          name: 'TaiGer Portal',
          email: taigerNotReplyGmail,
          mailto: taigerNotReplyGmail
        },
        attendees: [
          ...cc_event_list,
          {
            email: to.address,
            name: `${to.firstname} ${to.lastname}`,
            status: 'ACCEPTED',
            rsvp: true,
            type: 'INDIVIDUAL',
            role: 'REQ-PARTICIPANT'
          }
        ]
      }
    ]
  });

  const mail = {
    from: senderName,
    to,
    cc: cc_receiver_list,
    bcc: taigerNotReplyGmail,
    subject,
    // text: message,
    html: htmlContent(message),
    attachments: [
      {
        filename: 'event.ics',
        method: 'request', // publish (manually add) or request : receiver can choose yes or no. (but not good. info not sync with portal.)
        content: event.toString()
      }
    ]
  };
  return transporter.sendMail(mail);
};

const updateNotificationEmail = asyncHandler(async (recipient, msg) => {
  const subject =
    '您的TaiGer Portal使用者權限已更新 / Your user role in TaiGer Portal updated';
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>您的 TaiGer Portal 使用者權限已更新。</p>

<p>請至 <a href="${SETTINGS_URL}">Setting</a> 確認使用者身分角色。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>Your user role in TaiGer Portal has been changed.</p>

<p>Please visit <a href="${SETTINGS_URL}">Setting</a> and make sure your user role.</p>

`;

  return sendEmail(recipient, subject, message);
});

const updatePermissionNotificationEmail = asyncHandler(
  async (recipient, msg) => {
    const subject =
      '您的TaiGer Portal使用者權限已更新 / Your user permissions in TaiGer Portal updated';
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>您的 TaiGer Portal 使用者權限已更新。</p>

<p>請至 <a href="${TEAMS_URL}">TaiGer Teams</a> 確認使用者權限。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>Your user permissions in TaiGer Portal have been updated.</p>

<p>Please visit <a href="${TEAMS_URL}">TaiGer Teams</a> and make sure your user permissions.</p>


`;

    return sendEmail(recipient, subject, message);
  }
);

const deleteTemplateSuccessEmail = asyncHandler(async (recipient, msg) => {
  const subject = `Template ${msg.category_name} deleted successfully!`;
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.category_name} 模板已成功刪除於</p>

<p>${msg.updatedAt}</p>

<p>更多細節請至 <a href="${TEMPLATE_DOWNLOAD_URL}">TaiGer Portal Download</a></p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>the template ${msg.category_name} is deleted sucessfully on</p>

<p>${msg.updatedAt}</p>

<p>For more details, please visit: <a href="${TEMPLATE_DOWNLOAD_URL}">TaiGer Portal Download</a></p>


`;

  return sendEmail(recipient, subject, message);
});

// TODO
const sendInvitationReminderEmail = asyncHandler(async (recipient, payload) => {
  const subject = 'TaiGer Portal 開通提醒 / TaiGer Portal Activation Reminder';
  const activationLink = queryString.stringifyUrl({
    url: ACCOUNT_ACTIVATION_URL,
    query: { email: recipient.address, token: payload.token }
  });
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>請查看第一封 TaiGer email 連結啟用您的帳戶：</p>

${activationLink}

<p>此連結將於 20 分鐘後失效。</p>

<p>但您仍可再次請求啟用連結於： ${RESEND_ACTIVATION_URL}</p>

<p>密碼為臨時，登入後請至 ${SETTINGS_URL} 盡速更換您的密碼</p>
<p> </p>
<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>Your user account has been created.</p>
<p>Please use the following link to activate your account:</p>

${activationLink}

<p>This link will expire in 20 minutes.</p>
<p>You can request another here: ${RESEND_ACTIVATION_URL}</p>

<p>The following are your TaiGer Portal credential</p>
<p>Email: <b>${recipient.address}</b></p>
<p>Password: <b>${payload.password}</b></p>

<p>Please change the password in ${SETTINGS_URL} after login.</p>


`;

  return sendEmail(recipient, subject, message);
});

const sendInvitationEmail = asyncHandler(async (recipient, payload) => {
  const subject =
    'TaiGer Portal 電子信箱驗證 / TaiGer Portal Email verification';
  const activationLink = queryString.stringifyUrl({
    url: ACCOUNT_ACTIVATION_URL,
    query: { email: recipient.address, token: payload.token }
  });
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>請使用以下連結來啟用您的帳戶：</p>

${activationLink}

<p>此連結將於 20 分鐘後失效。</p>

<p>但您仍可再次請求啟用連結於： ${RESEND_ACTIVATION_URL}</p>

<p>以下為您的 TaiGer Portal 帳號 (即為您的 Email) 及 密碼：</p>
<p>Email: <b>${recipient.address}</b></p>
<p>Password: <b>${payload.password}</b></p>

<p>密碼為臨時，登入後請至 ${SETTINGS_URL} 盡速更換您的密碼</p>
<p> </p>
<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>Your user account has been created.</p>
<p>Please use the following link to activate your account:</p>

${activationLink}

<p>This link will expire in 20 minutes.</p>
<p>You can request another here: ${RESEND_ACTIVATION_URL}</p>

<p>The following are your TaiGer Portal credential</p>
<p>Email: <b>${recipient.address}</b></p>
<p>Password: <b>${payload.password}</b></p>

<p>Please change the password in ${SETTINGS_URL} after login.</p>


`;

  return sendEmail(recipient, subject, message);
});

const sendConfirmationEmail = asyncHandler(async (recipient, token) => {
  const subject =
    'TaiGer Portal 電子信箱驗證 / TaiGer Portal Email verification';
  const activationLink = queryString.stringifyUrl({
    url: ACCOUNT_ACTIVATION_URL,
    query: { email: recipient.address, token }
  });
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>您的 TaiGer Portal 帳戶已被建立。請使用以下連結來啟用您的帳戶：</p>

${activationLink}

<p>此連結將於 20 分鐘後失效。</p>

<p>但您仍可再次請求啟用連結於： ${RESEND_ACTIVATION_URL}</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>Your user account has been created.</p>
<p>Please use the following link to activate your account:</p>

${activationLink}

<p>This link will expire in 20 minutes.</p>
<p>You can request another here: ${RESEND_ACTIVATION_URL}</p>


`;

  return sendEmail(recipient, subject, message);
});

const sendForgotPasswordEmail = asyncHandler(async (recipient, token) => {
  const subject =
    'TaiGer Portal 密碼重設指示 / TaiGer Portal Password reset instructions';
  const passwordResetLink = queryString.stringifyUrl({
    url: PASSWORD_RESET_URL,
    query: { email: recipient.address, token }
  });
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>請用以下連結重新設定您的 TaiGer Portal 密碼：</p>

${passwordResetLink}

<p>此連結將於 20 分鐘後失效。</p>

<p>但您仍可再次請求密碼重設連結於： ${FORGOT_PASSWORD_URL} </p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

Please use the link below to reset your password:

${passwordResetLink}

<p>This link will expire in 20 minutes.</p>
<p>You can request another here: ${FORGOT_PASSWORD_URL}</p>


`;

  return sendEmail(recipient, subject, message);
});

const sendPasswordResetEmail = asyncHandler(async (recipient) => {
  const subject =
    'TaiGer Portal 密碼重設成功 / TaiGer Portal Password reset successfully';
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>您的 TaiGer Portal 密碼已成功被更新，您現在可以使用新密碼登入 TaiGer Portal。</p>

<a href="${ORIGIN}" class="mui-button" target="_blank">登入</a>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>Your password has been successfully updated, you can now login with your new password.</p>

<a href="${ORIGIN}" class="mui-button" target="_blank">Login</a>


`;

  return sendEmail(recipient, subject, message);
});

const sendAccountActivationConfirmationEmail = asyncHandler(
  async (recipient, msg) => {
    const subject = 'TaiGer Portal Account activation confirmation';
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>您的 TaiGer Portal 帳戶已成功開通。</p>

您現在可以登入並開始使用 TaiGer Portal。

<p>TaiGer Portal 連結： <a href="${ORIGIN}">TaiGer portal</a></p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>Your TaiGer Portal Account has been successfully activated.</p>

<p>You can now login and explore the power of TaiGer Portal!</p>

<p>TaiGer Portal: <a href="${ORIGIN}">TaiGer portal</a></p>


`;

    return sendEmail(recipient, subject, message);
  }
);

const sendAgentUploadedProfileFilesForStudentEmail = asyncHandler(
  async (recipient, msg) => {
    const subject = `Your ${msg.uploaded_documentname} is successfully uploaded!`;
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>您的顧問 ${msg.agent_firstname} ${msg.agent_lastname} 已幫您上傳 ${msg.uploaded_documentname} </p>

<p>於 ${msg.uploaded_updatedAt} 。 </p>

<p>請至 <a href="${BASE_DOCUMENT_URL}">Base Documents</a> 並查看細節。</p>

<p>${CONTACT_AGENT}</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>your agent ${msg.agent_firstname} ${msg.agent_lastname} have uploaded ${msg.uploaded_documentname} on ${msg.uploaded_updatedAt} for you. </p>

<p>Please go to <a href="${BASE_DOCUMENT_URL}">Base Documents</a> and see the details.</p>

<p>If you have any question, feel free to contact your agent.</p>


`;

    return sendEmail(recipient, subject, message);
  }
);

const sendAgentUploadedVPDForStudentEmail = asyncHandler(
  async (recipient, msg) => {
    const subject = `您的 ${msg.fileType} 已成功上傳 / Your ${msg.fileType} is successfully uploaded!`;
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>您的顧問 ${msg.agent_firstname} ${msg.agent_lastname} 已幫您上傳 ${msg.uploaded_documentname} </p>

<p>於${msg.uploaded_updatedAt} 。</p>

<p>請至 <a href="${UNI_ASSIST_FOR_STUDENT_URL}">Student Uni-Assit</a> 並查看細節。</p>

<p>${CONTACT_AGENT}</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>your agent ${msg.agent_firstname} ${msg.agent_lastname} have uploaded ${msg.uploaded_documentname} on ${msg.uploaded_updatedAt} for you.</p>

<p>Please go to <a href="${UNI_ASSIST_FOR_STUDENT_URL}">Student Uni-Assist</a> and see the details.</p>

<p>If you have any question, feel free to contact your agent.</p>


`;

    return sendEmail(recipient, subject, message);
  }
);

const sendUploadedProfileFilesRemindForAgentEmail = asyncHandler(
  async (recipient, msg) => {
    const student_name = `${msg.student_firstname} ${msg.student_lastname}`;
    const subject = `New ${msg.uploaded_documentname} uploaded from ${student_name}`;
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>您的學生 ${student_name} 上傳了 ${msg.uploaded_documentname} </p>

<p>於 ${msg.uploaded_updatedAt} 。</p>

<a href="${BASE_DOCUMENT_FOR_AGENT_URL(
      msg.student_id
    )}" class="mui-button" target="_blank">查看檔案</a>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>your student ${student_name} has uploaded ${msg.uploaded_documentname} </p>

<p>on ${msg.uploaded_updatedAt}.</p>

<a href="${BASE_DOCUMENT_FOR_AGENT_URL(
      msg.student_id
    )}" class="mui-button" target="_blank">See file</a>

`; // should be for student/agent/editor

    return sendEmail(recipient, subject, message);
  }
);

const sendUploadedVPDRemindForAgentEmail = asyncHandler(
  async (recipient, msg) => {
    const subject = `新 ${msg.fileType} 上傳從 ${msg.student_firstname} ${msg.student_lastname} / New ${msg.fileType} uploaded from ${msg.student_firstname} ${msg.student_lastname}`;
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>您的學生 ${msg.student_firstname} ${msg.student_lastname} 上傳了 ${
      msg.uploaded_documentname
    } </p>

<p>在 ${msg.uploaded_updatedAt}.</p>

<p>請至 <a href="${UNI_ASSIST_FOR_AGENT_URL(msg.student_id)}">${
      msg.student_firstname
    } ${msg.student_lastname} Uni-Assist</a> 確認細節。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>your student ${msg.student_firstname} ${msg.student_lastname} has uploaded ${
      msg.uploaded_documentname
    } </p>

<p>on ${msg.uploaded_updatedAt}.</p>

<p>Please go to <a href="${UNI_ASSIST_FOR_AGENT_URL(msg.student_id)}">${
      msg.student_firstname
    } ${msg.student_lastname} Uni-Assist</a> and see the details.</p>


`; // should be for student/agent/editor

    return sendEmail(recipient, subject, message);
  }
);

const sendChangedProfileFileStatusEmail = asyncHandler(
  async (recipient, msg) => {
    let subject;
    let message;
    if (msg.status === DocumentStatusType.Rejected) {
      subject = `[Action Required] 文件狀態更新：請再次上傳 ${msg.category} / File Status changes: please upload ${msg.category} again`;
      message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>由於下列原因, 請再次上傳 ${msg.category}:</p>

<p><b>${msg.message}</b></p>

<p>請至 <a href="${BASE_DOCUMENT_URL}">Base Documents</a> 確認被拒絕原因，並刪除舊檔案，然後再次上傳。</p>

<p>如果有任何疑問，請聯絡您的顧問。 </p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>due to the following reason, please upload ${msg.category} again:</p>

<p>${msg.message}</p>

<p>Please go to <a href="${BASE_DOCUMENT_URL}">Base Documents</a> and check again the reason and then delete it before upload it again.</p>

<p>If you have any question, please contact your agent. </p>


`; // should be for student
    } else {
      subject = `[Closed] 文件狀態更新：${msg.category} 合格 / File Status changes: ${msg.category} is valid`;
      message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>您的顧問已經看過您上傳的文件 ${msg.category}，文字清楚、無資訊遺漏</p>

<p>並且該文件可以拿來做為申請!</p>

<p>請至 <a href="${BASE_DOCUMENT_URL}">Base Documents</a> 並再次確認。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>your uploaded file ${msg.category} is successfully checked by your agent</p>

<p>and it can be used for the application! </p>

<p>Please go to <a href="${BASE_DOCUMENT_URL}">Base Documents</a> and doueble check the details.</p>

`; // should be for student
    }

    return sendEmail(recipient, subject, message);
  }
);

const informAgentManagerNewStudentEmail = asyncHandler(
  async (recipient, payload) => {
    const studentName = `${payload.std_firstname} ${payload.std_lastname}`;
    const agentName = `${payload.agents
      .map((agent) => `${agent.firstname}`)
      .join(' ')}`;
    const subject = `新學生 ${studentName} 已被指派給 ${agentName} / New student ${studentName} assigned to ${agentName}`;
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${studentName} 將被指配給 ${agentName}。</p>

<p>請至 ${STUDENT_PROFILE_FOR_AGENT_URL(payload.std_id)} 查看他的背景問卷！</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${studentName} will be assigned to ${agentName}!</p>

<p>Please see ${STUDENT_PROFILE_FOR_AGENT_URL(
      payload.std_id
    )}'s background and survey</p>


`;

    return sendEmail(recipient, subject, message);
  }
);

const informAgentNewStudentEmail = asyncHandler(async (recipient, msg) => {
  const subject = `新學生 ${msg.std_firstname} ${msg.std_lastname} 已被指派給您 / New student ${msg.std_firstname} ${msg.std_lastname} assigned to you`;
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.std_firstname} ${msg.std_lastname} 將被指配給您。</p>

<p>請至 ${SURVEY_URL_FOR_AGENT_URL(
    msg.std_id
  )} 查看他的背景問卷並與她/他打聲招呼！</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.std_firstname} ${msg.std_lastname} will be your student!</p>

<p>Please see the survey ${SURVEY_URL_FOR_AGENT_URL(msg.std_id)}</p>

<p>and say hello to your student!</p>


`;

  return sendEmail(recipient, subject, message);
});

const informStudentTheirAgentEmail = asyncHandler(async (recipient, msg) => {
  const subject = 'Your Agent';
  let agent;
  for (let i = 0; i < msg.agents.length; i += 1) {
    if (i === 0) {
      agent = `${msg.agents[i].firstname} ${msg.agents[i].lastname}`;
    } else {
      agent += `, ${msg.agents[i].firstname} ${msg.agents[i].lastname}`;
    }
  }
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${agent} 將會是您的顧問。</p>

<p>請至 <a href="${ORIGIN}">TaiGer portal</a> 並開始準備您的文件。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${agent} will be your agent!</p>

<p>Please go to <a href="${ORIGIN}">TaiGer portal</a> , and prepare your documents!</p>


`;

  return sendEmail(recipient, subject, message);
});

const informAgentEssayAssignedEmail = asyncHandler(async (recipient, msg) => {
  const thread_url = `${THREAD_URL}/${msg.thread_id}`;
  const docName = msg.program
    ? ` - ${msg.program.school} ${msg.program.program_name}${msg.program.degree} ${msg.program.semester}`
    : '';
  const subject = `${
    msg.file_type === 'Essay' ? 'Essay writer' : 'Editor'
  } assigned for ${msg.std_firstname} ${msg.std_lastname}`;
  let essay_writers = '';
  for (let i = 0; i < msg.essay_writers.length; i += 1) {
    essay_writers += `<li><b>${msg.essay_writers[i].firstname} - ${msg.essay_writers[i].lastname}</b> Email: ${msg.essay_writers[i].email}</li>`;
  }
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>The following ${
    msg.file_type === 'Essay' ? 'Essay writer' : 'Editor'
  } for <a href="${thread_url}">${msg.file_type}${docName}</a>

are assigned to student ${msg.std_firstname} ${msg.std_lastname}!</p>

<p>${essay_writers}</p>

<p>Please go to <a href="${CVMLRL_CENTER_URL}">Application Document Editing Center</a> , and check if the ${
    msg.file_type
  } task is assigned correctly!</p>


`;

  return sendEmail(recipient, subject, message);
});

const informAgentStudentAssignedEmail = asyncHandler(async (recipient, msg) => {
  const subject = `Editor assigned for ${msg.std_firstname} ${msg.std_lastname}`;
  let editors = '';
  for (let i = 0; i < msg.editors.length; i += 1) {
    editors += `<li><b>${msg.editors[i].firstname} - ${msg.editors[i].lastname}</b> Email: ${msg.editors[i].email}</li>`;
  }
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>The following editors are assigned to student ${msg.std_firstname} ${
    msg.std_lastname
  }!</p>

<p>${editors}</p>

<p>Please go to <a href="${CVMLRL_FOR_EDITOR_URL(
    msg.std_id
  )}">TaiGer Portal</a> , and check if the CV task is created and say hello to your student!</p>


`;

  return sendEmail(recipient, subject, message);
});

const informEssayWriterNewEssayEmail = asyncHandler(async (recipient, msg) => {
  const thread_url = `${THREAD_URL}/${msg.thread_id}`;
  const docName = msg.program
    ? ` - ${msg.program.school} - ${msg.program.program_name} - ${msg.program.degree} - ${msg.program.semester}`
    : '';
  const subject = `New ${msg.file_type}${docName} assigned to you`;
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p><a href="${thread_url}">${msg.file_type}${docName} for ${msg.std_firstname} ${msg.std_lastname}</a> -  will be assigned to you!</p>

<p>Please go to
<a href="${CVMLRL_CENTER_URL}">Application Document Editing Center</a> in TaiGer Portal
 , and check if the ${msg.file_type} task is created and say hello to your student!</p>


`;

  return sendEmail(recipient, subject, message);
});

const informEditorNewStudentEmail = asyncHandler(async (recipient, msg) => {
  const subject = `New student ${msg.std_firstname} ${msg.std_lastname} assigned to you`;
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.std_firstname} ${msg.std_lastname} will be your student!</p>

<p>Please go to
<a href="${CVMLRL_FOR_EDITOR_URL(msg.std_id)}">TaiGer Portal</a>
 , and check if the CV task is created and say hello to your student!</p>


`;

  return sendEmail(recipient, subject, message);
});

const informEditorArchivedStudentEmail = asyncHandler(
  async (recipient, msg) => {
    const subject = `[Close] Student ${msg.std_firstname} ${msg.std_lastname} is close.`;
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.std_firstname} ${msg.std_lastname} is closed! No further tasks needed for the student.</p>

<p>Please go to ${ARCHIVED_STUDENTS_URL} , and see the archived student!</p>

`;

    return sendEmail(recipient, subject, message);
  }
);

const informStudentArchivedStudentEmail = asyncHandler(
  async (recipient, payload) => {
    const subject = `[${recipient.firstname} ${recipient.lastname}] TaiGer Portal service ends`;
    let agent = '';
    for (let i = 0; i < payload.student.agents.length; i += 1) {
      if (i === 0) {
        agent = `<li>${payload.student.agents[i].firstname} - ${payload.student.agents[i].lastname} Email: ${payload.student.agents[i].email}</li>`;
      } else {
        agent += `<li>${payload.student.agents[i].firstname} ${payload.student.agents[i].lastname} Email: ${payload.student.agents[i].email}</li>`;
      }
    }
    const message = `\
<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>您在 TaiGer Portal 上的服務已結束。</p>

<p>感謝您的使用。祝您在未來在求學的路上一帆風順。</p>

<p>之後有任何問題，請聯絡您的Agent ${agent}</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>Your service in TaiGer Portal is closed! </p>

<p>Thank you! We wish you success in your future endeavors</p>

<p>For any further questions, please contact you agent ${agent}</p>

`;

    return sendEmail(recipient, subject, message);
  }
);

const informStudentTheirEssayWriterEmail = asyncHandler(
  async (recipient, msg) => {
    const thread_url = `${THREAD_URL}/${msg.thread_id}`;
    const docName = msg.program
      ? ` - ${msg.program.school} - ${msg.program.program_name} - ${msg.program.degree} - ${msg.program.semester}`
      : '';
    const subject = `Your ${
      msg.file_type === 'Essay' ? 'Essay Writer' : 'Editor'
    } for your ${msg.file_type}${docName}`;
    let editor;
    for (let i = 0; i < msg.editors.length; i += 1) {
      const editor_name = `${msg.editors[i].firstname} ${msg.editors[i].lastname}`;
      if (i === 0) {
        editor = `${editor_name}`;
      } else {
        editor += `, ${editor_name}`;
      }
    }
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>從現在開始我們的專業外籍${
      msg.file_type === 'Essay' ? '論文' : ''
    }編輯 ${editor} 會正式開始幫你修改及潤飾 ${msg.file_type}${docName}。</p>

<p>若有任何疑問請直接與 ${editor} 在該文件 <a href="${thread_url}">${
      msg.file_type
    } - ${docName}</a> 的討論串做溝通。</p>

<p>如果有任何的技術上問題，請詢問您的顧問作協助。</p>

<p>在 Portal 的文件修改討論串，請用<b>英文</b>溝通。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>Let me introduce our professional ${
      msg.file_type === 'Essay' ? 'Essay Writer' : 'Editor'
    } ${editor}. From now on, ${editor} will be fully responsible for editing your ${
      msg.file_type
    } - ${docName}.</p>

<p>Please directly provide your feedback to ${editor} in the document thread in the <a href="${thread_url}">${
      msg.file_type
    } - ${docName}</a>. </p>

<p>If you have any technical problems, please ask your agent for help.</p>

<p>In each Portal's Application Document Editing Center document discussion thread, please use <b>English</b> to provide your feedback with your ${
      msg.file_type === 'Essay' ? 'Essay Writer' : 'Editor'
    }.</p>



`;

    return sendEmail(recipient, subject, message);
  }
);

const informStudentTheirEditorEmail = asyncHandler(async (recipient, msg) => {
  const subject = 'Your Editor';
  let editor;
  for (let i = 0; i < msg.editors.length; i += 1) {
    const editor_name = `${msg.editors[i].firstname} ${msg.editors[i].lastname}`;
    if (i === 0) {
      editor = `${editor_name}`;
    } else {
      editor += `, ${editor_name}`;
    }
  }
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>從現在開始我們的外籍顧問 ${editor} 會正式開始幫你修改、潤飾申請資料，並且全權負責申請資料(動機信、推薦信、個人履歷)的製作。</p>

<p>若有任何疑問請直接與 ${editor} 在每個修改文件 <a href="${CVMLRL_CENTER_URL}">Application Document Editing Center</a> 的討論串做溝通。</p>

<p>如果有任何的技術上問題，請詢問您的顧問作協助。</p>

<p>在 Portal 的文件修改討論串，請用<b>英文</b>溝通。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>Let me introduce our professional Editor ${editor}. From now on, ${editor} will be fully responsible for editing your application documents (CV, Motivation letters, Recommendation Letters).</p>

<p>Please directly provide your feedback to ${editor} in each documents discussion threads in the <a href="${CVMLRL_CENTER_URL}">Application Document Editing Center</a>. </p>

<p>If you have any technical problems, please ask your agent for help.</p>

<p>In each TaiGer Portal's Application Document Editing Center document discussion thread, please use <b>English</b> to provide your feedback with your edtior.</p>



`;

  return sendEmail(recipient, subject, message);
});

const createApplicationToStudentEmail = asyncHandler(async (recipient, msg) => {
  const subject =
    '[Action Required] 新的建議申請學程指派給您 / New Programs assigned to you.';
  let programList;
  for (let i = 0; i < msg.programs.length; i += 1) {
    const program_name = `${msg.programs[i].school} - ${msg.programs[i].program_name}`;
    if (i === 0) {
      programList = `<ul><li>${program_name}</li>
      `;
    } else {
      programList += `<li>${program_name}</li>`;
    }
  }
  programList += '</ul>';
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.agent_firstname} ${msg.agent_lastname} 顧問指派建議的學校學程給您：</p>

${programList}

<p>請至 <a href="${STUDENT_APPLICATION_URL}">Student Applications</a> 查看細節並選擇是否決定要申請 (Decided: Yes / No)。</p>

<a href="${STUDENT_APPLICATION_URL}" class="mui-button" target="_blank">前往決定</a>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.agent_firstname} ${msg.agent_lastname} has assigned programs for you:</p>

${programList}

<p>Please go to <a href="${STUDENT_APPLICATION_URL}">Student Applications</a> and mark it as decided if these programs look good to you.</p>

<a href="${STUDENT_APPLICATION_URL}" class="mui-button" target="_blank">To Decide</a>


`;

  return sendEmail(recipient, subject, message);
});

const updateCredentialsEmail = asyncHandler(async (recipient, msg) => {
  const subject =
    'TaiGer Portal 密碼更新成功 / TaiGer Portal passwords updated successfully';
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>您已成功更新您的 TaiGer Portal 密碼。</p>

<p>請使用您的新密碼登入 TaiGer Portal： <a href="${ORIGIN}">TaiGer portal</a> </p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>You have updated your passwords successfully!</p>

<p>Please make sure you can login in <a href="${ORIGIN}">TaiGer portal</a> </p>


`; // should be for admin/editor/agent/student

  return sendEmail(recipient, subject, message);
});

const UpdateStudentApplicationsEmail = asyncHandler(async (recipient, msg) => {
  const subject = `[Info] ${msg.sender_firstname} ${msg.sender_lastname} 更新了申請學校資訊並完成任務 / ${msg.sender_firstname} ${msg.sender_lastname} has updated application status and created new tasks`;
  let applications_name = '';
  for (let i = 0; i < msg.student_applications.length; i += 1) {
    const program_name = `${msg.student_applications[i].programId.school} ${msg.student_applications[i].programId.program_name}`;
    if (msg.new_app_decided_idx.includes(i)) {
      if (i === 0) {
        applications_name = `<ul><li>${program_name}</li>`;
      } else {
        applications_name += `<li>${program_name}</li>`;
      }
    }
  }
  if (applications_name === '') {
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.sender_firstname} ${msg.sender_lastname} 更新了是否申請的學程狀態。</p>

<a href="${STUDENT_APPLICATION_STUDENT_URL(
      msg.student._id.toString()
    )}" class="mui-button" target="_blank">查看細節</a>

<p>並且到 <a href="${CVMLRL_CENTER_URL}">Application Document Editing Center</a> 查看對於上述申請學程的新指派的文件任務細節。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.sender_firstname} ${
      msg.sender_lastname
    } has updated or declined some applications.</p>

<a href="${STUDENT_APPLICATION_STUDENT_URL(
      msg.student._id.toString()
    )}" class="mui-button" target="_blank">See details</a>

<p>Also go to <a href="${CVMLRL_CENTER_URL}">Application Document Editing Center</a> and see the new assigned tasks details for the applications above.</p>


`; // should be for admin/editor/agent/student

    return sendEmail(recipient, subject, message);
  }

  applications_name += '</ul>';
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.sender_firstname} ${msg.sender_lastname} 更新了您以下學程的申請狀態：</p>

${applications_name}

<p>請至 <a href="${STUDENT_APPLICATION_URL}">Student Applications</a> 並查看細節。</p>

並且到 <a href="${CVMLRL_CENTER_URL}">Application Document Editing Center</a> 查看對於上述申請學程的新指派的文件任務細節。

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.sender_firstname} ${msg.sender_lastname} has updated applications </p>

${applications_name}

<p>status.</p>

<p>Please go to <a href="${STUDENT_APPLICATION_URL}">Student Applications</a> and see details.</p>

<p>Also go to <a href="${CVMLRL_CENTER_URL}">Application Document Editing Center</a> and see the new assigned tasks details for the applications above.</p>


`; // should be for admin/editor/agent/student

  return sendEmail(recipient, subject, message);
});

// For Editor. English only
const NewMLRLEssayTasksEmail = asyncHandler(async (recipient, msg) => {
  const subject = `${msg.sender_firstname} ${msg.sender_lastname} has updated application status and new tasks`;
  let applications_name = '';
  for (let i = 0; i < msg.student_applications.length; i += 1) {
    const program_name = `${msg.student_applications[i].programId.school} ${msg.student_applications[i].programId.program_name}`;
    if (msg.new_app_decided_idx.includes(i)) {
      if (i === 0) {
        applications_name = `<ul><li>${program_name}</li>`;
      } else {
        applications_name += `<li>${program_name}</li>`;
      }
    }
  }
  if (applications_name !== '') {
    applications_name += '</ul>';
  }

  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.sender_firstname} ${msg.sender_lastname} has decided applications </p>

${applications_name}. 

<p>The relavant documents tasks are now assigned to you.</p>

<p>Please go to <a href="${CVMLRL_CENTER_URL}">Application Document Editing Center</a> and see the new assigned tasks details for the applications above.</p>


`; // should be for admin/editor/agent/student

  return sendEmail(recipient, subject, message);
});

// For editor, english only
const NewMLRLEssayTasksEmailFromTaiGer = asyncHandler(
  async (recipient, msg) => {
    const subject = `${msg.sender_firstname} ${msg.sender_lastname} has updated application status and new tasks`;
    let applications_name = '';
    for (let i = 0; i < msg.student_applications.length; i += 1) {
      const program_name = `${msg.student_applications[i].programId.school} ${msg.student_applications[i].programId.program_name}`;
      if (msg.new_app_decided_idx.includes(i)) {
        if (i === 0) {
          applications_name = `<ul><li>${program_name}</li>`;
        } else {
          applications_name += `<li>${program_name}</li>`;
        }
      }
    }
    if (applications_name !== '') {
      applications_name += '</ul>';
    }

    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.sender_firstname} ${msg.sender_lastname} has decided applications </p>

${applications_name}

<p>for ${msg.student_firstname} ${msg.student_lastname}. </p>

<p>The relavant documents tasks are now assigned to you.</p>

<p>Please go to <a href="${CVMLRL_CENTER_URL}">Application Document Editing Center</a> and see the new assigned tasks details for the applications above.</p>


`; // should be for admin/editor/agent/student

    return sendEmail(recipient, subject, message);
  }
);

// For editor, agents
const AdmissionResultInformEmailToTaiGer = asyncHandler(
  async (recipient, msg) => {
    const result = msg.admission === 'O' ? 'Admission' : 'Rejection';
    const student_name = `${msg.student_firstname} ${msg.student_lastname}`;
    const applications_name = `${msg.udpatedApplication.programId.school} ${msg.udpatedApplication.programId.program_name} ${msg.udpatedApplication.programId.degree} ${msg.udpatedApplication.programId.semester}`;
    const subject = `[${result}] ${student_name} has received ${result} from ${applications_name}`;
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${student_name} has received <b>${result}</b> from ${applications_name} </p>

<p>See: <a href="${STUDENT_PROFILE_FOR_AGENT_URL(
      msg.student_id
    )}">${student_name}</a></p>

`; // should be for admin/editor/agent/student

    return sendEmail(recipient, subject, message);
  }
);

const sendNewInterviewMessageInThreadEmail = asyncHandler(
  async (recipient, msg) => {
    const interview_single_url = `${SINGLE_INTERVIEW_THREAD_URL(
      msg.interview_id
    )}`;
    const interview_name = `Interview ${msg.program.school} ${msg.program.program_name} ${msg.program.degree} ${msg.program.semester}`;
    const student_name = `${msg.student_firstname} - ${msg.student_lastname}`;
    const subject = `[Update] ${msg.writer_firstname} ${msg.writer_lastname} sent a new message > ${interview_name}!`;
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.writer_firstname} ${msg.writer_lastname} 對於 </p>

<p><a href="${interview_single_url}">${student_name} - ${interview_name}</a></p>

<p>更新了訊息，於 ${msg.uploaded_updatedAt} 。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.writer_firstname} ${msg.writer_lastname} has a new update for </p>

<p><a href="${interview_single_url}">${student_name} - ${interview_name}</a></p>

<p>on ${msg.uploaded_updatedAt}.</p>

`;

    sendEmail(recipient, subject, message);
  }
);

const sendNewApplicationMessageInThreadEmail = asyncHandler(
  async (recipient, msg) => {
    const thread_url = `${THREAD_URL}/${msg.thread_id}`;
    const student_name = `${msg.student_firstname} - ${msg.student_lastname}`;
    const task_name = `${msg.school} ${msg.program_name} ${msg.uploaded_documentname}`;
    const subject = `[Update] ${msg.writer_firstname} ${msg.writer_lastname} sent a new message > ${task_name}!`;
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.writer_firstname} ${
      msg.writer_lastname
    } 對於 <a href="${thread_url}">${student_name} ${task_name}</a> 更新了訊息，於 ${
      msg.uploaded_updatedAt
    } 。</p>

<a href="${`${thread_url}`}" class="mui-button" target="_blank">查看訊息</a>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.writer_firstname} ${
      msg.writer_lastname
    } has a new update for <a href="${thread_url}">${student_name} ${task_name}</a> on ${
      msg.uploaded_updatedAt
    }.</p>

<a href="${`${thread_url}`}" class="mui-button" target="_blank">View Message</a>

`;

    sendEmail(recipient, subject, message);
  }
);

const sendNewGeneraldocMessageInThreadEmail = asyncHandler(
  async (recipient, msg) => {
    const thread_url = `${THREAD_URL}/${msg.thread_id}`;
    const student_name = `${msg.student_firstname} - ${msg.student_lastname}`;
    const subject = `[Update] ${msg.writer_firstname} ${msg.writer_lastname} provides a new message > ${student_name} ${msg.uploaded_documentname}!`;
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.writer_firstname} ${msg.writer_lastname} 給了一則新訊息： </p>

<a href="${thread_url}">${student_name}  - ${msg.uploaded_documentname}</a>

<p>於 ${msg.uploaded_updatedAt}。</p>

<a href="${thread_url}" class="mui-button" target="_blank">查看訊息</a>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.writer_firstname} ${msg.writer_lastname} has a new update for </p>

<a href="${thread_url}">${student_name}  - ${msg.uploaded_documentname}</a>

<p>on ${msg.uploaded_updatedAt}.</p>

<a href="${thread_url}" class="mui-button" target="_blank">View Message</a>


`;

    sendEmail(recipient, subject, message);
  }
);

const sendSetAsFinalGeneralFileForAgentEmail = asyncHandler(
  async (recipient, msg) => {
    const student_name = `${msg.student_firstname} ${msg.student_lastname}`;
    const threadUrl = `${THREAD_ID_URL(msg.thread_id)}`;
    if (msg.isFinalVersion) {
      const subject = `[Close] ${student_name} ${msg.uploaded_documentname} 已完成 / ${student_name} ${msg.uploaded_documentname} is finished!`;
      const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.editor_firstname} ${msg.editor_lastname} 對於學生 ${student_name} 已標示 ${msg.uploaded_documentname} 為完成，

於 ${msg.uploaded_updatedAt}. </p>

<p>此文件已可以拿來作申請使用。 </p>

<p>請至 <a href="${threadUrl}">${student_name} ${msg.uploaded_documentname}</a> 查看細節</p>

<p>如果您有任何問題，請聯絡您的文件編輯 Editor。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.editor_firstname} ${msg.editor_lastname} have finalized ${msg.uploaded_documentname} </p>

<p>for student ${student_name} </p>

<p>on ${msg.uploaded_updatedAt}.</p>

<p>This document is ready for the application. </p>

<p>Please go to <a href="${threadUrl}">${student_name} ${msg.uploaded_documentname}</a> for more details.</p>

<p>If you have any question, feel free to contact your editor.</p>


`;

      sendEmail(recipient, subject, message);
    } else {
      const subject = `[Reopen] ${student_name} ${msg.uploaded_documentname} 未完成 / ${student_name} ${msg.uploaded_documentname} is not finished!`;
      const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

${msg.editor_firstname} ${msg.editor_lastname} 標示 ${msg.uploaded_documentname} 

為未完成。

<p>請至 <a href="${threadUrl}">${student_name} ${msg.uploaded_documentname}</a> 查看細節。</p>

<p>如果您有任何問題，請聯絡您的文件編輯 Editor 或顧問。</p>

<br />

<p>${SPLIT_LINE}</p>
  
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.editor_firstname} ${msg.editor_lastname} set ${msg.uploaded_documentname} 

as not finished.</p>

<p>Please go to <a href="${threadUrl}">${student_name} ${msg.uploaded_documentname}</a> for more details.</p>

<p>If you have any question, feel free to contact your editor.</p>


`;

      sendEmail(recipient, subject, message);
    }
  }
);

const sendSetAsFinalGeneralFileForStudentEmail = asyncHandler(
  async (recipient, msg) => {
    const student_name = `${recipient.firstname} ${recipient.lastname}`;
    const threadUrl = `${THREAD_ID_URL(msg.thread_id)}`;
    if (msg.isFinalVersion) {
      const subject = `[Closed] 您的文件 ${msg.uploaded_documentname} 已完成 / Your document ${msg.uploaded_documentname} is finished!`;
      const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${student_name},</p>

<p>${msg.editor_firstname} ${msg.editor_lastname} 將 ${
        msg.uploaded_documentname
      } 列為已完成

於 ${msg.uploaded_updatedAt} 。</p>

<p>此文件已可以拿來作申請使用。 </p>

<a href="${`${threadUrl}`}" class="mui-button" target="_blank">查看細節</a>


<p>如果您有任何問題，請聯絡您的文件編輯 Editor。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${student_name},</p>

<p>your editor ${msg.editor_firstname} ${
        msg.editor_lastname
      } have finalized <a href="${threadUrl}">${msg.uploaded_documentname}</a> 

on ${msg.uploaded_updatedAt} for you.</p>

<p>This document is ready for the application. </p>

<a href="${`${threadUrl}`}" class="mui-button" target="_blank">See details</a>

<p>If you have any question, feel free to contact your editor.</p>


`;

      sendEmail(recipient, subject, message);
    } else {
      const subject = `[Reopen] 您的文件 ${msg.uploaded_documentname} 未完成 / Your document ${msg.uploaded_documentname} is not finished!`;
      const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${student_name},</p>

<p>${msg.editor_firstname} ${msg.editor_lastname} 標記 <a href="${threadUrl}">${
        msg.uploaded_documentname
      }</a> 為未完成。 </p>

<a href="${`${threadUrl}`}" class="mui-button" target="_blank">查看細節</a>

<p>如果您有任何問題，請聯絡您的文件編輯 Editor。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${student_name},</p>

<p>${msg.editor_firstname} ${msg.editor_lastname} set <a href="${threadUrl}">${
        msg.uploaded_documentname
      }</a> as not finished.</p>

<a href="${`${threadUrl}`}" class="mui-button" target="_blank">See details</a>

<p>If you have any question, feel free to contact your editor.</p>


`;

      sendEmail(recipient, subject, message);
    }
  }
);

const sendSetAsFinalProgramSpecificFileForStudentEmail = asyncHandler(
  async (recipient, msg) => {
    const thread_name = `${msg.school} - ${msg.program_name} ${msg.uploaded_documentname}`;
    if (msg.isFinalVersion) {
      const subject = `[Closed] 您的文件 ${msg.uploaded_documentname} 已完成 / Your document ${msg.uploaded_documentname} is finished!`;
      const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.editor_firstname} ${msg.editor_lastname} 已完成</p>

<p><a href="${`${THREAD_URL}/${msg.thread_id}`}">${thread_name}</a> 於 ${
        msg.uploaded_updatedAt
      } </p>

<p>此份最終文件可以拿來作為申請。 </p>

<a href="${`${THREAD_URL}/${msg.thread_id}`}" class="mui-button" target="_blank">查看討論串</a>

<p>如果您有任何問題，請聯絡您的文件編輯 Editor。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.editor_firstname} ${msg.editor_lastname} have finalized

<a href="${`${THREAD_URL}/${msg.thread_id}`}">${thread_name}</a>

on ${msg.uploaded_updatedAt} for you.</p>

This document is ready for the application. 

<a href="${`${THREAD_URL}/${msg.thread_id}`}" class="mui-button" target="_blank">Check thread</a>

<p>If you have any question, feel free to contact your editor.</p>


`;

      sendEmail(recipient, subject, message);
    } else {
      const subject = `[Reopen] 您的文件 ${msg.uploaded_documentname} 未完成 / Your document ${msg.uploaded_documentname} is not finished!`;
      const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.editor_firstname} ${msg.editor_lastname} 將

<a href="${`${THREAD_URL}/${msg.thread_id}`}">${thread_name}</a>

設為未完成。</p>

<a href="${`${THREAD_URL}/${msg.thread_id}`}" class="mui-button" target="_blank">查看討論串</a>

<p>如果您有任何問題，請聯絡您的文件編輯 Editor。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>your editor ${msg.editor_firstname} ${msg.editor_lastname} set

<a href="${`${THREAD_URL}/${msg.thread_id}`}">${thread_name}</a>

as not finished.</p>

<a href="${`${THREAD_URL}/${msg.thread_id}`}" class="mui-button" target="_blank">Check thread</a>

<p>If you have any question, feel free to contact your editor.</p>


`;

      sendEmail(recipient, subject, message);
    }
  }
);

const sendSetAsFinalProgramSpecificFileForAgentEmail = asyncHandler(
  async (recipient, msg) => {
    const doc_name = `${msg.school} - ${msg.program_name} ${msg.uploaded_documentname}`;
    const student_name = `${msg.student_firstname} ${msg.student_lastname}`;
    if (msg.isFinalVersion) {
      const subject = `[Closed] ${msg.uploaded_documentname} of ${msg.school} - ${msg.program_name} ${student_name} is finished!`;
      const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.editor_firstname} ${msg.editor_lastname} 已完成

${doc_name} 於 ${msg.uploaded_updatedAt} 

給學生 ${student_name}.</p>

<p>請再次確認此文件，並確認是否可以結案此申請. </p>

<p>請至 <a href="${`${THREAD_URL}/${msg.thread_id}`}">${msg.school} - ${
        msg.program_name
      } ${msg.uploaded_documentname}</a>  查看細節。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.editor_firstname} ${msg.editor_lastname} has finalized

${doc_name} on ${msg.uploaded_updatedAt} 

for ${student_name}.</p>

<p>Double check this document and finalize the application if applicable. </p>

<p>Please go to <a href="${`${THREAD_URL}/${msg.thread_id}`}">${msg.school} - ${
        msg.program_name
      } ${msg.uploaded_documentname}</a> for more details.</p>


`;

      sendEmail(recipient, subject, message);
    } else {
      const subject = `[Reopen] ${msg.uploaded_documentname} of ${msg.school} - ${msg.program_name} ${student_name} is reopen!`;
      const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.editor_firstname} ${msg.editor_lastname} 設

${doc_name} 為未完成於 ${msg.uploaded_updatedAt} 

給學生 ${student_name}.</p>

<p>請再次確認此文件，並確認是否可以結案此申請. </p>

<a href="${`${THREAD_URL}/${msg.thread_id}`}" class="mui-button" target="_blank">查看細節</a>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.editor_firstname} ${msg.editor_lastname} set

<a href="${`${THREAD_URL}/${msg.thread_id}`}">${doc_name}</a> as not finished on ${
        msg.uploaded_updatedAt
      } for ${student_name}.</p>

<p>Double check this document and finalize the application if applicable. </p>

<a href="${`${THREAD_URL}/${msg.thread_id}`}" class="mui-button" target="_blank">Check details</a>

`;

      sendEmail(recipient, subject, message);
    }
  }
);

// For editor lead, english only
const assignEssayTaskToEditorEmail = asyncHandler(async (recipient, msg) => {
  const subject = `[TODO] Assign Essay Writer to ${msg.student_firstname} ${msg.student_lastname} ${msg.program_name}`;
  const THREAD_LINK = new URL(`/document-modification/${msg.thread_id}`, ORIGIN)
    .href;
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>The Essay ${msg.program_name} is created to ${msg.student_firstname} ${msg.student_lastname},</p>

<p>but this Essay does <b>not</b> have any Essay Writer yet.</p>

<p><b>Please assign an Essay Writer to the Essay <a href="${THREAD_LINK}">${msg.student_firstname} ${msg.student_lastname} - ${msg.program_name}</a></b></p>

<a href="${THREAD_LINK}" class="mui-button" target="_blank">Assign Essay Writer</a>

<p>If you have any question, feel free to contact your agent.</p>


`;

  sendEmail(recipient, subject, message);
});

// For editor, english only
const assignDocumentTaskToEditorEmail = asyncHandler(async (recipient, msg) => {
  const subject = `[New Task] ${msg.student_firstname} ${msg.student_lastname} ${msg.documentname} is assigned to you!`;
  const THREAD_LINK = new URL(`/document-modification/${msg.thread_id}`, ORIGIN)
    .href;
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

${msg.student_firstname} ${msg.student_lastname} -  ${msg.documentname},

<p>is assigned to you </p>

<p>on ${msg.updatedAt}.</p>

<p>Please go to TaiGer Portal ${THREAD_LINK} and check the updates. </p>

<p>If you have any question, feel free to contact your editor.</p>


`;

  sendEmail(recipient, subject, message);
});

// TODO: kick-off email，請填寫 template
const assignDocumentTaskToStudentEmail = asyncHandler(
  async (recipient, msg) => {
    const subject = `[新任務] ${recipient.firstname} ${recipient.lastname} ${msg.documentname} 指派給你 / [New Task] ${recipient.firstname} ${recipient.lastname} ${msg.documentname} is assigned to you!`;
    const THREAD_LINK = new URL(
      `/document-modification/${msg.thread_id}`,
      ORIGIN
    ).href;

    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>以下文件任務</p>

<p>${msg.documentname},

於 ${msg.updatedAt} 指派給你。</p>

<p>請至 TaiGer Template 下載中心 <a href="${TEMPLATE_DOWNLOAD_URL}">TaiGer Portal Download</a> 下載模板。</p>

<p>填寫好後並到 TaiGer Portal ${THREAD_LINK} 上傳填完的模板，讓您的 Editor 可以盡快開始修改您的文件。</p> 

<p>如果您有任何問題，請聯絡您的文件編輯 Editor 或顧問。</p>

<br />
<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${msg.documentname},

is assigned to you 

on ${msg.updatedAt}.</p>

<p>Please go to <a href="${TEMPLATE_DOWNLOAD_URL}">TaiGer Portal Download</a> to download relavant template。</p>

<p>Fill the template and go to TaiGer Portal ${THREAD_LINK} and upate your filled template for editor's modification. </p>

<p>If you have any question, feel free to contact your editor.</p>


`;

    sendEmail(recipient, subject, message);
  }
);

const AnalysedCoursesDataStudentEmail = asyncHandler(async (recipient, msg) => {
  const subject = '課程匹配度分析成功 / Course data analysed successfully';
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>您的的課程匹配度已分析。</p>

<p>請至 <a href="${STUDENT_ANALYSED_COURSE_URL(
    msg.student_id
  )}">Courses</a> 查看細節。</p>

                  <p>
                    此份課程分析<b>僅供選課參考</b>
                    。請仔細看過每個向度所缺的課程，並對照學校之後學期是否有開期課程，抓出來，並和您的
                    Agent 討論。若您已經畢業，則當作申請學校的參考，了解學校大致要求的課程匹配度。
                  </p>
<br />
<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>Your courses data has been analysed successfully!</p>

<p>Please go to <a href="${STUDENT_ANALYSED_COURSE_URL(
    msg.student_id
  )}">Courses</a> for more details.</p>
                  <p>
                    The course analysis provided is for
                    <b>reference purposes only</b>. Please carefully review the
                    courses missing in each category and cross-reference
                    whether your university offers those courses in the upcoming
                    semesters. Once you have identified them, discuss with your
                    Agent. If you already graduate, this is only a reference.
                  </p>

`; // should be for admin/editor/agent/student

  return sendEmail(recipient, subject, message);
});

const updateCoursesDataAgentEmail = asyncHandler(async (recipient, msg) => {
  const student_name = `${msg.student_firstname} ${msg.student_lastname}`;
  const studentCourseUrl = `${STUDENT_COURSE_URL(msg.student_id)}`;
  const subject = `[TODO] 分析課程 ${student_name} | Course anaylsis for ${student_name}`;
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${student_name} 的課程資料已更新。</p>

<p>請至 <a href="${studentCourseUrl}">${student_name} Courses</a> 查看細節並<b>幫學生點選課程分析，學生可以馬上收到課程匹配度分析。</b></p>

<a href="${studentCourseUrl}" class="mui-button" target="_blank">上前分析</a>

<br />
<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${student_name} has updated his/her courses data!</p>

<p>Please go to <a href="${studentCourseUrl}">${student_name} Courses</a> for more details and <b>analyze the courses. </b> A system email will be sent to the student when you analyzed.</p>

<a href="${studentCourseUrl}" class="mui-button" target="_blank">Analyse Courses</a>

`; // should be for admin/editor/agent/student

  return sendEmail(recipient, subject, message);
});

const sendSomeReminderEmail = asyncHandler(async (recipient) => {
  const subject = 'File Status changes';
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

Some reminder email template.


`; // should be for admin/editor/agent/student

  return sendEmail(recipient, subject, message);
});

const sendAssignEditorReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const student_name = `${payload.student_firstname} - ${payload.student_lastname}`;
    const baseDocumentLink = `${BASE_DOCUMENT_FOR_AGENT_URL(
      payload.student_id
    )}`;
    const subject = '[DO NOT IGNORE] Assign Editor Reminder';
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${student_name} has uploaded some input in his/her Application Document Editing Center, <b>but she/he did not have any Editor yet.</b></p>

<p><b>Please assign an Editor to the student <a href="${baseDocumentLink}">${student_name}</a></b></p>

<a href="${baseDocumentLink}" class="mui-button" target="_blank">Assign Editor</a>

<p>${SPLIT_LINE}</p>

<p>${student_name} 上傳了一份文件至他的 CVMLRL Cetner，但他目前並無任何編輯。</p>

<p><b>請指派編輯學生 <a href="${baseDocumentLink}">${student_name}</a></b></p>

<a href="${baseDocumentLink}" class="mui-button" target="_blank">指派編輯</a>

`; // should be for admin/editor/agent/student

    return sendEmail(recipient, subject, message);
  }
);

const sendNoTrainerInterviewRequestsReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const requests = payload.interviewRequests.map(
      (request) =>
        `<li>
      <a href="${SINGLE_INTERVIEW_THREAD_URL(request._id.toString())}">${
          request.student_id.firstname
        } ${request.student_id.lastname} - ${request.program_id.school} ${
          request.program_id.program_name
        } ${request.program_id.degree} ${request.program_id.semester} ${
          request.interview_date
        }</a>
    </li>`
    );
    const subject =
      '[DO NOT IGNORE] Assign Interview Trainer to the following requests';
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>Please assign an interview trainer to the following interview training requests:</p>
${requests}

<br />
<p>${SPLIT_LINE}</p>

<p>請指派面試訓練官給下列面試訓練請求：</p>

${requests}

<br />

`; // should be for admin/editor/agent/student

    return sendEmail(recipient, subject, message);
  }
);

const sendAssignTrainerReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const program_name = `${payload.program.school} ${payload.program.program_name} ${payload.program.degree}  ${payload.program.semester}`;
    const student_name = `${payload.student_firstname} - ${payload.student_lastname}`;
    const interviewUrl = `${SINGLE_INTERVIEW_THREAD_URL(payload.interview_id)}`;
    const subject = `[DO NOT IGNORE] Assign Interview Trainer to ${student_name} - ${program_name}`;
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${student_name} has created interview training request, <b>but she/he did not have any interview trainer yet.</b></p>

<p><b>Please assign an interview trainer to the student <a href="${interviewUrl}">${student_name} ${program_name}</a></b></p>

<a href="${interviewUrl}" class="mui-button" target="_blank">Assign Trainer</a>

<br />
<p>${SPLIT_LINE}</p>

<p>${student_name} 新增了一個面試訓練請求，但他目前並無任何面試訓練官。</p>

<p><b>請指派面試訓練官給學生 <a href="${interviewUrl}">${student_name} ${program_name}</a></b></p>

<a href="${interviewUrl}" class="mui-button" target="_blank">指派面試官</a>

<br />

`; // should be for admin/editor/agent/student

    return sendEmail(recipient, subject, message);
  }
);

const sendAgentNewMessageReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const student_name = `${payload.student_firstname} - ${payload.student_lastname}`;
    const messageUrl = `${STUDENT_COMMUNICATION_THREAD_URL(
      payload.student_id
    )}`;
    const subject = `[New Message] ${student_name}`;
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p><b>${student_name} sent new message(s)</b></p>

<p><b>Please go to student's communication <a href="${messageUrl}">${student_name}</a></b></p>

<a href="${messageUrl}" class="mui-button" target="_blank">View Message</a>

<p>${SPLIT_LINE}</p>

<p>${student_name} 傳了一則新訊息。</p>

<p><b>請至學生討論串 <a href="${messageUrl}">${student_name}</a></b></p>

<a href="${messageUrl}" class="mui-button" target="_blank">查看訊息</a>

<br />

`; // should be for admin/editor/agent/student

    return sendEmail(recipient, subject, message);
  }
);

const sendStudentNewMessageReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const subject = `[New Message] ${recipient.firstname} ${recipient.lastname}`;
    const messageUrl = `${STUDENT_COMMUNICATION_THREAD_URL(
      payload.student_id
    )}`;
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p><b>${payload.taiger_user_firstname} - ${payload.taiger_user_lastname} sent you new message(s)</b></p>

<p><b>Please go to my <a href="${messageUrl}">Communication</a></b></p>

<a href="${messageUrl}" class="mui-button" target="_blank">View Message</a>

<p>${SPLIT_LINE}</p>

<p>${payload.taiger_user_firstname} - ${payload.taiger_user_lastname} 留了新訊息給你。</p>

<p><b>請至學生討論串 <a href="${messageUrl}">Communication</a></b></p>

<a href="${messageUrl}" class="mui-button" target="_blank">查看訊息</a>


<br />

`; // should be for admin/editor/agent/student

    return sendEmail(recipient, subject, message);
  }
);

const MeetingAdjustReminderEmail = asyncHandler(async (recipient, payload) => {
  const taigerUser = `${payload.taiger_user_firstname} ${payload.taiger_user_lastname}`;
  const calendarUrl = `${
    payload.role === 'Student'
      ? AGENT_CALENDAR_EVENTS_URL(recipient.id)
      : STUDENT_CALENDAR_EVENTS_URL(recipient.id)
  }`;
  const subject = `[TODO][Meeting confirmation required] ${taigerUser}`;
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p><b>${taigerUser}</b> 調整了一個討論時段： </p>
<p><b>${payload.meeting_time}</b></p>

<p>請上去 <a href="${calendarUrl}">TaiGer Meeting Calendar</a> 並<b>確認</b>討論內容和時間。</p>

<a href="${calendarUrl}" class="mui-button" target="_blank">上前確認</a>

<p>${SPLIT_LINE}</p>

<p>${taigerUser} adjusted a meeting time on:</p>

<p><b>${payload.meeting_time}</b></p>

<p>Please go to <a href="${calendarUrl}">TaiGer Meeting Calendar</a> and <b>Confirm</b> the time。</p>

<a href="${calendarUrl}" class="mui-button" target="_blank">To Confirm</a>

`; // should be for admin/editor/agent/student

  return sendEmail(recipient, subject, message);
});

const MeetingConfirmationReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const taigerUser = `${payload.taiger_user_firstname} ${payload.taiger_user_lastname}`;
    const calendarUrl = `${
      payload.role === 'Student'
        ? AGENT_CALENDAR_EVENTS_URL(recipient.id)
        : STUDENT_CALENDAR_EVENTS_URL(recipient.id)
    }`;
    const subject = `[TODO][Meeting Invitation] ${taigerUser}`;
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p><b>${taigerUser}</b> 預訂了一個討論時段。</p>

<p>請上去 <a href="${calendarUrl}">TaiGer Meeting Calendar</a> 並<b>確認</b>討論內容和時間，才能啟用 meeting 連結。</p>

<a href="${calendarUrl}" class="mui-button" target="_blank">上前確認</a>

<p>${SPLIT_LINE}</p>

<p>${taigerUser} booked a meeting time.</p>

<p>Please go to <a href="${calendarUrl}">TaiGer Meeting Calendar</a> and <b>Confirm</b> the time in order to activate the meeting link.</p>

<a href="${calendarUrl}" class="mui-button" target="_blank">To Confirm</a>


`; // should be for admin/editor/agent/student

    return sendEmail(recipient, subject, message);
  }
);

const MeetingInvitationEmail = asyncHandler(async (recipient, payload) => {
  const taigerUser = `${payload.taiger_user.firstname} - ${payload.taiger_user.lastname}`;
  const subject = `[Meeting Confirmed] The booked office hour: ${payload.meeting_time}.`;
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p><b>${taigerUser}</b> 確認了討論時段，請至 TaiGer Portal 查看您的當地 Meeting 時間。</p>

<p> 請於該時間準時點擊以下連結： </p>

<p>Jitsi Meet 會議連結網址： <a href="${payload.meeting_link}">${payload.meeting_link}</a></p>
<p>若您是第一次使用Jitsi Meet 會議，建議可以先查看使用說明： <a href="${JITSI_MEET_INSTRUCTIONS_URL}">${JITSI_MEET_INSTRUCTIONS_URL}</a></p>
<p>若需要改時間，請上去TaiGer Portal, Update 您現在預定的時段至另一個 office hour 時段。</p>

<p>${SPLIT_LINE}</p>

<p>${taigerUser} confirmed the meeting time. Please login to the TaiGer Portal and see the meeting time in your timezone.</p>

<p> Jitsi Meet Meeting link: <a href="${payload.meeting_link}">${payload.meeting_link}</a></p>
<p>If it is the first time for you to use Jitsi Meet, we recommend you having a look at our brief introduction: <a href="${JITSI_MEET_INSTRUCTIONS_URL}">${JITSI_MEET_INSTRUCTIONS_URL}</a></p>
<p>If you can not attend the meeting, please go to TaiGer Portal and Update the existing time slot to another time.</p>


`; // should be for admin/editor/agent/student

  return sendEventEmail(
    recipient,
    subject,
    message,
    payload.event,
    [payload.taiger_user], // cc
    payload.event_title,
    payload.isUpdatingEvent,
    false
  );
});

const MeetingCancelledReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const taigerUser = `${payload.taiger_user.firstname} - ${payload.taiger_user.lastname}`;
    const subject = `[Meeting Cancelled] The booked Office hour ${payload.meeting_time} is cancelled.`;
    const message = `\
<p>Hi,</p>

<p><b>${taigerUser}</b> 取消了討論時段。</p>

<p>${SPLIT_LINE}</p>

<p>${taigerUser} cancelled the meeting.</p>


`; // should be for admin/editor/agent/student

    return sendEventEmail(
      recipient,
      subject,
      message,
      payload.event,
      [payload.taiger_user], // cc
      payload.event_title,
      payload.isUpdatingEvent,
      true // toDelete event
    );
  }
);

const InterviewCancelledReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const taigerUser = `${payload.taiger_user.firstname} - ${payload.taiger_user.lastname}`;
    const subject = `[Interview Training Cancelled by ${payload.taiger_user.firstname} ${payload.taiger_user.lastname}].`;
    const message = `\
<p>Hi,</p>

<p><b>${taigerUser}</b> 取消了面試訓練。</p>

<p>${SPLIT_LINE}</p>

<p><b>${taigerUser}</b> cancelled the interview training.</p>


`; // should be for admin/editor/agent/student

    return sendEventEmail(
      recipient,
      subject,
      message,
      payload.event,
      [...payload.cc], // cc
      payload.event_title,
      payload.isUpdatingEvent,
      true // toDelete event
    );
  }
);

const MeetingReminderEmail = asyncHandler(async (recipient, payload) => {
  const subject = `[Meeting Reminder] ${recipient.firstname} ${recipient.lastname}`;
  const message = `\
[會議討論提醒]
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>
<br />
<p> 請於約定時間(時間請見 TaiGer Portal)該時間準時點擊以下連結： </p>
<p>Jitsi Meet 會議連結：</p>
<a href="${payload.event?.meetingLink}" class="mui-button" target="_blank">Meeting Link</a>

<p>若需要改時間，請上去TaiGer Portal, Update 您現在預定的時段至另一個 office hour 時段。</p>
<p>若您是第一次使用Jitsi Meet 會議，建議可以先查看使用說明： <a href="${JITSI_MEET_INSTRUCTIONS_URL}">${JITSI_MEET_INSTRUCTIONS_URL}</a></p>
<br />
<p>Jitsi Meet 是行政院數位政委唐鳳建議使用的開源軟體，許多台灣大專院校如國立陽明交通大學、國立台東大學等所採用。</p>

<p>${SPLIT_LINE}</p>
[Meeting Reminder]
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>
<br />
<p>Please attend the meeting (see TaiGer Portal for the booked time slot) with the following link： </p>
<p>If you can not attend the meeting, please go to TaiGer Portal and Update the existing time slot to another time.</p>
<p> Jitsi Meet Meeting link:</p>
<a href="${payload.event?.meetingLink}" class="mui-button" target="_blank">Meeting Link</a>

<br />
<p>Jitsi Meet is an open-source software recommended for use by Tang Feng, the Digital Minister of the Executive Yuan. It is adopted by many Taiwanese universities such as National Yang Ming Chiao Tung University and National Taitung University.</p>


`; // should be for admin/editor/agent/student

  return sendEmail(recipient, subject, message);
});

const UnconfirmedMeetingReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const calendarUrl = `${
      payload.role === 'Student'
        ? STUDENT_CALENDAR_EVENTS_URL(payload.id)
        : AGENT_CALENDAR_EVENTS_URL(payload.id)
    }`;
    const subject = `[TODO now] Meeting to confirm reminder ${recipient.firstname} ${recipient.lastname}`;
    const message = `\
[會議時間確認提醒]
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>
<p> 您有一個尚未確認的討論時段與 ${payload.firstname} ${payload.lastname}</p>
<p> 請上去 <a href="${calendarUrl}">TaiGer Meeting Calendar</a> 確認討論時段是否可以</p>
<a href="${calendarUrl}" class="mui-button" target="_blank">前往確認</a>

<p>若需要改時間，請上去 <a href="${calendarUrl}">TaiGer Meeting Calendar</a> Update 您現在預定的時段至另一個您可以的 office hour 時段。</p>

<p>${SPLIT_LINE}</p>
[Meeting Reminder]
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>
<p>You have an unconfirmed meeting slot with ${payload.firstname} ${payload.lastname} </p>
<p>Please go to <a href="${calendarUrl}">TaiGer Meeting Calendar</a> to <b>confirm</b> the meeting time slot.</p>
<a href="${calendarUrl}" class="mui-button" target="_blank">To Confirm</a>

<p>If you can not attend the meeting, please go to <a href="${calendarUrl}">TaiGer Meeting Calendar</a> and Update the existing time slot to another time available for you.</p>


`; // should be for admin/editor/agent/student

    return sendEmail(recipient, subject, message);
  }
);

const TicketCreatedAgentEmail = asyncHandler(async (recipient, payload) => {
  const programName = `${payload.program.school}-${payload.program.program_name}`;
  const student_name = `${payload.student.firstname} ${payload.student.lastname}`;
  const subject = `[TODO] Update request for ${programName} by ${student_name}`;
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p><b>${student_name}</b> 提供了一個 program ${programName} Feedback. 請上前查看 <a href="${PROGRAM_URL(
    payload.program._id.toString()
  )}">Ticket</a> 並 Close ticket。 </p>

<p>${SPLIT_LINE}</p>

<p>${student_name} provided a feedback for their program  ${programName}. 

Please check the <a href="${PROGRAM_URL(
    payload.program._id.toString()
  )}">Ticket</a> and resolve the ticket. </p>

`;

  return sendEmail(recipient, subject, message);
});

const TicketResolvedRequesterReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const programName = `${payload.program.school} - ${payload.program.program_name} - ${payload.program.degree} - ${payload.program.semester}`;
    const taiger_user_name = `${payload.taigerUser.firstname} ${payload.taigerUser.lastname}`;
    const subject = `[Close] Program Update Request for ${programName} by ${taiger_user_name}`;
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p><b>${taiger_user_name}</b> 更新並解決了 program ${programName} Feedback. 請上前查看 <a href="${PROGRAM_URL(
      payload.program._id.toString()
    )}">Ticket</a> 。 </p>

<p>${SPLIT_LINE}</p>

<p>${taiger_user_name} updated and resolved the feedback for the program  ${programName}. 

Please check the <a href="${PROGRAM_URL(
      payload.program._id.toString()
    )}">Ticket</a> and see the ticket. </p>

`;

    return sendEmail(recipient, subject, message);
  }
);

const TicketResolvedStudentEmail = asyncHandler(async (recipient, payload) => {
  const programName = `${payload.program.school}-${payload.program.program_name}`;
  const student_name = `${payload.student.firstname} ${payload.student.lastname}`;
  const subject = `[Resolved] Request for ${programName} by ${student_name}`;
  const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p><b>${payload.agent.firstname} - ${
    payload.agent.lastname
  }</b> 解決了 ${programName} <a href="${PROGRAM_URL(
    payload.program._id.toString()
  )}">Ticket</a> 並 Close ticket。 </p>

<p>${SPLIT_LINE}</p>

<p>${payload.agent.firstname} - ${
    payload.agent.lastname
  } provided a feedback for their program  ${programName}. 

Please check the <a href="${PROGRAM_URL(
    payload.program._id.toString()
  )}">Ticket</a> and resolve the ticket. </p>

`;

  return sendEmail(recipient, subject, message);
});

const sendAssignEssayWriterReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const student_name = `${payload.student_firstname} - ${payload.student_lastname}`;
    const subject = '[DO NOT IGNORE] Assign Essay Writer Reminder';
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${student_name} has uploaded Essay his/her Application Document Editing Center, <b>but she/he did not have any Essay Writer yet.</b></p>

<p><b>Please assign an Essay Writer to the student <a href="${BASE_DOCUMENT_FOR_AGENT_URL(
      payload.student_id
    )}">${student_name}</a></b></p>

<br />
<p>${SPLIT_LINE}</p>

<p>${student_name} 上傳了一份Essay至他的 CVMLRL Cetner，但他目前並無任何Essay Writer。</p>

<p><b>請指派 Essay Writer 給學生 <a href="${BASE_DOCUMENT_FOR_AGENT_URL(
      payload.student_id
    )}">${student_name}</a></b></p>
<br />

`; // should be for admin/editor/agent/student

    return sendEmail(recipient, subject, message);
  }
);

const sendAssignedInterviewTrainerToTrainerEmail = asyncHandler(
  async (recipient, payload) => {
    const program = `${payload.interview.program_id.school} ${payload.interview.program_id.program_name} ${payload.interview.program_id.degree} ${payload.interview.program_id.semester}`;
    const student_name = `${payload.interview.student_id.firstname} ${payload.interview.student_id.lastname}`;
    const training_request = `${student_name} - ${program}`;
    const subject = `Interview Training Request assigned to you for ${training_request}`;

    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>The following interview training request is assigned to you!</p>

<p><b>${training_request}</b></p>

<p>Please go to <a href="${SINGLE_INTERVIEW_THREAD_URL(
      payload.interview._id.toString()
    )}">${training_request}</a></p> 
<p>and check the interview requirements and <b>arrange interview training date</b> with your student!</p>


`;

    return sendEmail(recipient, subject, message);
  }
);

const sendAssignedInterviewTrainerToStudentEmail = asyncHandler(
  async (recipient, payload) => {
    const program = `${payload.interview.program_id.school} ${payload.interview.program_id.program_name} ${payload.interview.program_id.degree} ${payload.interview.program_id.semester}`;
    const student_name = `${payload.interview.student_id.firstname} ${payload.interview.student_id.lastname}`;
    const training_request = `${student_name} - ${program}`;
    const subject = `[Info] Interview Trainer assigned for ${training_request}`;
    let trainers = '';
    for (let i = 0; i < payload.interview.trainer_id?.length; i += 1) {
      trainers += `<li><b>${payload.interview.trainer_id[i].firstname} - ${payload.interview.trainer_id[i].lastname}</b> Email: ${payload.interview.trainer_id[i].email}</li>`;
    }
    const message = `\
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>The following trainer are assigned to student ${student_name}!</p>

<p>${trainers}</p>

<p>Please go to <a href="${SINGLE_INTERVIEW_THREAD_URL(
      payload.interview._id.toString()
    )}">${training_request}</a></p>
<p>and <b>arrange the interview training date</b> with your interview trainer!</p>


`;

    return sendEmail(recipient, subject, message);
  }
);

const sendInterviewConfirmationEmail = asyncHandler(
  async (recipient, payload) => {
    const subject = `[Confirmed] Interview Training Time for ${payload.program.school} ${payload.program.program_name} ${payload.program.degree} ${payload.program.semester}`;
    const message = `\
<p>${ENGLISH_BELOW}</p>
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p><b>${payload.taiger_user.firstname} - ${
      payload.taiger_user.lastname
    }</b> 確認了面試訓練時段。</p>
<p>請至 TaiGer Portal 查看您的當地面試訓練時間。</p>

<p> 請於該時間準時點擊以下連結： </p>

<p>Jitsi Meet 會議連結網址：</p>
<a href="${
      payload.meeting_link
    }" class="mui-button" target="_blank">Meeting Link</a>

<p>若您是第一次使用Jitsi Meet 會議，建議可以先查看使用說明： <a href="${JITSI_MEET_INSTRUCTIONS_URL}">${JITSI_MEET_INSTRUCTIONS_URL}</a></p>
<p>若需要改時間，請上去 <a href="${SINGLE_INTERVIEW_THREAD_URL(
      payload.interview_id
    )}">面試討論串</a> 和面試訓練官更改模擬面試時間。</p>

<p>${SPLIT_LINE}</p>

<p>${payload.taiger_user.firstname} - ${
      payload.taiger_user.lastname
    } confirmed the meeting time.</p>
<p>Please login to the TaiGer Portal and see the interview training time in your timezone.</p>

<p> Jitsi Meet Meeting link</p>
<a href="${
      payload.meeting_link
    }" class="mui-button" target="_blank">Meeting Link</a>
<p>If it is the first time for you to use Jitsi Meet, we recommend you having a look at our brief introduction: <a href="${JITSI_MEET_INSTRUCTIONS_URL}">${JITSI_MEET_INSTRUCTIONS_URL}</a></p>
<p>If you can not attend the interview training, please go to <a href="${SINGLE_INTERVIEW_THREAD_URL(
      payload.interview_id
    )}">Interview Thread</a> arrange another interview training time.</p>


`;

    return sendEventEmail(
      recipient,
      subject,
      message,
      payload.event,
      [...payload.cc], // cc
      payload.event.title,
      payload.isUpdatingEvent,
      false
    );
  }
);

const sendInterviewCancelEmail = asyncHandler(async (recipient, payload) => {
  const taiger_user_name = `${payload.taiger_user.firstname} - ${payload.taiger_user.lastname}`;
  const program_name = `${payload.program.school} ${payload.program.program_name} ${payload.program.degree} ${payload.program.semester}`;
  const subject = `[Cancelled] Interview Training for ${program_name} is cancelled`;
  const message = `\
<p>${ENGLISH_BELOW}</p>
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p><b>${taiger_user_name}</b> 取消了 ${program_name} 面試訓練時段。</p>

<p>${SPLIT_LINE}</p>

<p><b>${taiger_user_name}</b> cancelled the interview training for ${program_name}.</p>

`;

  return sendEventEmail(
    recipient,
    subject,
    message,
    payload.event,
    [payload.taiger_user], // cc
    payload.event_title,
    payload.isUpdatingEvent,
    true
  );
});

const InterviewTrainingReminderEmail = asyncHandler(
  async (recipient, payload) => {
    const subject = `[Training Reminder] ${recipient.firstname} ${recipient.lastname}`;
    const message = `\
[面試訓練討論提醒]
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>
<br />
<p> 請於約定時間(時間請見 TaiGer Portal)該時間準時點擊以下連結： </p>
<p>Jitsi Meet 會議連結網址：</p>
<a href="${payload.event?.meetingLink}" class="mui-button" target="_blank">Meeting Link</a>

<p>若需要改時間，請上去 <a href="${INTERVIEW_CENTER_URL}">Interview Center</a> 和面試訓練官更改時段。</p>
<p>若您是第一次使用Jitsi Meet 會議，建議可以先查看使用說明： <a href="${JITSI_MEET_INSTRUCTIONS_URL}">${JITSI_MEET_INSTRUCTIONS_URL}</a></p>
<br />
<p>Jitsi Meet 是行政院數位政委唐鳳建議使用的開源軟體，許多台灣大專院校如國立陽明交通大學、國立台東大學等所採用。</p>

<p>${SPLIT_LINE}</p>
[Interview Training Reminder]
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>
<br />
<p>Please attend the meeting (see TaiGer Portal for the booked time slot) with the following link： </p>
<p> Jitsi Meet Meeting link:</p>
<a href="${payload.event?.meetingLink}" class="mui-button" target="_blank">Meeting Link</a>
<p>If you can not attend the meeting, please go to <a href="${INTERVIEW_CENTER_URL}">Interview Center</a> and discuss new training time.</p>
<p>If you are the first time to use Jitsi Meet, please read our instruction: <a href="${JITSI_MEET_INSTRUCTIONS_URL}">${JITSI_MEET_INSTRUCTIONS_URL}</a></p>
<br />
<p>Jitsi Meet is an open-source software recommended for use by Tang Feng, the Digital Minister of the Executive Yuan. It is adopted by many Taiwanese universities such as National Yang Ming Chiao Tung University and National Taitung University.</p>


`; // should be for admin/editor/agent/student

    return sendEmail(recipient, subject, message);
  }
);

const sendSetAsFinalInterviewEmail = asyncHandler(async (recipient, msg) => {
  const user_name = `${msg.user.firstname} ${msg.user.lastname}`;
  const student_name = `${msg.interview.student_id.firstname} ${msg.interview.student_id.lastname}`;
  const interviewUrl = `${SINGLE_INTERVIEW_THREAD_URL(
    msg.interview._id.toString()
  )}`;
  const interview_name = `Interview: ${student_name} ${msg.interview.program_id.school} ${msg.interview.program_id.program_name} ${msg.interview.program_id.degree} `;
  if (msg.isClosed) {
    const subject = `[Close] ${interview_name} is finished!`;
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${user_name} 對於面試 <b>${interview_name}</b> 為完成。</p>

<p>請至 <a href="${interviewUrl}">Interview Center</a> 查看細節</p>

<p>如果您有任何問題，請聯絡您的面試訓練官。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${user_name} have finalized the interview <b>${interview_name}</b>. </p>

<p>Please go to <a href="${interviewUrl}">Interview Center</a> for more details.</p>

<p>If you have any question, feel free to contact your interview trainer.</p>

`;

    sendEmail(recipient, subject, message);
  } else {
    const subject = `[Reopen]  ${interview_name}  is not finished!`;
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

${user_name} 標示 ${interview_name} 為未完成。

<p>請至 <a href="${interviewUrl}">Interview Center</a> 查看細節。</p>

<p>如果您有任何問題，請聯絡您的面試訓練官。</p>

<br />

<p>${SPLIT_LINE}</p>
  
<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${user_name} set ${interview_name} as not finished.</p>

<p>Please go to <a href="${interviewUrl}">Interview Center</a> for more details.</p>

<p>If you have any question, feel free to contact your interview trainer.</p>

`;

    sendEmail(recipient, subject, message);
  }
});

const InterviewSurveyRequestEmail = asyncHandler(async (recipient, msg) => {
  const student_name = `${recipient.firstname} ${recipient.lastname}`;
  const interviewSurveyUrl = `${SINGLE_INTERVIEW_SURVEY_THREAD_URL(
    msg.interview._id.toString()
  )}`;
  const interview_name = `${msg.interview.program_id.school} ${msg.interview.program_id.program_name} ${msg.interview.program_id.degree} `;
  const subject = `[TODO][Urgent] Interview Survey for ${interview_name}`;
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${student_name},</p>

<p>我們希望您的面試 <b>${interview_name}</b> 進行順利，並且我們的訓練對您有幫助！</p>

<p>為了改善我們的訓練，我們想要請你提供寶貴的回饋以及和學校面試的相關資訊給我們。請您花費2分鐘完成這份問卷，幫助我們繼續支持未來台灣的學生。</p>

<a href="${interviewSurveyUrl}" class="mui-button" target="_blank">開啟面試問卷</a>

<p>如果您有任何問題，請聯絡您的面試訓練官或顧問。</p>

<p>謝謝您的回饋，我們祝您順利錄取！</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${student_name},</p>

<p>We hope your interview for <b>${interview_name}</b> went well and that our training was helpful!</p>

<p>To improve our interview training, we would appreciate your <b>valuable feedback</b>. Please take <b>2 minutes</b> to complete this <b>short survey</b> and help us continue supporting future students from Taiwan.</p>

<a href="${interviewSurveyUrl}" class="mui-button" target="_blank">CLICK TO OPEN THE SURVEY</a>

<p>If you have any questions or feedback, feel free to contact your trainer or agent.</p>

<p>Thank you - our fingers are crossed for your admission!</p>
`;

  sendEmail(recipient, subject, message);
});

const InterviewSurveyFinishedEmail = asyncHandler(async (recipient, msg) => {
  const user_name = `${msg.user.firstname} ${msg.user.lastname}`;
  const student_name = `${msg.interview.student_id.firstname} ${msg.interview.student_id.lastname}`;
  const interviewSurveyUrl = `${SINGLE_INTERVIEW_SURVEY_THREAD_URL(
    msg.interview._id.toString()
  )}`;
  const interview_name = `${student_name} ${msg.interview.program_id.school} ${msg.interview.program_id.program_name} ${msg.interview.program_id.degree} `;
  const subject = `[Close] Interview survey finished: ${interview_name}`;
  const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>感謝您完成了面試訓練回饋問卷 <b>${interview_name}</b>。</p>

<p>請至 <a href="${interviewSurveyUrl}">Interview Center</a> 查看細節</p>

<a href="${interviewSurveyUrl}" class="mui-button" target="_blank">前往面試訓練回饋</a>

<p>如果您有任何問題，請聯絡您的面試訓練官或顧問。</p>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${user_name} have finished the interview feedback survey <b>${interview_name}</b> </p>

<a href="${interviewSurveyUrl}" class="mui-button" target="_blank">Interview Training Feedback</a>

<p>Please go to <a href="${interviewSurveyUrl}">Interview Center</a> for more details.</p>

<p>If you have any question, feel free to contact your interview trainer or agent.</p>

`;

  sendEmail(recipient, subject, message);
});

const InterviewSurveyFinishedToTaiGerEmail = asyncHandler(
  async (recipient, msg) => {
    const user_name = `${msg.user.firstname} ${msg.user.lastname}`;
    const student_name = `${msg.interview.student_id.firstname} ${msg.interview.student_id.lastname}`;
    const interviewSurveyUrl = `${SINGLE_INTERVIEW_SURVEY_THREAD_URL(
      msg.interview._id.toString()
    )}`;
    const interview_name = `${student_name} ${msg.interview.program_id.school} ${msg.interview.program_id.program_name} ${msg.interview.program_id.degree} `;
    const subject = `[Close] Interview survey finished: ${interview_name}`;
    const message = `\
<p>${ENGLISH_BELOW}</p>

<p>嗨 ${recipient.firstname} ${recipient.lastname},</p>

<p>${user_name} 完成了面試回饋問卷 <b>${interview_name}</b>。</p>

<a href="${interviewSurveyUrl}" class="mui-button" target="_blank">查看面試訓練問卷</a>

<br />

<p>${SPLIT_LINE}</p>

<p>Hi ${recipient.firstname} ${recipient.lastname},</p>

<p>${user_name} has finished the interview feedback survey for <b>${interview_name}</b> </p>

<a href="${interviewSurveyUrl}" class="mui-button" target="_blank">See Feedback</a>

`;

    sendEmail(recipient, subject, message);
  }
);

module.exports = {
  updateNotificationEmail,
  updatePermissionNotificationEmail,
  deleteTemplateSuccessEmail,
  sendInvitationReminderEmail,
  sendInvitationEmail,
  sendConfirmationEmail,
  sendForgotPasswordEmail,
  sendPasswordResetEmail,
  sendAccountActivationConfirmationEmail,
  sendAgentUploadedProfileFilesForStudentEmail,
  sendAgentUploadedVPDForStudentEmail,
  sendUploadedProfileFilesRemindForAgentEmail,
  sendUploadedVPDRemindForAgentEmail,
  sendChangedProfileFileStatusEmail,
  updateCredentialsEmail,
  UpdateStudentApplicationsEmail,
  NewMLRLEssayTasksEmail,
  NewMLRLEssayTasksEmailFromTaiGer,
  sendSomeReminderEmail,
  informAgentManagerNewStudentEmail,
  informAgentNewStudentEmail,
  informStudentTheirAgentEmail,
  sendSetAsFinalGeneralFileForAgentEmail,
  sendSetAsFinalGeneralFileForStudentEmail,
  AdmissionResultInformEmailToTaiGer,
  sendNewInterviewMessageInThreadEmail,
  sendNewApplicationMessageInThreadEmail,
  sendNewGeneraldocMessageInThreadEmail,
  sendSetAsFinalProgramSpecificFileForStudentEmail,
  sendSetAsFinalProgramSpecificFileForAgentEmail,
  assignEssayTaskToEditorEmail,
  assignDocumentTaskToEditorEmail,
  assignDocumentTaskToStudentEmail,
  informAgentEssayAssignedEmail,
  informAgentStudentAssignedEmail,
  informEssayWriterNewEssayEmail,
  informEditorNewStudentEmail,
  informEditorArchivedStudentEmail,
  informStudentArchivedStudentEmail,
  informStudentTheirEssayWriterEmail,
  informStudentTheirEditorEmail,
  createApplicationToStudentEmail,
  AnalysedCoursesDataStudentEmail,
  updateCoursesDataAgentEmail,
  sendAssignEditorReminderEmail,
  sendNoTrainerInterviewRequestsReminderEmail,
  sendAssignTrainerReminderEmail,
  sendAgentNewMessageReminderEmail,
  sendStudentNewMessageReminderEmail,
  MeetingAdjustReminderEmail,
  MeetingConfirmationReminderEmail,
  MeetingInvitationEmail,
  MeetingCancelledReminderEmail,
  MeetingReminderEmail,
  UnconfirmedMeetingReminderEmail,
  TicketCreatedAgentEmail,
  TicketResolvedRequesterReminderEmail,
  TicketResolvedStudentEmail,
  sendAssignEssayWriterReminderEmail,
  sendAssignedInterviewTrainerToTrainerEmail,
  sendAssignedInterviewTrainerToStudentEmail,
  sendInterviewConfirmationEmail,
  sendInterviewCancelEmail,
  InterviewCancelledReminderEmail,
  InterviewTrainingReminderEmail,
  sendSetAsFinalInterviewEmail,
  InterviewSurveyRequestEmail,
  InterviewSurveyFinishedEmail,
  InterviewSurveyFinishedToTaiGerEmail
};
