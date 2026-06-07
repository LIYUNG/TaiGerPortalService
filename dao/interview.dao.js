const { Interview } = require('../models');

const withPopulate = (query) =>
  query
    .populate('trainer_id', 'firstname lastname email pictureUrl')
    .populate('event_id')
    .lean();

// Apply a list of populate argument tuples (e.g. [['program_id', 'school']]).
const applyPopulates = (query, populates = []) => {
  populates.forEach((args) => {
    query = query.populate(...args);
  });
  return query;
};

/**
 * InterviewDAO — data access for the Interview model (central default-connection
 * model). Plain params, no req.
 */
const InterviewDAO = {
  async getInterviews(filter) {
    return withPopulate(Interview.find(filter));
  },

  async getInterviewById(id) {
    return withPopulate(Interview.findById(id));
  },

  async getInterviewsByStudentId(studentId) {
    return withPopulate(Interview.find({ student_id: studentId }));
  },

  // Live (non-lean) document — used for status pre-checks / delete.
  async findByIdRaw(id) {
    return Interview.findById(id);
  },

  async findInterviews(filter, populates = []) {
    return applyPopulates(Interview.find(filter), populates).lean();
  },

  async findInterviewByIdPopulated(id, populates = []) {
    return applyPopulates(Interview.findById(id), populates).lean();
  },

  async findOneInterview(filter, populates = []) {
    return applyPopulates(Interview.findOne(filter), populates).lean();
  },

  // Distinct ids of students who already have a trained (event-bearing)
  // interview among the given candidates.
  async distinctTrainedStudentIds(studentIds) {
    return Interview.find({
      student_id: { $in: studentIds },
      event_id: { $exists: true, $ne: null }
    }).distinct('student_id');
  },

  async updateInterviewByIdRaw(id, payload) {
    return Interview.findByIdAndUpdate(id, payload, {});
  },

  async updateInterviewByIdPopulated(id, payload, populates = []) {
    return applyPopulates(
      Interview.findByIdAndUpdate(id, payload, { new: true }),
      populates
    ).lean();
  },

  async upsertInterviewPopulated(filter, payload, populates = []) {
    return applyPopulates(
      Interview.findOneAndUpdate(filter, payload, { upsert: true }),
      populates
    ).lean();
  },

  async deleteInterviewById(id) {
    return Interview.findByIdAndDelete(id);
  },

  async aggregateInterviews(pipeline) {
    return Interview.aggregate(pipeline);
  }
};

module.exports = InterviewDAO;
