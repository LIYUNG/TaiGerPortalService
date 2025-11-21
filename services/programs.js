const ProgramService = {
  async getPrograms(req, filter) {
    return req.db.model('Program').find(filter).lean();
  },
  async getProgramById(req, programId) {
    return req.db.model('Program').findById(programId).lean();
  },
  /**
   * Check if a program has active (open) applications
   * A program has active applications if there are Applications for the program
   * where decided = 'O' (Yes) AND closed = '-' (not yet submitted)
   * and the associated student is active (not archived)
   * 
   * Note: Once all applications are submitted (closed = 'O'), the program should lock
   */
  async hasActiveApplications(req, programId) {
    if (!programId) return false;
    
    // Use aggregation to find open applications (decided = 'O' AND closed = '-') with active (non-archived) students
    const result = await req.db.model('Application').aggregate([
      {
        $match: {
          programId: programId,
          decided: 'O',
          closed: '-', // Only open applications (not yet submitted)
          studentId: { $exists: true, $ne: null }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      {
        $unwind: {
          path: '$student',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $match: {
          'student.archiv': false
        }
      },
      {
        $limit: 1
      }
    ]);
    
    return result.length > 0;
  },
  /**
   * Enrich program with hasActiveApplications field
   */
  async enrichProgramWithActiveApplications(req, program) {
    if (!program || !program._id) return program;
    const hasActive = await this.hasActiveApplications(req, program._id);
    return {
      ...program,
      hasActiveApplications: hasActive
    };
  },
  /**
   * Enrich multiple programs with hasActiveApplications field
   * Checks if programs have open applications (decided = 'O' AND closed = '-') with active (non-archived) students
   */
  async enrichProgramsWithActiveApplications(req, programs) {
    if (!Array.isArray(programs) || programs.length === 0) return programs;

    // Get all program IDs
    const programIds = programs.map((p) => p._id).filter(Boolean);

    // Find open applications (decided = 'O' AND closed = '-') for these programs with active students
    const activePrograms = await req.db.model('Application').aggregate([
      {
        $match: {
          programId: { $in: programIds },
          decided: 'O',
          closed: '-', // Only open applications (not yet submitted)
          studentId: { $exists: true, $ne: null }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      {
        $unwind: {
          path: '$student',
          preserveNullAndEmptyArrays: false
        }
      },
      {
        $match: {
          'student.archiv': false
        }
      },
      {
        $group: {
          _id: '$programId',
          count: { $sum: 1 }
        }
      }
    ]);

    // Create a map of programId -> hasActiveApplications
    const activeMap = new Map();
    activePrograms.forEach((item) => {
      activeMap.set(item._id.toString(), item.count > 0);
    });

    // Enrich each program
    return programs.map((program) => ({
      ...program,
      hasActiveApplications: activeMap.get(program._id?.toString()) || false
    }));
  }
};

module.exports = ProgramService;
