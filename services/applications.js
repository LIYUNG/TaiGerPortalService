const mongoose = require('mongoose');
const { ErrorResponse } = require('../common/errors');
const logger = require('./logger');

const ApplicationService = {
  async createApplication(req) {
    const { studentId } = req.params;
    const { programId } = req.body;
    const application = await req.db.model('Application').create({
      studentId,
      programId
    });
    return application;
  },
  async getActiveStudentsApplications(req, filter) {
    const applications = await req.db
      .model('Application')
      .find(filter)
      .populate({
        path: 'studentId',
        populate: {
          path: 'editors agents',
          select: 'firstname lastname email'
        }
      })
      .populate({
        path: 'studentId',
        populate: {
          path: 'generaldocs_threads.doc_thread_id',
          select: '-messages'
        }
      })
      .populate(
        'programId',
        'school program_name degree semester lang application_deadline application_start'
      )
      .populate('doc_modification_thread.doc_thread_id', '-messages')
      .lean();
    const filteredApplications = applications.filter(
      (app) => app.studentId.archiv !== true
    );
    return filteredApplications;
  },
  async getStudentsApplicationsByTaiGerUserId(
    req,
    userId,
    applicationFilter = {}
  ) {
    const applications = await this.getActiveStudentsApplications(
      req,
      applicationFilter
    );

    const filteredApplications = applications.filter(
      (app) =>
        app.studentId.agents.some((agent) => agent._id.toString() === userId) ||
        app.studentId.editors.some((editor) => editor._id.toString() === userId)
    );

    return filteredApplications;
  },
  getApplications(req, filter) {
    return req.db
      .model('Application')
      .find(filter)
      .populate('programId')
      .populate('doc_modification_thread.doc_thread_id', '-messages');
  },
  async getApplicationsWithStudentDetails(req, filter) {
    const applications = await req.db
      .model('Application')
      .find(filter)
      .populate(
        'programId',
        'school program_name degree semester lang application_deadline application_start'
      )
      .populate({
        path: 'studentId',
        populate: {
          path: 'editors agents',
          select: 'firstname lastname email'
        }
      })
      .populate('doc_modification_thread.doc_thread_id', '-messages')
      .lean();
    return applications;
  },
  async getApplicationsByStudentId(req, studentId) {
    const applications = await this.getApplications(req, { studentId }).lean();
    return applications;
  },
  async getApplicationsWithCredentialsByStudentId(req, studentId) {
    const applications = await this.getApplications(req, { studentId })
      .select(
        '+portal_credentials.application_portal_a.account +portal_credentials.application_portal_b.account +portal_credentials.application_portal_a.password +portal_credentials.application_portal_b.password'
      )
      .lean();
    return applications;
  },
  async getApplicationsByProgramId(req, programId) {
    const applications = await this.getApplications(req, { programId }).lean();
    return applications;
  },
  async getApplicationById(req, applicationId) {
    const application = await req.db
      .model('Application')
      .findById(applicationId)
      .populate('programId')
      .populate('doc_modification_thread.doc_thread_id', '-messages');
    return application;
  },
  async updateApplication(req, filter, payload) {
    const application = await req.db
      .model('Application')
      .findOneAndUpdate(filter, payload, { new: true })
      .populate('programId')
      .lean();
    return application;
  },
  async deleteApplication(req, application_id) {
    const application = await this.getApplicationById(req, application_id);

    if (!application) {
      logger.error('deleteApplication: Invalid application id');
      throw new ErrorResponse(404, 'Application not found');
    }

    const threads = await req.db
      .model('Documentthread')
      .find({ application_id })
      .lean();

    // checking if delete is safe?
    for (let i = 0; i < threads.length; i += 1) {
      if (threads[i].messages.length !== 0) {
        logger.error(
          'deleteApplication: Some ML/RL/Essay discussion threads are existed and not empty.'
        );
        throw new ErrorResponse(
          409,
          'Some ML/RL/Essay discussion threads are existed and not empty. Please make sure the non-empty discussion threads are ready to be deleted and delete those thread first and then delete this application.'
        );
      }
    }

    // Only delete threads when all empty
    const threadIds = threads.map(
      (thread) => new mongoose.Types.ObjectId(thread._id.toString())
    );
    logger.info('Trying to delete empty threads');
    await req.db.model('Documentthread').deleteMany({
      _id: { $in: threadIds }
    });
    // TODO: delete VPD
    await req.db.model('Application').findByIdAndDelete(application_id);
  },
  async updateApplicationsBulk(req, updates) {
    const result = await req.db.model('Application').bulkWrite(updates);
    return result;
  },
  async getApplicationConflicts(req) {
    const applicationConflicts = await req.db.model('Application').aggregate([
      {
        $match: {
          decided: 'O',
          closed: '-',
          programId: { $ne: null }, // optional: ignore null programIds
          studentId: { $ne: null }
        }
      },
      {
        $group: {
          _id: '$programId',
          studentIds: { $addToSet: '$studentId' }, // avoid duplicates
          applicationCount: { $sum: 1 }
        }
      },
      {
        $match: {
          applicationCount: { $gt: 1 } // optional: only programs with >1 applicant
        }
      },
      // Lookup program info
      {
        $lookup: {
          from: 'programs',
          localField: '_id',
          foreignField: '_id',
          as: 'programInfo'
        }
      },
      {
        $unwind: '$programInfo'
      },
      // Lookup student info
      {
        $lookup: {
          from: 'users',
          localField: 'studentIds',
          foreignField: '_id',
          as: 'students'
        }
      },
      // Project only necessary fields
      {
        $project: {
          _id: 0,
          programId: '$_id',
          program: {
            _id: '$programInfo._id',
            school: '$programInfo.school',
            program_name: '$programInfo.program_name',
            application_deadline: '$programInfo.application_deadline',
            degree: '$programInfo.degree',
            semester: '$programInfo.semester'
          },
          application_year: '$_id.application_year',
          applicationCount: 1,
          students: {
            $map: {
              input: '$students',
              as: 's',
              in: {
                _id: '$$s._id',
                firstname: '$$s.firstname',
                lastname: '$$s.lastname'
              }
            }
          }
        }
      }
    ]);

    return applicationConflicts;
  }
};

module.exports = ApplicationService;
