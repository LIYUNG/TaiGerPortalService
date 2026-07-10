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
import type { TemplateData } from 'easy-template-x';

import { CVDraft } from './types';
import TemplateService from '../../templates';
import { getS3Object, headS3ObjectETag } from '../../../aws/s3';
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

// A cheap version token for the current CV template: its S3 ETag (changes on any
// re-upload) with the file key and the stored doc's updatedAt as fallbacks. Used
// to (a) bust the in-memory cache and (b) invalidate render dedup so a template
// update always re-renders even when the draft JSON is unchanged.
const templateVersionToken = async (
  fileKey: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  template: any
): Promise<string> => {
  const etag = await headS3ObjectETag(AWS_S3_PUBLIC_BUCKET_NAME, fileKey);
  return etag || String(template?.updatedAt || '') || fileKey;
};

// Resolve the current template file key + version, without downloading the bytes.
// Lets the controller fold the template version into its render-dedup check.
export const getCvTemplateVersion = async (): Promise<string> => {
  const template = await TemplateService.getTemplateByCategory(
    CV_TEMPLATE_CATEGORY
  );
  if (!template?.path) {
    return '';
  }
  return templateVersionToken(templateFileKey(template.path), template);
};

// Load the raw template bytes from S3. Cached in-memory (ten_minutes_cache) keyed
// by file key + version, so a template re-upload (new ETag) busts the cache
// immediately instead of serving stale bytes for up to the TTL.
const loadTemplateContent = async (): Promise<{
  buffer: Buffer;
  version: string;
}> => {
  const template = await TemplateService.getTemplateByCategory(
    CV_TEMPLATE_CATEGORY
  );
  if (!template?.path) {
    throw new Error(
      'The CV draft template has not been set up yet. Please ask an administrator to upload it in the template admin area.'
    );
  }
  const fileKey = templateFileKey(template.path);
  const version = await templateVersionToken(fileKey, template);
  const cacheKey = `${fileKey}::${version}`;
  const cached = ten_minutes_cache.get<Buffer>(cacheKey);
  if (cached) {
    return { buffer: cached, version };
  }
  const bytes = await getS3Object(AWS_S3_PUBLIC_BUCKET_NAME, fileKey);
  const buffer = Buffer.from(bytes as Uint8Array);
  ten_minutes_cache.set(cacheKey, buffer);
  return { buffer, version };
};

// Detect the image MIME type from the file's magic bytes, so we embed common
// formats (PNG, JPEG/JPG, GIF, BMP) regardless of the stored extension. Returns
// null for anything we can't safely embed — the photo is then skipped.
const detectImageFormat = (buf: Buffer): MimeType | null => {
  if (buf.length < 4) {
    return null;
  }
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
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
// Returns `photoEmbedded` so the caller can warn when a photo existed but could
// not be embedded (unsupported format), instead of shipping a silently photo-less CV.
const toTemplateData = (
  draft: CVDraft,
  photo?: Buffer
): { data: Record<string, unknown>; photoEmbedded: boolean } => {
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
  let photoEmbedded = false;
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
      photoEmbedded = true;
    }
  }
  return { data, photoEmbedded };
};

const templateHandler = new TemplateHandler();

export interface RenderCVDraftResult {
  buffer: Buffer;
  // True when a passport photo was actually embedded into the document. False
  // when no photo was supplied OR it was in a format we can't embed.
  photoEmbedded: boolean;
  // Version token of the template used, so the caller can tie its render-dedup
  // cache to the exact template revision.
  templateVersion: string;
}

export const renderCVDraftDocx = async (
  draft: CVDraft,
  photo?: Buffer
): Promise<RenderCVDraftResult> => {
  const { buffer: content, version } = await loadTemplateContent();
  const { data, photoEmbedded } = toTemplateData(draft, photo);
  // `data` is built as a plain Record for internal flexibility (CVDraft's
  // optional/typed fields don't structurally match easy-template-x's
  // recursive TemplateData union); the runtime shape is the tag map the
  // library expects.
  const buffer = await templateHandler.process(
    content,
    data as unknown as TemplateData
  );
  return { buffer, photoEmbedded, templateVersion: version };
};
