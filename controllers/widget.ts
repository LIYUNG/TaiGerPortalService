import path from 'path';
import { jsPDF } from 'jspdf';
import { Role } from '@taiger-common/core';

import { asyncHandler } from '../middlewares/error-handler';
import logger from '../services/logger';
import { AWS_S3_BUCKET_NAME } from '../config';
import { font } from '../utils/NotoSansTC-VariableFont_wght-normal';
import { getS3Object, uploadJsonToS3 } from '../aws/s3';
import {
  roleToAssumeForCourseAnalyzerAPIG,
  apiGatewayUrl
} from '../aws/constants';
import { callApiGateway, getTemporaryCredentials } from '../aws';
import CommunicationService from '../services/communications';

const student_name = 'PreCustomer';

const WidgetProcessTranscriptV2 = asyncHandler(async (req, res, _next) => {
  const {
    params: { language },
    body: { courses, requirementIds, factor }
  } = req;

  const { Credentials } = await getTemporaryCredentials(
    roleToAssumeForCourseAnalyzerAPIG
  );

  const stringified_courses = JSON.stringify(JSON.stringify(courses));
  const studentId = req.user._id.toString();
  try {
    // TODO: replacing requirement_ids with data from frontend.
    // TODO: also verify the id.
    const response = await callApiGateway(Credentials, apiGatewayUrl, 'POST', {
      courses: stringified_courses,
      student_id: studentId,
      student_name,
      language,
      factor: factor || 1.5,
      courses_taiger_guided: '"[]"',
      requirement_ids: JSON.stringify(requirementIds)
    });

    await uploadJsonToS3(
      response.result,
      AWS_S3_BUCKET_NAME,
      `${studentId}/analysed_transcript_${student_name}.json`
    );
    const metadata = {
      analysis: { isAnalysedV2: false, pathV2: '', updatedAt: new Date() }
    };
    metadata.analysis.isAnalysedV2 = true;
    const fileKey = path
      .join(studentId, `analysed_transcript_${student_name}.json`)
      .replace(/\\/g, '/');

    metadata.analysis.pathV2 = fileKey;

    res.status(200).send({ success: true, data: metadata.analysis });
  } catch (error) {
    res.status(403).send({ message: error });
  }
});

const WidgetdownloadJson = asyncHandler(async (req, res, next) => {
  const {
    params: { adminId }
  } = req;

  const fileKey = path
    .join(adminId, `analysed_transcript_${student_name}.json`)
    .replace(/\\/g, '/');

  logger.info(`Trying to download transcript json file ${fileKey}`);

  const analysedJson = await getS3Object(AWS_S3_BUCKET_NAME, fileKey);
  const jsonString = Buffer.from(analysedJson).toString('utf-8');
  const jsonData = JSON.parse(jsonString);
  const fileKey_converted = encodeURIComponent(fileKey); // Use the encoding necessary

  res
    .status(200)
    .send({ success: true, json: jsonData, fileKey: fileKey_converted });
  next();
});

// Export messages as pdf
const WidgetExportMessagePDF = asyncHandler(async (req, res, _next) => {
  const {
    params: { studentId }
  } = req;
  const doc = new jsPDF('p', 'pt', 'a4', true);
  const communication_thread =
    await CommunicationService.getByStudentIdForExport(studentId);

  let currentY = 40; // Initial y position, leaving space for headers
  const lineHeight = 14; // Line height for spacing between lines
  const pageHeight = doc.internal.pageSize.height; // Get page height
  const pageWidth = doc.internal.pageSize.width; // Get page width

  doc.addFileToVFS('NotoSansTC-VariableFont_wght-normal.ttf', font);
  doc.addFont(
    'NotoSansTC-VariableFont_wght-normal.ttf',
    'NotoSansTC-VariableFont_wght-normal',
    'normal'
  );
  // Set font size for the document
  doc.setFontSize(12); // Set font size to 12 points
  doc.setFont('NotoSansTC-VariableFont_wght-normal');
  communication_thread
    .map((thread) => {
      try {
        const { user_id } = thread;
        const userName = `${user_id.firstname} ${user_id.lastname}${
          user_id.role === Role.Student
            ? `(${user_id.firstname_chinese} ${user_id.lastname_chinese})`
            : ''
        }`;
        const { message, createdAt } = thread;
        const textContent = message?.replace(/<[^>]+>/g, ''); // Strip HTML tags
        const messageObj = textContent ? JSON.parse(textContent) : '';
        const messageConcat =
          messageObj.blocks
            ?.map((block) =>
              block?.type === 'paragraph' ? block.data?.text : ''
            )
            .join('')
            .replace(/<\/?[^>]+(>|$)|&[^;]+;?/g, '') || '';

        // Split text into lines that fit within page width
        const createdAtFormatted = new Date(createdAt).toLocaleString();
        const lines = doc.splitTextToSize(
          `${createdAtFormatted}: ${userName}: ${messageConcat}`,
          pageWidth - 40
        ); // Leave some margin

        // Check if there is enough space on the current page
        if (currentY + lineHeight > pageHeight - 40) {
          // Leave some margin at the bottom for safety
          doc.addPage(); // Add a new page
          currentY = 40; // Reset y position
        }
        // Add text to the PDF
        doc.text(lines, 40, currentY);
        // Update currentY position
        currentY += lineHeight * lines.length + 10; // Increase y position by total height of added text
      } catch (e) {
        logger.error('WidgetExportMessagePDF: Error parsing JSON:', e);
        return ''; // Return an empty string or handle the error as needed
      }
    })
    .join('\n');

  // Get the PDF data as a Uint8Array
  const pdfData = doc.output('arraybuffer');

  // Set the response content type to application/pdf
  res.contentType('application/pdf');
  res.send(Buffer.from(pdfData));
  logger.info('Export messages for student Id : studentId successfully.');
});

export = {
  WidgetProcessTranscriptV2,
  WidgetdownloadJson,
  WidgetExportMessagePDF
};
