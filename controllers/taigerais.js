const path = require('path');
const async = require('async');
const { spawn } = require('child_process');
const { Role } = require('@taiger-common/core');

const { ErrorResponse } = require('../common/errors');
const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');
const { ProgramAI } = require('../models/ProgramAI');
const { isProd } = require('../config');
const { openAIClient, OpenAiModel } = require('../services/openai');
const { generalMLPrompt } = require('../prompt/ml_prompt');
const { FILE_MAPPING_TABLE } = require('../constants');
const { generalRLPrompt } = require('../prompt/rl_prompt');
const ApplicationService = require('../services/applications');

const pageSize = 3;

const processProgramListAi = asyncHandler(async (req, res, next) => {
  const {
    params: { programId }
  } = req;
  const program = await req.db
    .model('Program')
    .findOne({ _id: programId })
    .lean();
  const programai = await ProgramAI.findOne({ program_id: programId }).lean();
  if (!program) {
    logger.error('no program found!');
    return res.send({ success: true, data: {} });
  }

  const python_command = isProd() ? 'python3' : 'python';
  const python = spawn(
    python_command,
    ['program_info.py', program.school, program.program_name, program.degree],
    {
      stdio: 'inherit',
      cwd: `${__dirname}/../python/TaiGerProgramListAICrawler/app`
    }
  );
  python.on('data', (data) => {
    logger.info(`${data}`);
  });
  python.on('error', (err) => {
    logger.info('error');
    logger.info(err);
  });

  python.on('close', (code) => {
    if (code === 0) {
      res.status(200).send({ success: true });
    } else {
      res.status(403).send({ message: code });
    }
  });
});

const generate = asyncHandler(async (input, model) => {
  logger.info(`model = ${model}`);
  const response = await openAIClient.chat.completions.create({
    messages: [{ role: 'user', content: input || 'where is BMW Headquarter?' }],
    model
  });
  return response.choices[0]?.message;
});

const generate_streaming = asyncHandler(async (input, model) =>
  openAIClient.chat.completions.create({
    messages: [{ role: 'user', content: input || 'where is BMW Headquarter?' }],
    model: OpenAiModel.GPT_3_5_TURBO,
    stream: true
  })
);

const TaiGerAiGeneral = asyncHandler(async (req, res, next) => {
  const { prompt, model } = req.body;
  const stream = await generate_streaming(
    prompt,
    model || OpenAiModel.GPT_3_5_TURBO
  );
  for await (const part of stream) {
    res.write(part.choices[0]?.delta.content || '');
  }
  res.end();
});

