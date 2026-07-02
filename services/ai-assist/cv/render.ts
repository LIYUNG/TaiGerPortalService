// Stage B — deterministic docx rendering. Fills the TaiGer CV template
// (docxtemplater) from a reviewed CVDraft. No LLM: given the same draft it
// always produces the same document. The optional passport photo is embedded
// via the image module ({#hasPhoto}{%photo}{/hasPhoto} in the template).

import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';

import { CVDraft } from './types';
import TemplateService from '../../templates';
import { getS3Object } from '../../../aws/s3';
import { AWS_S3_PUBLIC_BUCKET_NAME } from '../../../config';
import { ten_minutes_cache } from '../../../cache/node-cache';

// The docxtemplater CV template (a .docx carrying {#...} loops / {%photo} tags)
// lives in S3 under this category — the same store the admin template-upload
// flow writes to — so it can be updated without a redeploy.
const CV_TEMPLATE_CATEGORY = 'CV_AI_Draft_Template';

// Resolve the S3 object key from a stored template path, exactly as
// downloadTemplateFile does ("<directory>/<fileName>").
const templateFileKey = (templatePath: string): string => {
  const [directory, fileName] = templatePath.replace(/\\/g, '/').split('/');
  return path.join(directory, fileName).replace(/\\/g, '/');
};

// Load the raw template bytes from S3. Cached in-memory (ten_minutes_cache) so a
// render does not hit S3 every time — the template changes rarely and the buffer
// is re-parsed per render (docxtemplater mutates the zip, so we cache bytes, not
// the instance).
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

// Flatten the CVDraft into the flat tag namespace the template expects
// (personal fields at top level; arrays match the {#...} loops verbatim).
const toTemplateData = (draft: CVDraft, photo?: Buffer) => ({
  ...draft.personal,
  universities: draft.universities,
  seniorHighSchools: draft.seniorHighSchools,
  juniorHighSchools: draft.juniorHighSchools,
  experience: draft.experience,
  awards: draft.awards,
  languages: draft.languages,
  computer: draft.computer,
  otherSkills: draft.otherSkills,
  socialEngagement: draft.socialEngagement,
  competitiveSports: draft.competitiveSports,
  hobbies: draft.hobbies,
  anythingElse: draft.anythingElse,
  hasPhoto: Boolean(photo && photo.length),
  photo
});

export const renderCVDraftDocx = async (
  draft: CVDraft,
  photo?: Buffer
): Promise<Buffer> => {
  const content = await loadTemplateContent();
  const zip = new PizZip(content);

  const imageModule = new ImageModule({
    centered: false,
    // tagValue is the Buffer we put on data.photo
    getImage: (tagValue: Buffer) => tagValue,
    // passport-ratio, in px (≈ 35×45 mm)
    getSize: () => [110, 140]
  });

  const doc = new Docxtemplater(zip, {
    modules: [imageModule],
    paragraphLoop: true,
    linebreaks: true
  });

  doc.render(toTemplateData(draft, photo));
  return doc.getZip().generate({ type: 'nodebuffer' }) as Buffer;
};
