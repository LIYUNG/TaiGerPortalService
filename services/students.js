const mongoose = require('mongoose');

/**
 * StudentService handles queries for the Student model.
 */
const StudentService = {
  /**
   * Fetches a student by ID with optional population.
   *
   * @param {mongoose.Connection} db - The Mongoose connection instance.
   * @param {string} filter - The query filter.
   * @returns {Promise<mongoose.Document | null>} - The student document.
   */
  async fetchStudents(req, filter) {
    return req.db
      .model('Student')
      .find(filter)
      .populate('agents editors', 'firstname lastname email')
      .populate('applications.programId')
      .populate(
        'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
        '-messages'
      )
      .select(
        '-notification +applications.portal_credentials.application_portal_a.account +applications.portal_credentials.application_portal_a.password +applications.portal_credentials.application_portal_b.account +applications.portal_credentials.application_portal_b.password'
      )
      .select('-notification')
      .lean();
  },
  async fetchSimpleStudents(req, filter) {
    return req.db
      .model('User')
      .find(filter)
      .populate('agents editors', 'firstname lastname email')
      .select('-notification')
      .lean();
  },
  async getStudents(req, { filter = {}, options = {} }) {
    return req.db
      .model('User')
      .find(filter)
      .populate('agents editors', 'firstname lastname email')
      .populate('applications.programId')
      .sort(options.sort)
      .skip(options.skip)
      .limit(options.limit)
      .lean();
  },
  async fetchStudentsWithThreadsInfo(req, filter) {
    return req.db
      .model('Student')
      .find(filter)
      .populate(
        'applications.programId',
        'school program_name degree application_deadline semester lang'
      )
      .populate({
        path: 'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
        select:
          'file_type flag_by_user_id outsourced_user_id isFinalVersion updatedAt messages.file',
        populate: {
          path: 'outsourced_user_id messages.user_id',
          select: 'firstname lastname'
        }
      })
      .populate('editors agents', 'firstname lastname')
      .select(
        'applications generaldocs_threads firstname lastname application_preference attributes'
      )
      .lean();
  },
  async fetchStudentByIdWithThreadsInfo(req, studentId) {
    return req.db
      .model('Student')
      .findById(studentId)
      .populate(
        'applications.programId',
        'school program_name degree application_deadline semester lang'
      )
      .populate({
        path: 'generaldocs_threads.doc_thread_id applications.doc_modification_thread.doc_thread_id',
        select:
          'file_type flag_by_user_id outsourced_user_id isFinalVersion updatedAt messages.file',
        populate: {
          path: 'outsourced_user_id messages.user_id',
          select: 'firstname lastname'
        },
        options: {
          projection: { messages: { $slice: -1 } } // Get only the last message
        }
      })
      .populate('editors agents', 'firstname lastname')
      .select(
        'applications generaldocs_threads firstname lastname application_preference attributes'
      )
      .lean();
  }
};

module.exports = StudentService;
