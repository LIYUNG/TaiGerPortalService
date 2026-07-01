import { Request, Response } from 'express';
import { ErrorResponse } from '../common/errors';
import { asyncHandler } from '../middlewares/error-handler';
import logger from '../services/logger';
import KeywordSetService from '../services/keywordsets';

const getKeywordSets = asyncHandler(async (req: Request, res: Response) => {
  const keywordsets = await KeywordSetService.getKeywordSets();
  res.send({ success: true, data: keywordsets });
});

const createKeywordSet = asyncHandler(async (req: Request, res: Response) => {
  const fields = req.body;
  const existed = await KeywordSetService.findKeywordSet({
    keywords: fields.keywords,
    antiKeywords: fields.antiKeywords
  });
  if (existed) {
    // Find out which specific keywords and antiKeywords are duplicates
    const duplicateKeywordsZh = fields.keywords.zh.filter((keyword: string) =>
      existed.keywords.zh.includes(keyword)
    );
    const duplicateAntiKeywordsZh = fields.antiKeywords.zh.filter(
      (antiKeyword: string) => existed.antiKeywords.zh.includes(antiKeyword)
    );
    const duplicateKeywordsEn = fields.keywords.en.filter((keyword: string) =>
      existed.keywords.en.includes(keyword)
    );
    const duplicateAntiKeywordsEn = fields.antiKeywords.en.filter(
      (antiKeyword: string) => existed.antiKeywords.en.includes(antiKeyword)
    );
    // Build a clear error message
    const duplicateZH = {
      keywords: duplicateKeywordsZh,
      antiKeywords: duplicateAntiKeywordsZh
    };
    const duplicateEN = {
      keywords: duplicateKeywordsEn,
      antiKeywords: duplicateAntiKeywordsEn
    };

    logger.error('createKeywordSet: Duplicate Keyword set found:', fields);
    throw new ErrorResponse(
      423,
      `Duplicate Keywordset found: ZH ${JSON.stringify(
        duplicateZH
      )}, Anti-Keywordset found: EN ${JSON.stringify(duplicateEN)}`
    );
  }
  const newKeywordSet = await KeywordSetService.createKeywordSet(fields);

  res.status(201).send({ success: true, data: newKeywordSet });
});

const updateKeywordSet = asyncHandler(async (req: Request, res: Response) => {
  const { keywordsSetId } = req.params;
  const fields = req.body;

  delete fields._id;
  fields.updatedAt = new Date();
  const updatedKeywordSet = await KeywordSetService.updateKeywordSetById(
    keywordsSetId,
    fields
  );

  if (!updatedKeywordSet) {
    logger.error('updateKeywordSet: Invalid keyword set id');
    throw new ErrorResponse(404, 'Keyword set not found');
  }

  res.status(200).send({ success: true, data: updatedKeywordSet });
});

// will also remove the keywordId from the programs who has keywordsetid in one of their requirement
const deleteKeywordSet = asyncHandler(async (req: Request, res: Response) => {
  const { keywordsSetId } = req.params;
  try {
    await KeywordSetService.deleteKeywordSet(keywordsSetId);
  } catch (error) {
    logger.error(
      'Failed to delete keywordsSetId ',
      error as Record<string, unknown>
    );
    throw error;
  }
  res.status(200).send({ success: true });
});

export = {
  getKeywordSets,
  createKeywordSet,
  updateKeywordSet,
  deleteKeywordSet
};
