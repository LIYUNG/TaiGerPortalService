const { RLs_CONSTANT } = require('../../constants');
const { asyncHandler } = require('../../middlewares/error-handler');

const FILETYPES = {
  rl_required: 'RL',
  ml_required: 'ML',
  sop_required: 'SOP',
  phs_required: 'PHS',
  essay_required: 'Essay',
  portfolio_required: 'Portfolio',
  curriculum_analysis_required: 'Curriculum_Analysis',
  scholarship_form_required: 'Scholarship_Form',
  supplementary_form_required: 'Supplementary_Form'
};

const checkIsRLspecific = (program) => {
  const isRLSpecific = program?.is_rl_specific;
  const NoRLSpecificFlag = isRLSpecific === undefined || isRLSpecific === null;
  return isRLSpecific || (NoRLSpecificFlag && program?.rl_requirements);
};

const findRLDelta = asyncHandler(
  async (program, studentId, threads, options) => {
    const { skipCompleted } = options || {};
    let delta = {
      add: [],
      remove: []
    };

    const nrRLneeded = parseInt(program.rl_required);
    const nrSpecRLNeeded = !checkIsRLspecific(program) ? 0 : nrRLneeded;

    const existingRL = threads.filter((thread) =>
      thread?.file_type?.startsWith('RL_')
    );
    existingRL
      .sort((a, b) => a?.file_type?.localeCompare(b?.file_type))
      .reverse();
    const nrSpecificRL = existingRL.length;

    // find missing RL
    if (nrSpecRLNeeded > nrSpecificRL) {
      const existingRLTypes = existingRL.map((thread) => thread.file_type);
      const availableRLs = RLs_CONSTANT.filter(
        (fileType) => !existingRLTypes.includes(fileType)
      );
      const missingRL = nrSpecRLNeeded - nrSpecificRL;
      for (let i = 0; i < missingRL && i < availableRLs.length; i += 1) {
        delta.add.push({
          studentId,
          programId: program._id,
          fileType: availableRLs[i]
        });
      }
    }

    // find extra RL
    if (nrSpecRLNeeded < nrSpecificRL) {
      const extraRL = nrSpecificRL - nrSpecRLNeeded;
      for (let i = 0; i < extraRL && i < existingRL.length; i += 1) {
        const fileThread = threads.find(
          (thread) => thread.file_type === existingRL[i]?.file_type
        );
        if (skipCompleted && fileThread.isFinalVersion) {
          continue;
        }
        delta.remove.push({
          studentId,
          programId: program._id,
          fileThread
        });
      }
    }

    return delta;
  }
);

const findStudentDeltaGet = asyncHandler(
  async (req, studentId, program, options) => {
    const { skipCompleted } = options || {};

    const delta = {
      add: [],
      remove: []
    };

    const studentProgramThreads = await req.db
      .model('Documentthread')
      .find({
        student_id: studentId,
        program_id: program._id
      })
      .select('file_type messages isFinalVersion')
      .lean();

    studentProgramThreads.map((thread) => {
      thread.messageSize = thread.messages.length;
      delete thread.messages;
    });

    for (const fileType of Object.keys(FILETYPES)) {
      if (FILETYPES[fileType] === 'RL') {
        continue;
      }
      const fileThread = studentProgramThreads.find(
        (thread) => thread.file_type === FILETYPES[fileType]
      );

      if (program[fileType]?.toLowerCase() === 'yes' && !fileThread) {
        delta.add.push({
          studentId,
          programId: program._id,
          fileType: FILETYPES[fileType]
        });
      } else if (program[fileType]?.toLowerCase() !== 'yes' && fileThread) {
        if (skipCompleted && fileThread.isFinalVersion) {
          continue;
        }
        delta.remove.push({
          studentId,
          programId: program._id,
          fileThread
        });
      }
    }

    const RLdelta = await findRLDelta(
      program,
      studentId,
      studentProgramThreads,
      options || {}
    );
    delta.add = delta.add.concat(RLdelta.add);
    delta.remove = delta.remove.concat(RLdelta.remove);
    return delta;
  }
);

const findStudentDelta = asyncHandler(
  async (studentId, program, { DocumentthreadModel }, options) => {
    const { skipCompleted } = options || {};

    const delta = {
      add: [],
      remove: []
    };

    const studentProgramThreads = await DocumentthreadModel.find({
      student_id: studentId,
      program_id: program._id
    })
      .select('file_type messages isFinalVersion')
      .lean();

    studentProgramThreads.map((thread) => {
      thread.messageSize = thread.messages.length;
      delete thread.messages;
    });

    for (const fileType of Object.keys(FILETYPES)) {
      if (FILETYPES[fileType] === 'RL') {
        continue;
      }
      const fileThread = studentProgramThreads.find(
        (thread) => thread.file_type === FILETYPES[fileType]
      );

      if (program[fileType]?.toLowerCase() === 'yes' && !fileThread) {
        delta.add.push({
          studentId,
          programId: program._id,
          fileType: FILETYPES[fileType]
        });
      } else if (program[fileType]?.toLowerCase() !== 'yes' && fileThread) {
        if (skipCompleted && fileThread.isFinalVersion) {
          continue;
        }
        delta.remove.push({
          studentId,
          programId: program._id,
          fileThread
        });
      }
    }

    const RLdelta = await findRLDelta(
      program,
      studentId,
      studentProgramThreads,
      options || {}
    );
    delta.add = delta.add.concat(RLdelta.add);
    delta.remove = delta.remove.concat(RLdelta.remove);
    return delta;
  }
);

module.exports = {
  findStudentDeltaGet,
  findStudentDelta
};
