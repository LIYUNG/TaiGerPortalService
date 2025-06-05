const ProgramService = {
  async getPrograms(req, filter) {
    return req.db.model('Program').find(filter).lean();
  },
  async getProgramById(req, programId) {
    return req.db.model('Program').findById(programId).lean();
  }
};

module.exports = ProgramService;
