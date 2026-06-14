import { ErrorResponse } from '../common/errors';
import { asyncHandler } from '../middlewares/error-handler';
import logger from '../services/logger';
import ProgramRequirementService from '../services/programRequirements';

const getDistinctProgramsAndKeywordSets = async (req, res) => {
  try {
    const { distinctPrograms, keywordsets } =
      await ProgramRequirementService.getDistinctProgramsAndKeywordSets();
    res.send({ success: true, data: { distinctPrograms, keywordsets } });
  } catch (error) {
    logger.error('Error fetching distinct schools:', error);
    throw error;
  }
};

const getProgramRequirements = asyncHandler(async (req, res) => {
  const programRequirements =
    await ProgramRequirementService.getProgramRequirements();
  res.send({ success: true, data: programRequirements });
});

const getProgramRequirement = asyncHandler(async (req, res) => {
  const { requirementId } = req.params;
  const { distinctPrograms, keywordsets } =
    await ProgramRequirementService.getDistinctProgramsAndKeywordSets();
  const requirement = await ProgramRequirementService.getProgramRequirementById(
    requirementId
  );
  if (!requirement) {
    logger.error('getProgramRequirement: Invalid program id');
    throw new ErrorResponse(404, 'ProgramRequirement not found');
  }
  res.send({
    success: true,
    data: { requirement, distinctPrograms, keywordsets }
  });
});

const createProgramRequirement = asyncHandler(async (req, res) => {
  const fields = req.body;
  const program = fields?.program;
  const program_categories = fields?.program_categories.map(
    (program_category) => ({
      ...program_category,
      keywordSets: program_category.keywordSets?.map(
        (keywordSet) => keywordSet._id
      )
    })
  );
  const matchedPrograms =
    await ProgramRequirementService.findProgramsBySchoolNameDegree({
      school: program.school,
      program_name: program.program_name,
      degree: program.degree
    });
  const matchedProgramIds = matchedPrograms.map(
    (matchedProgram) => matchedProgram._id
  );
  const existedProgramRequirement =
    await ProgramRequirementService.getProgramRequirementsByProgramIds(
      matchedProgramIds
    );
  if (existedProgramRequirement?.length > 0) {
    logger.error(
      'createProgramRequirement: program analysis is already existed!'
    );
    throw new ErrorResponse(
      423,
      'createProgramRequirement: program analysis is already existed!'
    );
  }
  const payload = {
    programId: [...matchedPrograms.map((matchedProgram) => matchedProgram._id)],
    ...fields,
    program_categories
  };
  logger.info(JSON.stringify(payload));
  const newProgramRequirement =
    await ProgramRequirementService.createProgramRequirement(payload);

  res.status(201).send({
    success: true,
    data: newProgramRequirement
  });

  // TODO: update Program Collection program analysis?
});

const updateProgramRequirement = asyncHandler(async (req, res) => {
  const { requirementId } = req.params;
  const fields = req.body;

  fields.updatedAt = new Date();
  delete fields.program;
  if (fields?.program_categories) {
    fields.coursesScore = fields?.program_categories
      ?.map((program_category) => program_category.maxScore)
      ?.reduce((sum, current) => sum + parseFloat(current), 0);
  }

  const updatedProgramRequirement =
    await ProgramRequirementService.updateProgramRequirementById(
      requirementId,
      fields
    );

  if (!updatedProgramRequirement) {
    logger.error('updateProgramRequirement: requirementId');
    throw new ErrorResponse(404, 'Program requirement not found');
  }

  res.status(200).send({ success: true, data: updatedProgramRequirement });
});

const deleteProgramRequirement = asyncHandler(async (req, res) => {
  const { requirementId } = req.params;
  await ProgramRequirementService.deleteProgramRequirementById(requirementId);

  res.status(200).send({ success: true });
});

module.exports = {
  getDistinctProgramsAndKeywordSets,
  getProgramRequirements,
  getProgramRequirement,
  createProgramRequirement,
  updateProgramRequirement,
  deleteProgramRequirement
};
