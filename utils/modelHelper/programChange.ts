import type { Types } from 'mongoose';
import type { IProgram } from '@taiger-common/model';
import { RLs_CONSTANT } from '../../constants';
import { asyncHandler } from '../../middlewares/error-handler';

type ProgramId = Types.ObjectId | string;

// The subset of IProgram's `*_required` flags that FILETYPES maps to a
// document-thread file type. Typed as a key union (rather than indexing
// IProgram with a bare `string`) so `program[fileType]` stays type-checked.
type ProgramRequirementKey = keyof Pick<
  IProgram,
  | 'rl_required'
  | 'ml_required'
  | 'sop_required'
  | 'phs_required'
  | 'essay_required'
  | 'portfolio_required'
  | 'curriculum_analysis_required'
  | 'scholarship_form_required'
  | 'supplementary_form_required'
>;

// `program` here flows in from a mix of lean() query results and hook-built
// plain objects (see versionControl.ts's handleProgramChanges/enableVersionControl),
// so only `_id` is guaranteed to be present; every requirement field is
// already optional on IProgram itself.
export type ProgramLike = Partial<IProgram> & { _id: ProgramId };

// Document-thread records here are lean()/service results that this module
// mutates in place (messages -> messageSize) before handing them to
// findRLDelta. `_id` is always present (Mongo includes it by default even
// though the select() projection below doesn't name it explicitly).
export interface DeltaThread {
  _id: ProgramId;
  file_type: string;
  isFinalVersion?: boolean;
  messages?: unknown[];
  messageSize?: number;
}

export interface DeltaAddItem {
  studentId: string;
  programId: ProgramId;
  fileType: string;
}

export interface DeltaRemoveItem {
  studentId: string;
  programId: ProgramId;
  fileThread: DeltaThread;
}

export interface Delta {
  add: DeltaAddItem[];
  remove: DeltaRemoveItem[];
}

export interface DeltaOptions {
  skipCompleted?: boolean;
}

const FILETYPES: Record<ProgramRequirementKey, string> = {
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

const checkIsRLspecific = (program: ProgramLike) => {
  const isRLSpecific = program?.is_rl_specific;
  const NoRLSpecificFlag = isRLSpecific === undefined || isRLSpecific === null;
  return isRLSpecific || (NoRLSpecificFlag && program?.rl_requirements);
};

const findRLDelta = asyncHandler(
  async (
    program: ProgramLike,
    studentId: string,
    threads: DeltaThread[],
    options?: DeltaOptions
  ): Promise<Delta> => {
    const { skipCompleted } = options || {};
    const delta: Delta = {
      add: [],
      remove: []
    };

    const nrRLneeded = parseInt(program.rl_required ?? '', 10);
    const nrSpecRLNeeded = !checkIsRLspecific(program) ? 0 : nrRLneeded;

    const existingRL = threads.filter((thread) =>
      thread?.file_type?.startsWith('RL_')
    );
    existingRL.sort((a, b) => a.file_type.localeCompare(b.file_type)).reverse();
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
        // Guaranteed to be found: existingRL[i] was itself filtered out of
        // `threads`, so its file_type always has a match.
        const fileThread = threads.find(
          (thread) => thread.file_type === existingRL[i]?.file_type
        ) as DeltaThread;
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

export const findStudentDeltaGet = asyncHandler(
  async (
    req: unknown,
    studentId: string,
    program: ProgramLike,
    options?: DeltaOptions
  ): Promise<Delta> => {
    const { skipCompleted } = options || {};

    const delta: Delta = {
      add: [],
      remove: []
    };

    // Lazy require to avoid a load-time cycle:
    // versionControl -> programChange -> documentthreads -> versionControl.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy/circular require
    const DocumentThreadService = require('../../services/documentthreads');
    const studentProgramThreads: DeltaThread[] =
      await DocumentThreadService.findThreads(
        {
          student_id: studentId,
          program_id: program._id
        },
        'file_type messages isFinalVersion'
      );

    studentProgramThreads.map((thread) => {
      thread.messageSize = thread.messages!.length;
      delete thread.messages;
    });

    for (const fileType of Object.keys(FILETYPES) as ProgramRequirementKey[]) {
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

// `options` is intentionally optional: asyncHandler's generic preserves this
// handler's exact parameter list (see middlewares/error-handler.ts), and
// several call sites (e.g. versionControl.ts's handleStudentDelta) invoke
// this with only 2 args, relying on the `options || {}` default below.
export const findStudentDelta = asyncHandler(
  async (
    studentId: string,
    program: ProgramLike,
    options?: DeltaOptions
  ): Promise<Delta> => {
    const { skipCompleted } = options || {};

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional lazy/circular require
    const { Documentthread } = require('../../models');

    const delta: Delta = {
      add: [],
      remove: []
    };

    const studentProgramThreads: DeltaThread[] = await Documentthread.find({
      student_id: studentId,
      program_id: program._id
    })
      .select('file_type messages isFinalVersion')
      .lean();

    studentProgramThreads.map((thread) => {
      thread.messageSize = thread.messages!.length;
      delete thread.messages;
    });

    for (const fileType of Object.keys(FILETYPES) as ProgramRequirementKey[]) {
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
