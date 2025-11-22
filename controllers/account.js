// const path = require('path');
const { ProfileNameType, DocumentStatusType } = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const { updateCredentialsEmail } = require('../services/email');
const logger = require('../services/logger');
const UserService = require('../services/users');

// (O) email : self notification
const updateCredentials = asyncHandler(async (req, res, next) => {
  const {
    user,
    body: { credentials }
  } = req;
  const userExisted = await UserService.updateUser(req, user._id.toString(), {
    password: credentials.new_password
  });
  if (!userExisted) {
    logger.error('updateCredentials: Invalid user');
    throw new ErrorResponse(400, 'Invalid user');
  }

  res.status(200).send({
    success: true
  });
  await updateCredentialsEmail(
    {
      firstname: user.firstname,
      lastname: user.lastname,
      address: user.email
    },
    {}
  );
  next();
});

const updateOfficehours = asyncHandler(async (req, res, next) => {
  const {
    user,
    body: { officehours, timezone }
  } = req;
  await req.db
    .model('Agent')
    .findByIdAndUpdate(user._id.toString(), { officehours, timezone }, {});

  res.status(200).send({
    success: true
  });
  next();
});

// Helper function to normalize university name
const normalizeName = (name) => {
  if (!name || typeof name !== 'string') return name;
  return name.trim().replace(/\s+/g, ' '); // Replace multiple spaces with single space
};

// (O)  email : self notification
const updateAcademicBackground = asyncHandler(async (req, res, next) => {
  const {
    body: { university }
  } = req;
  const { studentId } = req.params;

  try {
    // Normalize name field before saving
    if (university.attended_high_school) {
      university.attended_high_school = normalizeName(
        university.attended_high_school
      );
    }
    if (university.attended_university) {
      university.attended_university = normalizeName(
        university.attended_university
      );
    }
    if (university.attended_university_program) {
      university.attended_university_program = normalizeName(
        university.attended_university_program
      );
    }

    university.updatedAt = new Date();
    const updatedStudent = await req.db.model('User').findByIdAndUpdate(
      studentId,
      {
        'academic_background.university': university
      },
      { new: true }
    );

    // TODO: update base documents needed or not:
    const documentsToEnsure = [
      ProfileNameType.Bachelor_Certificate,
      ProfileNameType.Bachelor_Transcript,
      ProfileNameType.Course_Description,
      ProfileNameType.Employment_Certificate,
      ProfileNameType.ECTS_Conversion
    ];
    const ensureDocumentStatus = (
      studentProfile,
      docName,
      profileNameList,
      status
    ) => {
      let document = studentProfile.find(
        (doc) => doc.name === profileNameList[docName]
      );
      if (!document) {
        document = studentProfile.create({ name: profileNameList[docName] });
        document.status = status;
        document.required = true;
        document.updatedAt = new Date();
        document.path = '';
        studentProfile.push(document);
      } else if (
        document.status ===
        (status === DocumentStatusType.NotNeeded
          ? DocumentStatusType.Missing
          : DocumentStatusType.NotNeeded)
      ) {
        document.status = status;
      }
    };
    let desiredStatus;

    // no need university doc
    if (
      updatedStudent.academic_background.university.high_school_isGraduated ===
        'pending' ||
      updatedStudent.academic_background.university.isGraduated === 'No'
    ) {
      desiredStatus = DocumentStatusType.NotNeeded;
    } else {
      desiredStatus = DocumentStatusType.Missing;
    }

    documentsToEnsure.forEach((docName) => {
      ensureDocumentStatus(
        updatedStudent.profile,
        docName,
        ProfileNameType,
        desiredStatus
      );
    });

    let desiredSecondDegreeStatus;

    // no need university doc
    if (
      updatedStudent.academic_background.university.isGraduated === 'pending' ||
      updatedStudent.academic_background.university.isGraduated === 'No' ||
      updatedStudent.academic_background.university.isSecondGraduated ===
        'No' ||
      updatedStudent.academic_background.university.isSecondGraduated === '-'
    ) {
      desiredSecondDegreeStatus = DocumentStatusType.NotNeeded;
    } else {
      desiredSecondDegreeStatus = DocumentStatusType.Missing;
    }
    const secondDegreeDocumentsToEnsure = [
      ProfileNameType.Second_Degree_Certificate,
      ProfileNameType.Second_Degree_Transcript
    ];
    secondDegreeDocumentsToEnsure.forEach((docName) => {
      ensureDocumentStatus(
        updatedStudent.profile,
        docName,
        ProfileNameType,
        desiredSecondDegreeStatus
      );
    });

    const exchangeStatus =
      updatedStudent.academic_background.university.Has_Exchange_Experience ===
      'Yes'
        ? DocumentStatusType.Missing
        : DocumentStatusType.NotNeeded;

    ensureDocumentStatus(
      updatedStudent.profile,
      ProfileNameType.Exchange_Student_Certificate,
      ProfileNameType,
      exchangeStatus
    );

    const internshipStatus =
      updatedStudent.academic_background.university
        .Has_Internship_Experience === 'Yes'
        ? DocumentStatusType.Missing
        : DocumentStatusType.NotNeeded;
    ensureDocumentStatus(
      updatedStudent.profile,
      ProfileNameType.Internship,
      ProfileNameType,
      internshipStatus
    );

    const workExperienceStatus =
      updatedStudent.academic_background.university.Has_Working_Experience ===
      'Yes'
        ? DocumentStatusType.Missing
        : DocumentStatusType.NotNeeded;
    ensureDocumentStatus(
      updatedStudent.profile,
      ProfileNameType.Employment_Certificate,
      ProfileNameType,
      workExperienceStatus
    );

    await updatedStudent.save();

    // TODO: minor: profile field not used for student.
    res.status(200).send({
      success: true,
      data: university,
      profile: updatedStudent.profile
    });
    next();
  } catch (err) {
    logger.error(err);
    throw new ErrorResponse(400, JSON.stringify(err));
  }
});

