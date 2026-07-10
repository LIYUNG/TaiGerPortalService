import mongoose from 'mongoose';
import { Role } from '@taiger-common/core';
import { IStudent, IUser } from '@taiger-common/model';

import { isArchiv, isNotArchiv } from '../constants';
import {
  sendNewApplicationMessageInThreadEmail,
  sendAssignEditorReminderEmail,
  sendNewGeneraldocMessageInThreadEmail
} from '../services/email';
import { ErrorResponse } from '../common/errors';
import DocumentThreadService from '../services/documentthreads';
import StudentService from '../services/students';
import PermissionService from '../services/permissions';

// A populated user ref (the `_id` is present on the hydrated/lean doc but not
// on the bare `IUser` model interface). Used for both the acting `user` and
// agent/editor recipients — all read the same firstname/lastname/email/archiv
// shape here.
type PopulatedUser = IUser & { _id: mongoose.Types.ObjectId | string };

// A student with its agent/editor refs populated (as returned by the
// `getStudentByIdPopulated(..., [['agents editors', '...']])` lookup below) —
// narrower than the raw ObjectId[]/string[] the IStudent model declares.
type PopulatedStudent = IStudent & {
  _id: mongoose.Types.ObjectId | string;
  agents?: PopulatedUser[];
  editors?: PopulatedUser[];
};

interface PopulatedProgramRef {
  school?: string;
  program_name?: string;
}

// A document thread as consumed here: `program_id` populated (see the
// `findOneThreadPopulated(..., [['program_id']])` caller in
// documents_modification.ts) and `_id` present on the hydrated/lean doc.
interface PopulatedThread {
  _id: mongoose.Types.ObjectId | string;
  program_id?: PopulatedProgramRef;
}

// The survey-input doc shape read here — mirrors the caller-side
// `SurveyInputDoc` local type in documents_modification.ts.
interface PopulatedSurvey {
  studentId?: mongoose.Types.ObjectId | string;
  programId?: mongoose.Types.ObjectId | string | null;
  fileType?: string;
}

// Internal helpers — invoked directly with domain args (NOT Express
// middleware), so they must NOT be wrapped in asyncHandler (its (req,res,next)
// wrapper would drop every positional arg past the third).
export const addMessageInThread = async (
  message: string,
  threadId: string | mongoose.Types.ObjectId | undefined,
  userId: string | mongoose.Types.ObjectId | undefined
) => {
  // getThreadDocById's declared `id: string` param is a pre-existing looser
  // spot (it accepts an ObjectId fine at runtime); cast reflects that reality.
  const thread = await DocumentThreadService.getThreadDocById(
    threadId as string
  );
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

const informStaff = async (
  user: PopulatedUser,
  staff: PopulatedUser,
  student: PopulatedStudent,
  fileType: string | undefined,
  thread: PopulatedThread,
  message: string
) => {
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
      school: thread.program_id?.school,
      program_name: thread.program_id?.program_name,
      thread_id: thread._id.toString(),
      uploaded_updatedAt: new Date(),
      message
    }
  );
};

const informNoEditor = async (student: PopulatedStudent) => {
  const agents = student?.agents ?? [];
  await StudentService.updateStudentByIdRaw(student._id.toString(), {
    needEditor: true
  });

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

export const informOnSurveyUpdate = async (
  user: PopulatedUser,
  survey: PopulatedSurvey,
  thread: PopulatedThread
) => {
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

  // getStudentByIdPopulated's declared `id: string` param is a pre-existing
  // looser spot (it accepts an ObjectId fine at runtime); cast reflects that.
  // The populated result is narrower than IStudent's raw agents/editors refs.
  const student = (await StudentService.getStudentByIdPopulated(
    survey.studentId as string,
    [['agents editors', 'firstname lastname email']]
  )) as unknown as PopulatedStudent;

  const editors = student?.editors ?? [];
  const agents = student?.agents ?? [];
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
