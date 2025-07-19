const _ = require('lodash');
const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const ApplicationService = require('../services/applications');
const StudentService = require('../services/students');

const getPortalCredentials = asyncHandler(async (req, res) => {
  const {
    params: { studentId }
  } = req;

  const student = await StudentService.getStudentById(req, studentId);
  const applications =
    await ApplicationService.getApplicationsWithCredentialsByStudentId(
      req,
      studentId
    );
  student.applications = applications;
  res.status(200).send({
    success: true,
    data: {
      applications: student.applications,
      student: {
        _id: student._id,
        firstname: student.firstname,
        lastname: student.lastname,
        agents: student.agents,
        editors: student.editors
      }
    }
  });
});

const createPortalCredentials = asyncHandler(async (req, res) => {
  const { applicationId } = req.params;
  const credentials = req.body;
  const application = await ApplicationService.updateApplication(
    req,
    {
      _id: applicationId
    },
    {
      portal_credentials: {
        application_portal_a: {
          account: credentials.account_portal_a,
          password: credentials.password_portal_a
        },
        application_portal_b: {
          account: credentials.account_portal_b,
          password: credentials.password_portal_b
        }
      }
    }
  );

  if (!application) {
    logger.error('createPortalCredentials: Application not found');
    throw new ErrorResponse(400, 'Application not found');
  }

  return res.send({ success: true, data: application });
});

module.exports = {
  getPortalCredentials,
  createPortalCredentials
};
