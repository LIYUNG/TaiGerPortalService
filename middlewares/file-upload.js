const path = require('path');
const _ = require('lodash');
const multer = require('multer');
const multerS3 = require('multer-s3');
const uuid = require('uuid');
const { ErrorResponse } = require('../common/errors');
const { AWS_S3_BUCKET_NAME, AWS_S3_PUBLIC_BUCKET_NAME } = require('../config');
const { s3Client } = require('../aws');
const StudentService = require('../services/students');

const MAX_FILE_SIZE_MB = 2 * 1024 * 1024; // 2 MB
const MAX_DOC_FILE_SIZE_MB = 1 * 1024 * 1024; // 1 MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpg',
  'image/jpeg',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const ALLOWED_MIME_PDF_TYPES = ['application/pdf'];

const ALLOWED_MIME_IMAGE_TYPES = ['image/png', 'image/jpg', 'image/jpeg'];

const formatDate = (date) => {
  const pad = (number) => number.toString().padStart(2, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1); // Months are zero-indexed
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  return `${year}-${month}-${day}-${hours}-${minutes}-${seconds}`;
};

const fileSizeFilter = (req, size, cb) => {
  const fileSize = parseInt(req.headers['content-length'], 10);
  if (fileSize > size) {
    return cb(
      new ErrorResponse(
        413,
        `您的檔案不得超過 ${
          size / (1024 * 1024)
        } MB / File size is limited to ${size / (1024 * 1024)} MB!`
      )
    );
  }
};

const threadFileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new ErrorResponse(
        415,
        'Only .xls .xlsx .xlsm .pdf .png, .jpg and .jpeg .docx format are allowed!'
      )
    );
  }
  fileSizeFilter(req, MAX_DOC_FILE_SIZE_MB, cb);
  cb(null, true);
};

const docFileFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(
      new ErrorResponse(
        415,
        'Only .xls .xlsx .xlsm .pdf .png, .jpg and .jpeg .docx format are allowed!'
      )
    );
  }
  fileSizeFilter(req, MAX_FILE_SIZE_MB, cb);

  cb(null, true);
};

const filterProfile = (req, file, cb) => {
  const { category } = req.params;
  if (category === 'Passport_Photo') {
    if (!ALLOWED_MIME_IMAGE_TYPES.includes(file.mimetype)) {
      return cb(
        new ErrorResponse(415, 'Only .png, .jpg and .jpeg format are allowed')
      );
    }
  } else if (!ALLOWED_MIME_PDF_TYPES.includes(file.mimetype)) {
    return cb(new ErrorResponse(415, 'Only .pdf format are allowed'));
  }

  fileSizeFilter(req, MAX_FILE_SIZE_MB, cb);

  cb(null, true);
};

const fileImageFilter = (req, file, cb) => {
  if (!ALLOWED_MIME_IMAGE_TYPES.includes(file.mimetype)) {
    return cb(
      new ErrorResponse(415, 'Only .png, .jpg and .jpeg format are allowed')
    );
  }

  fileSizeFilter(req, MAX_FILE_SIZE_MB, cb);

  cb(null, true);
};