const TaiGerAiChat = asyncHandler(async (req, res, next) => {
  const {
    user,
    params: { studentId }
  } = req;

  const communication_thread = await req.db
    .model('Communication')
    .find({
      student_id: studentId
    })
    .populate('student_id user_id', 'firstname lastname role')
    .sort({ createdAt: -1 }) // 0: latest!
    .limit(pageSize)
    .lean(); // show only first y limit items after skip.
  const applications = await ApplicationService.getApplicationsByStudentId(
    req,
    studentId
  );
  const chat = communication_thread?.map((c) => {
    try {
      const messageObj = JSON.parse(c.message);
      return {
        createdAt: c.createdAt,
        user: c.user_id?.firstname || '',
        role: c.user_id?.role,
        message:
          messageObj.blocks
            .map((block) =>
              block?.type === 'paragraph' ? block.data?.text : ''
            )
            .join('')
            .replace(/<\/?[^>]+(>|$)|&[^;]+;?/g, '') || ''
      };
    } catch (e) {
      logger.error('Error parsing JSON:', e);
      return ''; // Return an empty string or handle the error as needed
    }
  });
  const latestStudentMessage = chat?.filter((c) => c.role === Role.Student)[0];
  const pmp = `
  Your name is ${
    user.firstname
  } and is study assistant helping a student with their academic queries. Your responses should be informative, clear, and professional, aiming to provide accurate answers and guidance. 
  Be friendly and encouraging to promote a positive learning environment.
  Please reply the Student's latest Message:
   ${JSON.stringify(latestStudentMessage)}

  based on the context ${chat}

  Instructions:
 
  Your are a professional study-in-Germany agent and you know the application process very well. 
  Please according to the following chat history and create a professional response: ${JSON.stringify(
    chat
  )}. 
  Please provide the response concisely and in detail and simple in Markdown language and based on the most recent messages from the Student (user_id: ${studentId}). 
  And please use student's language as reponse. 
  If they use Traditional Chinese then use Tranditional Chinese. Please avoid using simple Chinese as it is not suitable for Taiwanese students.
  
  Here are some resources if student ansk for the topics related to below, you can provide the link to them:
  1. if students ask how to apply German study visa, here is the link: https://taigerconsultancy-portal.com/docs/search/66117ff177802f1278b6104c
  1.1. if students ask how to fill the online application form for German visa, here is the link: https://taigerconsultancy-portal.com/docs/search/64cf9dfc2d7b7e4d58219415
  2. if students ask how to make an appointment with Deutsches Institut Taipeh for applying visa, here is the link: https://taigerconsultancy-portal.com/docs/search/64c04b3522adb5d6aad94caf
  3. if students ask how to apply Expatrio blocked account (限制提領帳戶), here is the link: https://taigerconsultancy-portal.com/docs/search/64825ca787c9c3e88237351d
  4. if students ask how to apply Switzerland study visa, here is the link: https://taigerconsultancy-portal.com/docs/search/6611756177802f1278b601cf
  5. if students ask how to apply VPD or how to use uni-assist, here is the link: https://taigerconsultancy-portal.com/docs/uniassist
  6. if students ask how to prepare motivation letter (ML in our acronym), here is the link: https://taigerconsultancy-portal.com/docs/search/6383200c766614178d7f978f
  7. if students ask how to prepare Curriculum Vitae (CV in our acronym), here is the link: https://taigerconsultancy-portal.com/docs/search/6379767530243f127d431613
  8. if students ask how to prepare Recommendation letter with Professors (RL in our acronym), here is the link: https://taigerconsultancy-portal.com/docs/search/63832557766614178d7f982b
  9. if students ask how to prepare Recommendation letter with Manager or Boss (RL in our acronym), here is the link: https://taigerconsultancy-portal.com/docs/search/645f4ac8e4452f90ced998ce
  10. if students ask how to prepare essay, here is the link: https://taigerconsultancy-portal.com/docs/search/638b4f82d495bd2198261f7b
  11: if students ask how to prepare cerified copies for German universities (德國學校要求之影本驗證): https://taigerconsultancy-portal.com/docs/search/6381d2e0766614178d7f95bb
  12. if students ask how to book agent's office hour, here is the link: https://taigerconsultancy-portal.com/docs/search/64fe21bcbc729bc024d14738
  13. if students ask how to use jitsi meet, here is the link: https://taigerconsultancy-portal.com/docs/search/64eb25ec89ea0d1fcb39df73
  14. if students ask how interview training works or how to request an interview training in the portal, here is the link: https://taigerconsultancy-portal.com/docs/search/664cf3260664445ad3abe3a3
  

  if students ask how to prepare the Documents, here are the requirements and links for:
  1. passport: https://taigerconsultancy-portal.com/docs/search/6379715430243f127d4315a6
  2. bachelor or master's diploma: https://taigerconsultancy-portal.com/docs/search/6381c95a766614178d7f94bc
  3. bachelor or master's graduate certificate: https://taigerconsultancy-portal.com/docs/search/6381c389766614178d7f94a3
  4. ECTS Conversion document: https://taigerconsultancy-portal.com/docs/search/6381cfe8766614178d7f959b
  5. bachelor or master's transcript: https://taigerconsultancy-portal.com/docs/search/6381cd11766614178d7f9555
  6. GSAT(學測)/TVE 統測成績單: https://taigerconsultancy-portal.com/docs/search/6381d070766614178d7f95a8
  7. Course description / Module Description: https://taigerconsultancy-portal.com/docs/search/63b9c5fe045871fbf1cc01ba
  8. TOEFL, IELTS report: https://taigerconsultancy-portal.com/docs/search/63b9c52e045871fbf1cc016c
  9. High school diploma: https://taigerconsultancy-portal.com/docs/search/63e0e62d1dd60644058853e7
  10. High school transcrpt : https://taigerconsultancy-portal.com/docs/search/63e0e7a51dd6064405885476
  11: Grading System, grade conversion table: https://taigerconsultancy-portal.com/docs/search/63d841d2603c4c625d4b3b83

  Please try to provide the link as reference. These links contain important information for each document that can help student upload the file correctly.

  if students ask for their application documents (listed in the following) for their applications, here are their application information, including detailed requirement:
  The student's application information ${JSON.stringify(applications)}
  1. Motivation Letter (ML) (ML requirement is in conrresponding application.programId.ml_requirement if ml_required is true, means ML is required)
  2. Recommendation letter requirements (RL requirement is in conrresponding application.programId.rl_requirement if rl_required is the number of recommendation letters needed, means RL is required)
  3. Supplementary Form (Supplementary Form requirement is in conrresponding application.programId.supplementary_form_requirements if supplementary_form_required is true, means Supplementary Form is required)
  4. Curriculum Analysis (Curriculum Analysis requirement is in conrresponding application.programId.curriculum_analysis_requirements if curriculum_analysis_required is true, means Curriculum Analysis is required)
  5. Portfolio (Portfolio requirement is in conrresponding application.programId.portfolio_requirements if portfolio_required is true, means Portfolio is required)
  6. Program English Test (IELTS, TOEFL) requirements questions, please check programId.toefl, programId.ielts above (as well as toefl_reading, toefl.listening, toefl.writing, toefl.speaking, ielts_reading, ielts.listening, ielts.writing, ielts.speaking)
  7. If it is related to university's application portal or uni-assist or hochschulestart (see in programId.application_portal_a and programId.application_portal_b), please guide them with programId.application_portal_a_instructions and programId.application_portal_b_instructions
  8. Provide the information mentioned in application.programId and try to summarize the information to them.
  Based on instruction above, please first try to use the provided information from the corresponding application.programId, and summarize it to the student.

  Please don't provide all links or instructions, but only relavant ones. If none of above mataches, please answer the student based on your best professional knowledge.
  `;

  const stream = await generate_streaming(pmp, OpenAiModel.GPT_4_o);
  logger.info(pmp);
  let tokenCount = 0;

  for await (const part of stream) {
    const content = part.choices[0]?.delta.content || '';
    res.write(content);
    // Estimate tokens in the current part
    tokenCount += countTokens(content);
  }
  res.end();

  logger.info(
    `Total tokens used: ${tokenCount} , by ${
      user.firstname
    }, user id: ${user._id.toString()}`
  );

  // res.status(200).send({ success: true, data: chat });
  const permission = await req.db.model('Permission').findOne({
    user_id: user._id
  });
  if (permission.taigerAiQuota > 0) {
    permission.taigerAiQuota -= 1;
    await permission.save();
  }
});

