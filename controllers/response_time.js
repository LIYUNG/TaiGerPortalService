const { Role, is_TaiGer_Student } = require('@taiger-common/core');

const { ResponseTime } = require('../models/ResponseTime');
const { asyncHandler } = require('../middlewares/error-handler');

const GetResponseTimeForCommunication = asyncHandler(async () =>
  ResponseTime.find({ student_id: { $exists: true } })
    .populate({
      path: 'student_id',
      populate: [
        { path: 'agents', model: 'User' },
        { path: 'editors', model: 'User' }
      ]
    })
    .lean()
);

const GetResponseTimeForThread = asyncHandler(async () =>
  ResponseTime.find({ thread_id: { $exists: true } })
    .populate({
      path: 'thread_id',
      populate: {
        path: 'student_id',
        model: 'User',
        populate: [
          { path: 'agents', model: 'User' },
          { path: 'editors', model: 'User' }
        ]
      }
    })
    .lean()
);

const FileTypeMapping = {
  CV: ['CV'],
  ML: ['ML'],
  SOP: ['SOP'],
  RL: [
    'RL_A',
    'RL_B',
    'RL_C',
    'Recommendation_Letter_A',
    'Recommendation_Letter_B',
    'Recommendation_Letter_C'
  ],
  Essay: ['Essay'],
  Messages: ['communication'],
  'Agent Support': [
    'Supplementary_Form',
    'Others',
    'Scholarship_Form',
    'Curriculum_Analysis',
    'Portfolio'
  ]
};

const BlankLookupTable = {
  UserProfile: {
    firstname: null,
    lastname: null,
    role: null,
    agents: null,
    editors: null
  },
  CV: {
    AvgResponseTime: [],
    ResponseTimeId: []
  },
  ML: {
    AvgResponseTime: [],
    ResponseTimeId: []
  },
  RL: {
    AvgResponseTime: [],
    ResponseTimeId: []
  },
  Essay: {
    AvgResponseTime: [],
    ResponseTimeId: []
  },
  Messages: {
    AvgResponseTime: [],
    ResponseTimeId: []
  },
  'Agent Support': {
    AvgResponseTime: [],
    ResponseTimeId: []
  }
};

const GetFormattedFileType = (fileType) => {
  // Find the entry where the fileType exists in the values array
  const entry = Object.entries(FileTypeMapping).find(([key, values]) =>
    values.includes(fileType)
  );
  // If entry is found, return the key, otherwise return null
  return entry ? entry[0] : null;
};

const GernerateLookupTable = (Lookup, user, task) => {
  const FormattedFileType = GetFormattedFileType(task.interval_type);
  const userId = user?._id.toString();
  if (FormattedFileType) {
    if (!(userId in Lookup)) {
      Lookup[userId] = JSON.parse(JSON.stringify(BlankLookupTable));
      Lookup[userId]['UserProfile'].firstname = user.firstname;
      Lookup[userId]['UserProfile'].lastname = user.lastname;
      Lookup[userId]['UserProfile'].role = user.role;
      if (is_TaiGer_Student(user)) {
        Lookup[userId]['UserProfile'].agents = user.agents;
        Lookup[userId]['UserProfile'].editors = user.editors;
      }
    }
    Lookup[userId][FormattedFileType].AvgResponseTime.push(task.intervalAvg);
    const ThreadIdOrStudentId = task.thread_id || task.student_id;
    Lookup[userId][FormattedFileType].ResponseTimeId.push([
      ThreadIdOrStudentId,
      task.intervalAvg
    ]);
  }
};

const CalculateAvgReponseTimeinLookup = asyncHandler(async (Lookup) => {
  //calculate the average response time
  for (const user in Lookup) {
    for (const attribute in Lookup[user]) {
      if (attribute !== 'UserProfile') {
        const entry = Lookup[user][attribute];
        if (entry.ResponseTimeId.length > 0) {
          const averageResponseTime =
            entry.AvgResponseTime / entry.ResponseTimeId.length;
          Lookup[user][attribute].AvgResponseTime = averageResponseTime;
        } else {
          Lookup[user][attribute].AvgResponseTime = null;
        }
      }
    }
  }
});

const GenerateResponseTimeByTaigerUser = asyncHandler(async () => {
  let Lookup = {};

  const ResponseTimeForCommunication = await GetResponseTimeForCommunication({
    student_id: { $exists: true }
  });
  ResponseTimeForCommunication.forEach((RTFC) => {
    if (RTFC.student_id) {
      const { agents } = RTFC.student_id;
      agents
        .filter((agent) => agent.firstname !== 'David')
        .forEach((agent) => {
          GernerateLookupTable(Lookup, agent, RTFC);
        });
    }
  });

  const ResponseTimeForThread = await GetResponseTimeForThread({
    thread_id: { $exists: true }
  });
  ResponseTimeForThread.forEach((RTFT) => {
    if (RTFT.student_id) {
      const { agents } = RTFT.student_id;
      agents
        .filter((agent) => agent.firstname !== 'David')
        .forEach((agent) => {
          GernerateLookupTable(Lookup, agent, RTFT);
        });

      const { editors } = RTFT.student_id;
      editors.forEach((editor) => {
        GernerateLookupTable(Lookup, editor, RTFT);
      });
    }
  });

  CalculateAvgReponseTimeinLookup(Lookup);
  return Lookup;
});

// TODO: deprecated
const GenerateResponseTimeByStudent = asyncHandler(async () => {
  let Lookup = {};

  const ResponseTimeForCommunication = await GetResponseTimeForCommunication({
    student_id: { $exists: true }
  });
  ResponseTimeForCommunication.forEach((RTFC) => {
    const student = RTFC.student_id ?? null;

    if (student) {
      GernerateLookupTable(Lookup, student, RTFC);
    }
  });

  const ResponseTimeForThread = await GetResponseTimeForThread({
    thread_id: { $exists: true }
  });
  ResponseTimeForThread.forEach((RTFT) => {
    const student = RTFT.thread_id?.student_id ?? null;

    if (student) {
      GernerateLookupTable(Lookup, student, RTFT);
    }
  });

  CalculateAvgReponseTimeinLookup(Lookup);
  return Lookup;
});

module.exports = {
  GenerateResponseTimeByStudent,
  GenerateResponseTimeByTaigerUser
};
