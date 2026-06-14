const { Role } = require('@taiger-common/core');

const { isArchiv, isNotArchiv } = require('../constants');
const {
  sendNewApplicationMessageInThreadEmail,
  sendAssignEditorReminderEmail,
  sendNewGeneraldocMessageInThreadEmail
} = require('../services/email');
const { ErrorResponse } = require('../common/errors');
const DocumentThreadService = require('../services/documentthreads');
const StudentService = require('../services/students');
const PermissionService = require('../services/permissions');

// Internal helpers — invoked directly with domain args (NOT Express
// middleware), so they must NOT be wrapped in asyncHandler (its (req,res,next)
// wrapper would drop every positional arg past the third).
const addMessageInThread = async (message, threadId, userId) => {
  const thread = await DocumentThreadService.getThreadDocById(threadId);
  if (!thread) {
    throw new ErrorResponse(403, 'Invalid message thread id');
  }
  const msg = JSON.stringify({
    blocks: [
      {
        data: { text: message },
        type: 'paragraph'
      }
    ]
  });
  const newMessage = {
    user_id: userId,
    message: msg,
    createdAt: new Date()
  };
  thread.messages.push(newMessage);
  thread.updatedAt = new Date();
  await thread.save();
};

const informStaff = async (user, staff, student, fileType, thread, message) => {
  await sendNewApplicationMessageInThreadEmail(
    {
      firstname: staff.firstname,
      lastname: staff.lastname,
      address: staff.email
    },
    {
      writer_firstname: user.firstname,
      writer_lastname: user.lastname,
      student_firstname: student.firstname,
      student_lastname: student.lastname,
      uploaded_documentname: fileType,
      school: thread.program_id.school,
      program_name: thread.program_id.program_name,
      thread_id: thread._id.toString(),
      uploaded_updatedAt: new Date(),
      message
    }
  );
};

const informNoEditor = async (student) => {
  const agents = student?.agents;
  await StudentService.updateStudentByIdRaw(student._id, { needEditor: true });

  // inform active-agent
  const activeAgents = agents.filter((agent) => isNotArchiv(agent));

  await Promise.all(
    activeAgents.map((agent) =>
      sendAssignEditorReminderEmail(
        {
          firstname: agent.firstname,
          lastname: agent.lastname,
          address: agent.email
        },
        {
          student_firstname: student.firstname,
          student_id: student._id.toString(),
          student_lastname: student.lastname
        }
      )
    )
  );

  // inform editor-lead
  const permissions = await PermissionService.findPermissionsWithUser({
    canAssignEditors: true
  });

  if (!permissions || permissions.length === 0) {
    return; // Exit early if no permissions are found
  }

  const editorLeads = permissions.map((permission) => permission.user_id);

  // Send emails concurrently
  await Promise.all(
    editorLeads.map((editorLead) =>
      sendAssignEditorReminderEmail(
        {
          firstname: editorLead.firstname,
          lastname: editorLead.lastname,
          address: editorLead.email
        },
        {
          student_firstname: student.firstname,
          student_id: student._id.toString(),
          student_lastname: student.lastname
        }
      )
    )
  );
};

const informOnSurveyUpdate = async (user, survey, thread) => {
  // placeholder for automatic notification user id
  const notificationUser = undefined;

  // Create message notification
  await addMessageInThread(
    `Automatic Notification: Survey has been finalized by ${user.firstname} ${user.lastname}.`,
    thread?._id,
    notificationUser
  );

  if (user.role !== Role.Student) {
    return;
  }

  const student = await StudentService.getStudentByIdPopulated(
    survey.studentId,
    [['agents editors', 'firstname lastname email']]
  );

  const editors = student?.editors;
  const agents = student?.agents;
  const noEditor = !agents || agents.length === 0;
  const programId = survey?.programId?.toString();
  const fileType = survey?.fileType;
  const message = `Survey has been finalized by ${user.firstname} ${user.lastname}`;
  if (isArchiv(student)) {
    return;
  }

  // If no editor, inform agent to assign
  if (noEditor) {
    informNoEditor(student);
    // if supplementary form, inform Agent.
  } else if (fileType === 'Supplementary_Form') {
    const activeAgents = agents.filter((agent) => !isArchiv(agent));
    await Promise.all(
      activeAgents.map((agent) =>
        informStaff(user, agent, student, fileType, thread, message)
      )
    );
  } else {
    // Inform Editor
    const activeEditors = editors.filter((editor) => isNotArchiv(editor));
    await Promise.all(
      activeEditors.map((editor) => {
        if (programId) {
          return informStaff(user, editor, student, fileType, thread, message);
        }
        const recipient = {
          firstname: editor.firstname,
          lastname: editor.lastname,
          address: editor.email
        };
        const msg = {
          writer_firstname: user.firstname,
          writer_lastname: user.lastname,
          student_firstname: student.firstname,
          student_lastname: student.lastname,
          uploaded_documentname: fileType,
          thread_id: thread._id.toString(),
          uploaded_updatedAt: new Date(),
          message
        };
        return sendNewGeneraldocMessageInThreadEmail(recipient, msg);
      })
    );
  }
};

module.exports = { informOnSurveyUpdate, addMessageInThread };