const countTokens = (text) => {
  // Implement a function to count tokens based on your tokenizer
  // This is a simple approximation, and you should replace it with an accurate tokenizer
  return text.split(' ').length;
};

const cvmlrlAi = asyncHandler(async (req, res, next) => {
  const { user } = req;
  const {
    student_input,
    document_requirements,
    editor_requirements,
    program_full_name,
    file_type,
    student_id
  } = req.body;
  const parsed_editor_requirements = JSON.parse(editor_requirements);
  let student_info = {};

  try {
    const student = await req.db.model('Student').findById(student_id);
    student_info = {
      firstname: student.firstname,
      lastname: student.lastname,
      email: student.email,
      academic_background: student.academic_background
    };
  } catch (e) {}

  const file_type_name = FILE_MAPPING_TABLE[file_type];
  let concat_prompt = '';
  if (file_type.includes('ML')) {
    concat_prompt = generalMLPrompt({
      editor_requirements,
      document_requirements,
      program_full_name,
      student_input,
      file_type_name,
      student_info
    });
  } else {
    // TODO: need to fine tune prompt
    concat_prompt = generalRLPrompt({
      editor_requirements,
      document_requirements,
      program_full_name,
      student_input,
      file_type_name,
      student_info
    });
  }

  const stream = await generate_streaming(
    concat_prompt,
    parsed_editor_requirements.gptModel || OpenAiModel.GPT_3_5_TURBO
  );
  for await (const part of stream) {
    res.write(part.choices[0]?.delta.content || '');
  }
  res.end();

  const permission = await req.db.model('Permission').findOne({
    user_id: user._id
  });
  if (permission.taigerAiQuota > 0) {
    permission.taigerAiQuota -= 1;
    await permission.save();
  }
});

module.exports = {
  TaiGerAiGeneral,
  TaiGerAiChat,
  cvmlrlAi,
  processProgramListAi
};
