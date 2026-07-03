// Stage B — deterministic docx rendering. Fills the TaiGer CV template from a
// reviewed CVDraft using easy-template-x. No LLM: given the same draft it always
// produces the same document. The optional passport photo is embedded via the
// library's built-in image support ({photo} tag in the template).
//
// (We use easy-template-x rather than docxtemplater because the free docxtemplater
// image modules are incompatible with docxtemplater 3.x; easy-template-x has
// maintained, built-in image support and still outputs an editable .docx.)

import path from 'path';
import { TemplateHandler, MimeType } from 'easy-template-x';

import { CVDraft } from './types';
import TemplateService from '../../templates';
import { getS3Object } from '../../../aws/s3';
import { AWS_S3_PUBLIC_BUCKET_NAME } from '../../../config';
import { ten_minutes_cache } from '../../../cache/node-cache';

// The CV template (a .docx with {tag} placeholders and {#loop}{/loop} sections,
// incl. a {photo} image tag) lives in S3 under this category — the same store the
// admin template-upload flow writes to — so it can be updated without a redeploy.
const CV_TEMPLATE_CATEGORY = 'CV_AI_Draft_Template';

// Passport-photo box size in the template, in pixels (~35x45 mm passport ratio).
const PHOTO_WIDTH_PX = 110;
const PHOTO_HEIGHT_PX = 140;

// Resolve the S3 object key from a stored template path, exactly as
// downloadTemplateFile does ("<directory>/<fileName>").
const templateFileKey = (templatePath: string): string => {
  const [directory, fileName] = templatePath.replace(/\\/g, '/').split('/');
  return path.join(directory, fileName).replace(/\\/g, '/');
};

// Load the raw template bytes from S3. Cached in-memory (ten_minutes_cache) so a
// render does not hit S3 every time — the template changes rarely.
const loadTemplateContent = async (): Promise<Buffer> => {
  const template = await TemplateService.getTemplateByCategory(
    CV_TEMPLATE_CATEGORY
  );
  if (!template?.path) {
    throw new Error(
      `CV template '${CV_TEMPLATE_CATEGORY}' not found. Upload it via the template admin flow.`
    );
  }
  const fileKey = templateFileKey(template.path);
  const cached = ten_minutes_cache.get<Buffer>(fileKey);
  if (cached) {
    return cached;
  }
  const bytes = await getS3Object(AWS_S3_PUBLIC_BUCKET_NAME, fileKey);
  const buffer = Buffer.from(bytes as Uint8Array);
  ten_minutes_cache.set(fileKey, buffer);
  return buffer;
};

// Detect the image MIME type from the file's magic bytes, so we embed common
// formats (PNG, JPEG/JPG, GIF, BMP) regardless of the stored extension. Returns
// null for anything we can't safely embed — the photo is then skipped.
const detectImageFormat = (buf: Buffer): MimeType | null => {
  if (buf.length < 4) {
    return null;
  }
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return MimeType.Png;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return MimeType.Jpeg;
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return MimeType.Gif;
  }
  if (buf[0] === 0x42 && buf[1] === 0x4d) {
    return MimeType.Bmp;
  }
  return null;
};

// Flatten the CVDraft into the flat tag namespace the template expects (personal
// fields at top level; arrays match the {#...} loops verbatim). The passport
// photo, when present and in a supported format, is added as an image content.
const toTemplateData = (draft: CVDraft, photo?: Buffer) => {
  const data: Record<string, unknown> = {
    ...draft.personal,
    universities: draft.universities,
    seniorHighSchools: draft.seniorHighSchools,
    juniorHighSchools: draft.juniorHighSchools,
    // easy-template-x loops need objects, not primitive strings, so each
    // bullet becomes { text } for the {#bullets}{text}{/bullets} loop.
    experience: draft.experience.map((x) => ({
      ...x,
      bullets: (x.bullets || []).map((text) => ({ text }))
    })),
    awards: draft.awards,
    languages: draft.languages,
    computer: draft.computer,
    otherSkills: draft.otherSkills,
    socialEngagement: draft.socialEngagement,
    competitiveSports: draft.competitiveSports,
    hobbies: draft.hobbies,
    anythingElse: draft.anythingElse
  };
  if (photo && photo.length) {
    const format = detectImageFormat(photo);
    if (format) {
      data.photo = {
        _type: 'image',
        source: photo,
        format,
        width: PHOTO_WIDTH_PX,
        height: PHOTO_HEIGHT_PX
      };
    }
  }
  return data;
};

const templateHandler = new TemplateHandler();

export const renderCVDraftDocx = async (
  draft: CVDraft,
  photo?: Buffer
): Promise<Buffer> => {
  const content = await loadTemplateContent();
  return templateHandler.process(content, toTemplateData(draft, photo));
};
