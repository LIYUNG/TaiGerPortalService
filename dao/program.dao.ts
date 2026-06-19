import { FilterQuery, UpdateQuery, PipelineStage, SortOrder } from 'mongoose';
import { IProgram } from '@taiger-common/model';
import { Program } from '../models';

/**
 * ProgramDAO — data access for the Program model (default-connection model from
 * models/index.js). Plain params, no req.
 *
 * The version-control + program-change plugins are applied to the shared Program
 * schema (models/Program.js) and resolve sibling models from the model's own
 * connection, so writes here fire the same hooks as the per-request model.
 */
const ProgramDAO = {
  async getProgramByIdLean(programId: string) {
    return Program.findById(programId).lean();
  },

  async getProgramByIdSelect(programId: string, select: string) {
    return Program.findById(programId).select(select).lean();
  },

  async createProgram(payload: Partial<IProgram>) {
    return Program.create(payload);
  },

  async updateProgramOne(
    filter: FilterQuery<IProgram>,
    fields: UpdateQuery<IProgram>
  ) {
    return Program.findOneAndUpdate(filter, fields, { new: true }).lean();
  },

  async updateProgramById(programId: string, fields: UpdateQuery<IProgram>) {
    return Program.findByIdAndUpdate(programId, fields, { new: true }).lean();
  },

  async updateManyPrograms(
    filter: FilterQuery<IProgram>,
    update: UpdateQuery<IProgram>,
    options: Record<string, unknown> = {}
  ) {
    return Program.updateMany(filter, update, options);
  },

  async archiveProgramById(programId: string) {
    return Program.findByIdAndUpdate(programId, { isArchiv: true });
  },

  async findPrograms(filter: FilterQuery<IProgram> = {}) {
    return Program.find(filter).lean();
  },

  // Distinct (school, program_name, degree) tuples, sorted by school — feeds the
  // program-requirements editor's program picker.
  async getDistinctSchoolProgramDegree() {
    return Program.aggregate([
      {
        $group: {
          _id: {
            school: '$school',
            program_name: '$program_name',
            degree: '$degree'
          }
        }
      },
      {
        $project: {
          _id: 0,
          school: '$_id.school',
          program_name: '$_id.program_name',
          degree: '$_id.degree'
        }
      },
      {
        $sort: { school: 1 }
      }
    ]);
  },

  async findProgramsBySchoolNameDegree({
    school,
    program_name,
    degree
  }: {
    school: string;
    program_name: string;
    degree: string;
  }) {
    return Program.find({ school, program_name, degree }).lean();
  },

  async aggregatePrograms(pipeline: PipelineStage[]) {
    return Program.aggregate(pipeline);
  },

  async countPrograms(filter: FilterQuery<IProgram> = {}) {
    return Program.countDocuments(filter);
  },

  async findProgramsQuery(
    filter: FilterQuery<IProgram> = {},
    {
      select,
      sort,
      limit
    }: {
      select?: string;
      sort?: Record<string, SortOrder>;
      limit?: number;
    } = {}
  ) {
    let query = Program.find(filter);
    if (select) {
      query = query.select(select);
    }
    if (sort) {
      query = query.sort(sort);
    }
    if (limit !== undefined) {
      query = query.limit(limit);
    }
    return query.lean();
  },

  // Returns [programs, total] for a server-side paginated list.
  async findProgramsPaginated({
    filter,
    select,
    sort,
    skip,
    limit
  }: {
    filter: FilterQuery<IProgram>;
    select: string;
    sort: Record<string, SortOrder>;
    skip: number;
    limit: number;
  }) {
    return Promise.all([
      Program.find(filter)
        .select(select)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Program.countDocuments(filter)
    ]);
  }
};

export = ProgramDAO;
