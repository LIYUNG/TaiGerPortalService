// Stage B — deterministic docx rendering. Fills the TaiGer CV template
// (docxtemplater) from a reviewed CVDraft. No LLM: given the same draft it
// always produces the same document. The optional passport photo is embedded
// via the image module ({#hasPhoto}{%photo}{/hasPhoto} in the template).

import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import ImageModule from 'docxtemplater-image-module-free';

import { CVDraft } from './types';

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'cv_template.docx');

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

export const renderCVDraftDocx = (draft: CVDraft, photo?: Buffer): Buffer => {
  const content = fs.readFileSync(TEMPLATE_PATH, 'binary');
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
