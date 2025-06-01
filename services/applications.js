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
  async getStudentsApplicationsByTaiGerUserId(req, userId) {
    const applications = await req.db
      .model('Application')
      .find()
      .populate({
        path: 'studentId',
        populate: {
          path: 'editors agents',
          select: 'firstname lastname email'
        }
      })
      .populate('programId')
      .lean();

    const filteredApplications = applications.filter(
      (app) =>
        app.studentId.agents.some((agent) => agent._id.toString() === userId) ||
        app.studentId.editors.some((editor) => editor._id.toString() === userId)
    );

    return filteredApplications;
  },
  async getApplicationsByStudentId(req, studentId) {
    const applications = await req.db
      .model('Application')
      .find({ studentId })
      .populate('programId')
      .populate('doc_modification_thread.doc_thread_id', '-messages')
      .lean();

    return applications;
  },
  async getApplicationById(req, applicationId) {
    const application = await req.db
      .model('Application')
      .findById(applicationId);
    return application;
  },
  async updateApplication(req) {
    const { applicationId } = req.params;
    const { programId } = req.body;
    await req.db.model('Application').findByIdAndUpdate(applicationId, {
      programId
    });
  },
  async deleteApplication(req, application_id) {
    const application = await req.db
      .model('Application')
      .findById(application_id)
      .populate('programId')
      .populate('doc_modification_thread.doc_thread_id')
      .lean();

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
  }
};

module.exports = ApplicationService;