// Template file upload
const template_storage_s3 = multerS3({
  s3: s3Client,
  bucket: (req, file, cb) => {
    cb(null, AWS_S3_PUBLIC_BUCKET_NAME);
  },
  metadata: (req, file, cb) => {
    const directory = 'taiger_template';
    cb(null, { fieldName: file.fieldname, path: directory });
  },
  key: (req, file, cb) => {
    const { category_name } = req.params;
    let temp_name = `${category_name}_TaiGer_Template${path.extname(
      file.originalname
    )}`;
    temp_name = temp_name.replace(/\//g, '_');

    cb(null, `taiger_template/${temp_name}`);
  }
});
// upload template pdf/docx/image
const upload_template_s3 = multer({
  storage: template_storage_s3,
  limits: { fileSize: MAX_FILE_SIZE_MB },
  fileFilter: docFileFilter
});

// VPD file upload
const storage_vpd_s3 = multerS3({
  s3: s3Client,
  bucket: (req, file, cb) => {
    cb(null, AWS_S3_BUCKET_NAME);
  },
  metadata: (req, file, cb) => {
    let { studentId } = req.params;
    // eslint-disable-next-line no-underscore-dangle
    if (!studentId) studentId = String(req.user._id);

    // TODO: check studentId exist
    let directory = path.join(studentId);
    directory = directory.replace(/\\/g, '/');
    cb(null, { fieldName: file.fieldname, path: directory });
  },
  key: (req, file, cb) => {
    const { applicationId, fileType } = req.params;

    req.db
      .model('Application')
      .findById(applicationId)
      .populate('studentId')
      .populate('programId')
      .then((application) => {
        const program_name = `${application?.programId?.school} ${application?.programId?.program_name}`;
        let temp_name = `${application?.studentId?.lastname}_${
          application?.studentId?.firstname
        }_${program_name}_${fileType}${path.extname(file.originalname)}`;
        temp_name = temp_name.replace(/ /g, '_');
        temp_name = temp_name.replace(/\//g, '_');
        cb(null, `${application?.studentId?._id?.toString()}/${temp_name}`);
      });
  }
});

// Profile file upload
const storage_profile_s3 = multerS3({
  s3: s3Client,
  bucket: (req, file, cb) => {
    cb(null, AWS_S3_BUCKET_NAME);
  },
  metadata: (req, file, cb) => {
    let { studentId } = req.params;
    // eslint-disable-next-line no-underscore-dangle
    if (!studentId) studentId = String(req.user._id);

    // TODO: check studentId exist
    const directory = studentId;
    cb(null, { fieldName: file.fieldname, path: directory });
  },
  key: async (req, file, cb) => {
    try {
      const { studentId } = req.params;
      if (!studentId) return cb(new Error('Missing studentId'));

      const student = await StudentService.getStudentById(req, studentId);

      if (!student) return cb(new Error('Student not found'));

      const fileName = `${student.lastname}_${student.firstname}_${
        req.params.category
      }${path.extname(file.originalname).toLowerCase()}`
        .replace(/ /g, '_')
        .replace(/\//g, '_');

      cb(null, `${studentId}/${fileName}`);
    } catch (error) {
      cb(error);
    }
  }
});

const doc_image_s3 = multerS3({
  s3: s3Client,
  bucket: (req, file, cb) => {
    cb(null, AWS_S3_PUBLIC_BUCKET_NAME);
  },
  metadata: (req, file, cb) => {
    const directory = 'Documentations';
    cb(null, { fieldName: file.fieldname, path: directory });
  },
  key: (req, file, cb) => {
    const id = uuid.v4();
    const fileName = id + path.extname(file.originalname);
    cb(null, `Documentations/${fileName}`);
  }
});

const doc_docs_s3 = multerS3({
  s3: s3Client,
  bucket: (req, file, cb) => {
    cb(null, AWS_S3_PUBLIC_BUCKET_NAME);
  },
  metadata: (req, file, cb) => {
    cb(null, { fieldName: file.fieldname, path: '' });
  },
  key: (req, file, cb) => {
    const fileName = file.originalname;
    cb(null, `Documentations/${fileName}`);
  }
});

const admission_letter_s3 = multerS3({
  s3: s3Client,
  bucket: (req, file, cb) => {
    cb(null, AWS_S3_BUCKET_NAME);
  },
  metadata: (req, file, cb) => {
    const { studentId } = req.params;
    let directory = path.join(studentId, 'admission');
    directory = directory.replace(/\\/g, '/'); // g>> replace all!
    cb(null, { fieldName: file.fieldname, path: directory });
  },
  key: (req, file, cb) => {
    const { studentId, programId, result } = req.params;
    const admission_status = result === 'O' ? 'Admission' : 'Rejection';

    req.db
      .model('Student')
      .findById(studentId)
      .then((student) => {
        if (student) {
          req.db
            .model('Program')
            .findById(programId)
            .then((program) => {
              const program_name = `${program?.school} ${program?.program_name} ${program?.degree} ${program?.semester}`;
              let temp_name = `${student.lastname}_${
                student.firstname
              }_${program_name}_${admission_status}${path.extname(
                file.originalname
              )}`;
              temp_name = temp_name.replace(/ /g, '_');
              temp_name = temp_name.replace(/\//g, '_');
              cb(null, `${studentId}/admission/${temp_name}`);
            });
        }
      });
  }
});

const upload_admission_letter_s3 = multer({
  storage: admission_letter_s3,
  limits: { fileSize: MAX_FILE_SIZE_MB },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_PDF_TYPES.includes(file.mimetype)) {
      return cb(new ErrorResponse(415, 'Only .pdf format is allowed'));
    }
    fileSizeFilter(req, MAX_FILE_SIZE_MB, cb);

    cb(null, true);
  }
});

const upload_doc_image_s3 = multer({
  storage: doc_image_s3,
  limits: { fileSize: MAX_FILE_SIZE_MB },
  fileFilter: fileImageFilter
});

const upload_doc_docs_s3 = multer({
  storage: doc_docs_s3,
  limits: { fileSize: MAX_FILE_SIZE_MB },
  fileFilter: docFileFilter
});

const upload_vpd_s3 = multer({
  storage: storage_vpd_s3,
  limits: { fileSize: MAX_FILE_SIZE_MB },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME_PDF_TYPES.includes(file.mimetype)) {
      return cb(new ErrorResponse(415, 'Only .pdf format is allowed'));
    }

    fileSizeFilter(req, MAX_FILE_SIZE_MB, cb);

    cb(null, true);
  }
});

