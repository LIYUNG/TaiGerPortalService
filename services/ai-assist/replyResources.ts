// Curated TaiGer portal resource links, ported from the legacy chat assistant
// (controllers/taigerais.ts). Injected into the reply-draft system prompt so a
// generated reply can point the student to the correct official guide.
//
// Keep this catalog here (not inline in the orchestrator) so non-engineers can
// update a link without touching the tool loop. The model is instructed to
// include a link ONLY when it is genuinely on-topic for the student's question.

const TOPIC_LINKS: ReadonlyArray<[label: string, url: string]> = [
  [
    'How to apply for a German study visa',
    'https://taigerconsultancy-portal.com/docs/search/66117ff177802f1278b6104c'
  ],
  [
    'How to fill in the online application form for a German visa',
    'https://taigerconsultancy-portal.com/docs/search/64cf9dfc2d7b7e4d58219415'
  ],
  [
    'How to book a visa appointment with Deutsches Institut Taipeh',
    'https://taigerconsultancy-portal.com/docs/search/64c04b3522adb5d6aad94caf'
  ],
  [
    'How to open an Expatrio blocked account (限制提領帳戶)',
    'https://taigerconsultancy-portal.com/docs/search/64825ca787c9c3e88237351d'
  ],
  [
    'How to apply for a Switzerland study visa',
    'https://taigerconsultancy-portal.com/docs/search/6611756177802f1278b601cf'
  ],
  [
    'How to apply for a VPD / how to use uni-assist',
    'https://taigerconsultancy-portal.com/docs/uniassist'
  ],
  [
    'How to prepare a Motivation Letter (ML)',
    'https://taigerconsultancy-portal.com/docs/search/6383200c766614178d7f978f'
  ],
  [
    'How to prepare a Curriculum Vitae (CV)',
    'https://taigerconsultancy-portal.com/docs/search/6379767530243f127d431613'
  ],
  [
    'How to prepare a Recommendation Letter (RL) with a professor',
    'https://taigerconsultancy-portal.com/docs/search/63832557766614178d7f982b'
  ],
  [
    'How to prepare a Recommendation Letter (RL) with a manager / boss',
    'https://taigerconsultancy-portal.com/docs/search/645f4ac8e4452f90ced998ce'
  ],
  [
    'How to prepare an essay',
    'https://taigerconsultancy-portal.com/docs/search/638b4f82d495bd2198261f7b'
  ],
  [
    'How to prepare certified copies for German universities (影本驗證)',
    'https://taigerconsultancy-portal.com/docs/search/6381d2e0766614178d7f95bb'
  ],
  [
    "How to book an agent's office hour",
    'https://taigerconsultancy-portal.com/docs/search/64fe21bcbc729bc024d14738'
  ],
  [
    'How to use Jitsi Meet',
    'https://taigerconsultancy-portal.com/docs/search/64eb25ec89ea0d1fcb39df73'
  ],
  [
    'How interview training works / how to request it',
    'https://taigerconsultancy-portal.com/docs/search/664cf3260664445ad3abe3a3'
  ]
];

const DOCUMENT_LINKS: ReadonlyArray<[label: string, url: string]> = [
  [
    'Passport',
    'https://taigerconsultancy-portal.com/docs/search/6379715430243f127d4315a6'
  ],
  [
    "Bachelor's or Master's diploma",
    'https://taigerconsultancy-portal.com/docs/search/6381c95a766614178d7f94bc'
  ],
  [
    "Bachelor's or Master's graduate certificate",
    'https://taigerconsultancy-portal.com/docs/search/6381c389766614178d7f94a3'
  ],
  [
    'ECTS conversion document',
    'https://taigerconsultancy-portal.com/docs/search/6381cfe8766614178d7f959b'
  ],
  [
    "Bachelor's or Master's transcript",
    'https://taigerconsultancy-portal.com/docs/search/6381cd11766614178d7f9555'
  ],
  [
    'GSAT (學測) / TVE (統測) score report',
    'https://taigerconsultancy-portal.com/docs/search/6381d070766614178d7f95a8'
  ],
  [
    'Course / module description',
    'https://taigerconsultancy-portal.com/docs/search/63b9c5fe045871fbf1cc01ba'
  ],
  [
    'TOEFL / IELTS report',
    'https://taigerconsultancy-portal.com/docs/search/63b9c52e045871fbf1cc016c'
  ],
  [
    'High school diploma',
    'https://taigerconsultancy-portal.com/docs/search/63e0e62d1dd60644058853e7'
  ],
  [
    'High school transcript',
    'https://taigerconsultancy-portal.com/docs/search/63e0e7a51dd6064405885476'
  ],
  [
    'Grading system / grade conversion table',
    'https://taigerconsultancy-portal.com/docs/search/63d841d2603c4c625d4b3b83'
  ]
];

const renderList = (entries: ReadonlyArray<[string, string]>) =>
  entries.map(([label, url]) => `- ${label}: ${url}`).join('\n');

// Appended to the reply-draft system prompt. The leading guidance keeps links
// relevant: the model must not dump the whole catalog into every reply.
export const REPLY_RESOURCE_LINKS = `

TAIGER RESOURCE LINKS — include a link ONLY when it directly answers the student's question; never list links that were not asked about, and never invent links not in this list.

How-to topics:
${renderList(TOPIC_LINKS)}

Document preparation requirements:
${renderList(DOCUMENT_LINKS)}`;

export default REPLY_RESOURCE_LINKS;
