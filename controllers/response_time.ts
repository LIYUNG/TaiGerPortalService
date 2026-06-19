import { is_TaiGer_Student } from '@taiger-common/core';
import { IResponseTime, IStudent, IUser } from '@taiger-common/model';

import ResponseTimeService from '../services/responseTimes';
import { asyncHandler } from '../middlewares/error-handler';

// Plain (non-Express) helpers. The previously-passed filter object was ignored
// at runtime (the DAO hard-codes its own filter), so dropping it is
// behaviour-preserving. See FLAGS in the migration report.
const GetResponseTimeForCommunication = () =>
  ResponseTimeService.getForCommunicationPopulated();

const GetResponseTimeForThread = () =>
  ResponseTimeService.getForThreadPopulated();

const FileTypeMapping = {
  CV: ['CV'],
  CV_US: ['CV_US'],
  ML: ['ML'],
  SOP: ['SOP'],
  PHS: ['PHS'],
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

const GetFormattedFileType = (fileType: string) => {
  // Find the entry where the fileType exists in the values array
  const entry = Object.entries(FileTypeMapping).find(([_key, values]) =>
    values.includes(fileType)
  );
  // If entry is found, return the key, otherwise return null
  return entry ? entry[0] : null;
};

const GernerateLookupTable = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Lookup: Record<string, any>,
  user: IStudent,
  task: IResponseTime
) => {
  const FormattedFileType = GetFormattedFileType(task.interval_type);
  // `_id` is present on the populated documents at runtime (not declared on the
  // plain IUser/IStudent interfaces), so read it via a narrow cast.
  const userId = String((user as { _id?: unknown })._id);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CalculateAvgReponseTimeinLookup = (Lookup: Record<string, any>) => {
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
};

const GenerateResponseTimeByTaigerUser = asyncHandler(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Lookup: Record<string, any> = {};

  const ResponseTimeForCommunication =
    (await GetResponseTimeForCommunication()) as unknown as IResponseTime[];
  ResponseTimeForCommunication.forEach((RTFC) => {
    if (RTFC.student_id) {
      const { agents } = RTFC.student_id as IStudent;
      ((agents ?? []) as IUser[])
        .filter((agent) => agent.firstname !== 'David')
        .forEach((agent) => {
          GernerateLookupTable(Lookup, agent, RTFC);
        });
    }
  });

  const ResponseTimeForThread =
    (await GetResponseTimeForThread()) as unknown as IResponseTime[];
  ResponseTimeForThread.forEach((RTFT) => {
    if (RTFT.student_id) {
      const { agents } = RTFT.student_id as IStudent;
      ((agents ?? []) as IUser[])
        .filter((agent) => agent.firstname !== 'David')
        .forEach((agent) => {
          GernerateLookupTable(Lookup, agent, RTFT);
        });

      const { editors } = RTFT.student_id as IStudent;
      ((editors ?? []) as IUser[]).forEach((editor) => {
        GernerateLookupTable(Lookup, editor, RTFT);
      });
    }
  });

  CalculateAvgReponseTimeinLookup(Lookup);
  return Lookup;
});

// TODO: deprecated
const GenerateResponseTimeByStudent = asyncHandler(async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Lookup: Record<string, any> = {};

  const ResponseTimeForCommunication =
    (await GetResponseTimeForCommunication()) as unknown as IResponseTime[];
  ResponseTimeForCommunication.forEach((RTFC) => {
    const student = RTFC.student_id ?? null;

    if (student) {
      GernerateLookupTable(Lookup, student as IStudent, RTFC);
    }
  });

  const ResponseTimeForThread =
    (await GetResponseTimeForThread()) as unknown as IResponseTime[];
  ResponseTimeForThread.forEach((RTFT) => {
    const student =
      (RTFT.thread_id as { student_id?: IStudent } | undefined)?.student_id ??
      null;

    if (student) {
      GernerateLookupTable(Lookup, student as IStudent, RTFT);
    }
  });

  CalculateAvgReponseTimeinLookup(Lookup);
  return Lookup;
});

export = {
  GenerateResponseTimeByStudent,
  GenerateResponseTimeByTaigerUser
};