/**
 * currently used by route
 *   /account/files/:studentId/:docName (student upload)
 */

const upload_profile_s3 = multer({
  storage: storage_profile_s3,
  limits: { fileSize: MAX_FILE_SIZE_MB },
  fileFilter: filterProfile
});

// Message ticket files upload
const storage_messagesticket_file_s3 = multerS3({
  s3: s3Client,
  bucket: (req, file, cb) => {
    cb(null, AWS_S3_BUCKET_NAME);
  },
  metadata: (req, file, cb) => {
    const { ticketId, studentId } = req.params;
    // TODO: check studentId and ticketId exist
    let directory = path.join(studentId, ticketId);
    directory = directory.replace(/\\/g, '/'); // g>> replace all!
    cb(null, { fieldName: file.fieldname, path: directory });
  },
  key: (req, file, cb) => {
    const { studentId, ticketId } = req.params;
    req.db
      .model('Complaint')
      .findById(ticketId)
      .populate('requester_id')
      .then((ticket) => {
        if (!ticket) {
          throw new ErrorResponse(404, 'Thread not found');
        }
        const date = new Date();
        const formattedDate = formatDate(date);
        const temp_name = `${ticket.requester_id.lastname}_${
          ticket.requester_id.firstname
        }_Ticket_Attachment_${formattedDate}${path.extname(file.originalname)}`;

        cb(null, `${studentId}/${ticketId}/${temp_name}`);
      });
  }
});