// (O) email : self notification
const updateLanguageSkill = asyncHandler(async (req, res, next) => {
  const {
    body: { language }
  } = req;
  const { studentId } = req.params;

  language.updatedAt = new Date();

  const updatedStudent = await req.db.model('User').findByIdAndUpdate(
    studentId,
    {
      'academic_background.language': language
    },
    { upsert: true, new: true }
  );

  const profileUpdates = [
    {
      fieldName: 'german_isPassed',
      docName: ProfileNameType.German_Certificate
    },
    {
      fieldName: 'english_isPassed',
      docName: ProfileNameType.Englisch_Certificate
    },
    {
      fieldName: 'gre_isPassed',
      docName: ProfileNameType.GRE
    },
    {
      fieldName: 'gmat_isPassed',
      docName: ProfileNameType.GMAT
    }
  ];

  // Helper function to update document status
  const updateDocumentStatus = (isPassed, docName) => {
    let certificateDoc = updatedStudent.profile.find(
      (doc) => doc.name === docName
    );

    if (isPassed === '--') {
      if (!certificateDoc) {
        certificateDoc = updatedStudent.profile.create({
          name: docName,
          status: DocumentStatusType.NotNeeded,
          required: true,
          updatedAt: new Date(),
          path: ''
        });
        updatedStudent.profile.push(certificateDoc);
      } else if (certificateDoc.status === DocumentStatusType.Missing) {
        certificateDoc.status = DocumentStatusType.NotNeeded;
      }
    } else if (!certificateDoc) {
      certificateDoc = updatedStudent.profile.create({
        name: docName,
        status: DocumentStatusType.Missing,
        required: true,
        updatedAt: new Date(),
        path: ''
      });
      updatedStudent.profile.push(certificateDoc);
    } else if (certificateDoc.status === DocumentStatusType.NotNeeded) {
      certificateDoc.status = DocumentStatusType.Missing;
    }
  };

  // Iterate through each profile update configuration
  profileUpdates.forEach(({ fieldName, docName }) => {
    updateDocumentStatus(
      updatedStudent.academic_background.language[fieldName],
      docName
    );
  });

  await updatedStudent.save();

  res.status(200).send({
    success: true,
    data: updatedStudent.academic_background.language,
    profile: updatedStudent.profile
  });
  next();
});

// (O) email : self notification
const updateApplicationPreferenceSkill = asyncHandler(
  async (req, res, next) => {
    const {
      body: { application_preference }
    } = req;
    const { studentId } = req.params;

    application_preference.updatedAt = new Date();
    const updatedStudent = await UserService.updateUser(req, studentId, {
      application_preference
    });

    res.status(200).send({
      success: true,
      data: updatedStudent.application_preference
    });
    next();
  }
);

// (O) email : self notification
const updatePersonalData = asyncHandler(async (req, res, next) => {
  const {
    params: { user_id },
    body: { personaldata }
  } = req;
  try {
    const updatedStudent = await UserService.updateUser(
      req,
      user_id,
      personaldata
    );
    if (!updatedStudent) {
      logger.error('updatePersonalData: Invalid user');
      throw new ErrorResponse(400, 'Invalid user');
    }
    const {
      firstname,
      firstname_chinese,
      lastname,
      lastname_chinese,
      birthday,
      linkedIn,
      lineId
    } = updatedStudent;
    res.status(200).send({
      success: true,
      data: {
        firstname,
        firstname_chinese,
        lastname,
        lastname_chinese,
        birthday,
        linkedIn,
        lineId
      }
    });
    next();
  } catch (err) {
    logger.error(err);
  }
});

module.exports = {
  updateOfficehours,
  updateCredentials,
  updateAcademicBackground,
  updateLanguageSkill,
  updateApplicationPreferenceSkill,
  updatePersonalData
};
