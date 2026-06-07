const { Program } = require('../models');

/**
 * ProgramDAO — data access for the Program model (default-connection model from
 * models/index.js). Plain params, no req.
 *
 * The version-control + program-change plugins are applied to the shared Program
 * schema (models/Program.js) and resolve sibling models from the model's own
 * connection, so writes here fire the same hooks as the per-request model.
 */
const ProgramDAO = {
  async getProgramByIdLean(programId) {
    return Program.findById(programId).lean();
  },

  async getProgramByIdSelect(programId, select) {
    return Program.findById(programId).select(select).lean();
  },

  async createProgram(payload) {
    return Program.create(payload);
  },

  async updateProgramOne(filter, fields) {
    return Program.findOneAndUpdate(filter, fields, { new: true }).lean();
  },

  async updateProgramById(programId, fields) {
    return Program.findByIdAndUpdate(programId, fields, { new: true }).lean();
  },

  async updateManyPrograms(filter, update, options = {}) {
    return Program.updateMany(filter, update, options);
  },

  async archiveProgramById(programId) {
    return Program.findByIdAndUpdate(programId, { isArchiv: true });
  },

  async findPrograms(filter = {}) {
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

  async findProgramsBySchoolNameDegree({ school, program_name, degree }) {
    return Program.find({ school, program_name, degree }).lean();
  },

  async aggregatePrograms(pipeline) {
    return Program.aggregate(pipeline);
  },

  async countPrograms(filter = {}) {
    return Program.countDocuments(filter);
  },

  async findProgramsQuery(filter = {}, { select, sort, limit } = {}) {
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
  async findProgramsPaginated({ filter, select, sort, skip, limit }) {
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

module.exports = ProgramDAO;
