const { Program } = require('../models');

/**
 * ProgramDAO — READ-ONLY data access for the Program model (default-connection
 * model from models/index.js). Plain params, no req.
 *
 * NOTE: only reads live here. Program *writes* still go through the per-request
 * `req.db` connection because the default-connection Program model does not yet
 * have the version-control / handleProgramChanges plugins wired up
 * (see models/index.js). Reads are unaffected by that wiring.
 */
const ProgramDAO = {
  async getProgramByIdLean(programId) {
    return Program.findById(programId).lean();
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
  }
};

module.exports = ProgramDAO;
