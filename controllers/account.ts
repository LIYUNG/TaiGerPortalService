// const path = require('path');
import { ProfileNameType } from '@taiger-common/core';
import { DocumentStatusType } from '@taiger-common/model';

import { ErrorResponse } from '../common/errors';
import { asyncHandler } from '../middlewares/error-handler';
import { updateCredentialsEmail } from '../services/email';
import logger from '../services/logger';
import StudentService from '../services/students';
import UserService from '../services/users';

// Live Student document type (with .profile DocumentArray + .save()) as returned
// by the student DAO. updateUserDoc() resolves to the base IUser union (Student
// discriminator fields like `profile`/`academic_background` are not visible on
// it), but at runtime it is a Student doc — narrow to this for those fields.
type StudentDoc = NonNullable<
  Awaited<ReturnType<typeof StudentService.getStudentDocByIdPopulated>>
>;
type StudentProfileArray = StudentDoc['profile'];
type StudentProfileItem = StudentProfileArray[number];

// After an upsert that writes academic_background.university / .language, those
// fields are guaranteed present on the returned doc. Narrow to a shape where
// they are non-optional so the post-write reads don't surface as TS18049.
type AcademicBackground = NonNullable<StudentDoc['academic_background']>;
type StudentDocWithBackground = StudentDoc & {
  academic_background: AcademicBackground & {
    university: NonNullable<AcademicBackground['university']>;
    language: NonNullable<AcademicBackground['language']>;
  };
};

// (O) email : self notification
export const updateCredentials = asyncHandler(async (req, res) => {
  const {
    user,
    body: { credentials }
  } = req;
  const userExisted = await UserService.updateUser(user._id.toString(), {
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
});

export const updateOfficehours = asyncHandler(async (req, res) => {
  const {
    user,
    body: { officehours, timezone }
  } = req;
  // officehours/timezone are Agent/Editor discriminator fields — cast against
  // the role's model so strict-mode doesn't strip them on a base-model update.
  await UserService.updateOfficehours(user._id.toString(), user.role, {
    officehours,
    timezone
  });

  res.status(200).send({
    success: true
  });
});

// Helper function to normalize university name
export const normalizeName = (name: unknown) => {
  if (!name || typeof name !== 'string') return name;
  return name.trim().replace(/\s+/g, ' '); // Replace multiple spaces with single space
};

// (O)  email : self notification
export const updateAcademicBackground = asyncHandler(async (req, res) => {
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
    const updatedStudentDoc = await UserService.updateUserDoc(
      studentId,
      {
        'academic_background.university': university
      },
      { new: true }
    );
    if (!updatedStudentDoc) {
      throw new ErrorResponse(404, 'Student not found');
    }
    // updateUserDoc resolves to the base IUser union; at runtime this is the
    // Student discriminator doc, so narrow it to expose profile/academic_background.
    const updatedStudent =
      updatedStudentDoc as unknown as StudentDocWithBackground;

    // TODO: update base documents needed or not:
    const documentsToEnsure = [
      ProfileNameType.Bachelor_Certificate,
      ProfileNameType.Bachelor_Transcript,
      ProfileNameType.Course_Description,
      ProfileNameType.Employment_Certificate,
      ProfileNameType.ECTS_Conversion
    ];
    const ensureDocumentStatus = (
      studentProfile: StudentProfileArray,
      docName: ProfileNameType,
      profileNameList: typeof ProfileNameType,
      status: DocumentStatusType
    ) => {
      // For this string enum, key === value, so indexing by the value yields the
      // same label string (preserves the original runtime lookup).
      const docLabel = profileNameList[docName as keyof typeof profileNameList];
      let document = studentProfile.find(
        (doc: StudentProfileItem) => doc.name === docLabel
      );
      if (!document) {
        document = studentProfile.create({ name: docLabel });
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
  } catch (err) {
    logger.error(err as string);
    throw new ErrorResponse(400, JSON.stringify(err));
  }
});

// (O) email : self notification
export const updateLanguageSkill = asyncHandler(async (req, res) => {
  const {
    body: { language }
  } = req;
  const { studentId } = req.params;

  language.updatedAt = new Date();

  const updatedStudentDoc = await UserService.updateUserDoc(
    studentId,
    {
      'academic_background.language': language
    },
    { upsert: true, new: true }
  );
  if (!updatedStudentDoc) {
    throw new ErrorResponse(404, 'Student not found');
  }
  const updatedStudent =
    updatedStudentDoc as unknown as StudentDocWithBackground;

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
  const updateDocumentStatus = (
    isPassed: unknown,
    docName: ProfileNameType
  ) => {
    let certificateDoc = updatedStudent.profile.find(
      (doc: StudentProfileItem) => doc.name === docName
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
    const languageRecord = updatedStudent.academic_background
      .language as Record<string, unknown>;
    updateDocumentStatus(languageRecord[fieldName], docName);
  });

  await updatedStudent.save();

  res.status(200).send({
    success: true,
    data: updatedStudent.academic_background.language,
    profile: updatedStudent.profile
  });
});

// (O) email : self notification
export const updateApplicationPreferenceSkill = asyncHandler(
  async (req, res) => {
    const {
      body: { application_preference }
    } = req;
    const { studentId } = req.params;

    application_preference.updatedAt = new Date();
    const updatedStudent = await UserService.updateUser(studentId, {
      application_preference
    });
    if (!updatedStudent) {
      throw new ErrorResponse(404, 'Student not found');
    }

    res.status(200).send({
      success: true,
      data: updatedStudent.application_preference
    });
  }
);

// (O) email : self notification
export const updatePersonalData = asyncHandler(async (req, res) => {
  const {
    params: { user_id },
    body: { personaldata }
  } = req;
  try {
    const updatedStudent = await UserService.updateUser(user_id, personaldata);
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
      lineId,
      slackId
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
        lineId,
        slackId
      }
    });
  } catch (err) {
    logger.error(err as string);
  }
});