// Message thread file upload (general)
const storage_messagesthread_file_s3 = multerS3({
  s3: s3Client,
  bucket: (req, file, cb) => {
    cb(null, AWS_S3_BUCKET_NAME);
  },
  metadata: (req, file, cb) => {
    const { messagesThreadId, studentId } = req.params;
    // TODO: check studentId and messagesThreadId exist
    let directory = path.join(studentId, messagesThreadId);
    directory = directory.replace(/\\/g, '/'); // g>> replace all!
    cb(null, { fieldName: file.fieldname, path: directory });
  },
  key: (req, file, cb) => {
    const { studentId, messagesThreadId } = req.params;
    req.db
      .model('Documentthread')
      .findById(messagesThreadId)
      .populate('student_id')
      .then((thread) => {
        if (!thread) {
          throw new ErrorResponse(404, 'Thread not found');
        }
        let program_name = '';
        if (thread.program_id) {
          req.db
            .model('Program')
            .findById(thread.program_id)
            .then((program) => {
              program_name = `${program?.school}_${program?.program_name}`;
              let version_number_max = 0;

              thread.messages.forEach((message) => {
                message.file.forEach((file_data) => {
                  let fileversion = 0;
                  const lastPart = _.last(file_data.name.split('_'));
                  fileversion = parseInt(lastPart.replace(/[^\d]/g, ''), 10);

                  if (fileversion > version_number_max) {
                    version_number_max = fileversion; // get the max version number
                  }
                });
              });

              const version_number = parseInt(version_number_max, 10) + 1;
              let temp_name = `${thread.student_id?.lastname}_${
                thread.student_id?.firstname
              }_${program_name}_${
                thread.file_type
              }_v${version_number.toString()}${path
                .extname(file.originalname)
                .toLowerCase()}`;
              temp_name = temp_name.replace(/ /g, '_');
              temp_name = temp_name.replace(/\//g, '_');

              cb(null, `${studentId}/${messagesThreadId}/${temp_name}`);
            });
        } else {
          let version_number_max = 0;

          thread.messages.forEach((message) => {
            message.file.forEach((file_data) => {
              let fileversion = 0;
              fileversion = parseInt(file_data.name.replace(/[^\d]/g, ''), 10);

              if (fileversion > version_number_max) {
                version_number_max = fileversion; // get the max version number
              }
            });
          });

          const version_number = parseInt(version_number_max, 10) + 1;
          let temp_name = `${thread.student_id?.lastname}_${
            thread.student_id?.firstname
          }_${thread.file_type}_v${version_number.toString()}${path.extname(
            file.originalname
          )}`;
          temp_name = temp_name.replace(/ /g, '_');
          temp_name = temp_name.replace(/\//g, '_');
          cb(null, `${studentId}/${messagesThreadId}/${temp_name}`);
        }
      });
  }
});

const storage_messagesChat_file_s3 = multerS3({
  s3: s3Client,
  bucket: (req, file, cb) => {
    cb(null, AWS_S3_BUCKET_NAME);
  },
  metadata: (req, file, cb) => {
    const { studentId } = req.params;
    // TODO: check studentId  exist
    let directory = path.join(studentId, 'chat');
    directory = directory.replace(/\\/g, '/'); // g>> replace all!
    cb(null, { fieldName: file.fieldname, path: directory });
  },
  key: (req, file, cb) => {
    const { studentId } = req.params;

    const date = new Date();
    const formattedDate = formatDate(date);
    req.db
      .model('Student')
      .findById(studentId)
      .then((student) => {
        let temp_name = `${student.lastname}_${
          student.firstname
        }_Attachment_${formattedDate}${path.extname(file.originalname)}`;
        temp_name = temp_name.replace(/ /g, '_');
        temp_name = temp_name.replace(/\//g, '_');
        cb(null, `${studentId}/chat/${temp_name}`);
      });
  }
});

// Message thread image upload (general)
const storage_messagesthread_image_s3 = multerS3({
  s3: s3Client,
  bucket: (req, file, cb) => {
    cb(null, AWS_S3_BUCKET_NAME);
  },
  metadata: (req, file, cb) => {
    const { messagesThreadId, studentId } = req.params;
    let directory = path.join(studentId, messagesThreadId);
    directory = directory.replace(/\\/g, '/'); // g>> replace all!
    cb(null, { fieldName: file.fieldname, path: directory });
  },
  key: (req, file, cb) => {
    const { messagesThreadId, studentId } = req.params;
    const id = uuid.v4();
    const fileName = id + path.extname(file.originalname);
    cb(null, `${studentId}/${messagesThreadId}/img/${fileName}`);
  }
});
const upload_messagesticket_file_s3 = multer({
  storage: storage_messagesticket_file_s3,
  limits: { fileSize: MAX_DOC_FILE_SIZE_MB },
  fileFilter: threadFileFilter
});

const upload_messagesthread_file_s3 = multer({
  storage: storage_messagesthread_file_s3,
  limits: { fileSize: MAX_DOC_FILE_SIZE_MB },
  fileFilter: threadFileFilter
});

const upload_messagesChat_file_s3 = multer({
  storage: storage_messagesChat_file_s3,
  limits: { fileSize: MAX_DOC_FILE_SIZE_MB },
  fileFilter: threadFileFilter
});

const upload_messagesthread_image_s3 = multer({
  storage: storage_messagesthread_image_s3,
  limits: { fileSize: MAX_FILE_SIZE_MB },
  fileFilter: fileImageFilter
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'upload/');
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });

module.exports = {
  imageUpload: upload_doc_image_s3.single('file'),
  admissionUpload: upload_admission_letter_s3.single('file'),
  documentationDocsUpload: upload_doc_docs_s3.single('file'),
  VPDfileUpload: upload_vpd_s3.single('file'),
  ProfilefileUpload: upload_profile_s3.single('file'),
  TemplatefileUpload: upload_template_s3.single('file'),
  MessagesThreadUpload: upload_messagesthread_file_s3.array('files'),
  MessagesTicketUpload: upload_messagesticket_file_s3.array('files'),
  MessagesChatUpload: upload_messagesChat_file_s3.array('files'),
  MessagesImageThreadUpload: upload_messagesthread_image_s3.single('file'),
  upload: upload.single('file')
};
