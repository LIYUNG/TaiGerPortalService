import { FilterQuery, UpdateQuery, SortOrder } from 'mongoose';
import { IDocumentthread } from '@taiger-common/model';
import StudentService from './students';
import DocumentthreadDAO from '../dao/documentthread.dao';

// Raw req.query shape consumed by the active-threads pagination/count endpoints
// (mirrors the DAO's ActiveThreadsQuery).
interface ActiveThreadsQuery {
  page?: string;
  limit?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  viewerId?: string;
  name?: string;
  document_name?: string;
  file_type?: string | string[];
  lang?: string;
  status?: string;
  editorName?: string;
  agentName?: string;
  essayWriterName?: string;
  deadline?: string;
  category?: string;
  excludeFileType?: string | string[];
  [key: string]: unknown;
}

interface ActiveThreadsParams {
  studentIds?: string[];
  outsourcedUserId?: string | null;
  query?: ActiveThreadsQuery;
}

// Shapes of the populated threads consumed by the staff/user filtering below.
// Structural supertype of the DAO's lean result so the predicates type-check
// without changing the (unchanged) filtering logic.
interface PopulatedRef {
  _id: { toString(): string };
}

interface PopulatedThreadStudent {
  agents: PopulatedRef[];
  editors: PopulatedRef[];
  archiv?: boolean;
}

interface PopulatedThread {
  student_id?: PopulatedThreadStudent;
  application_id?: { decided?: string };
  outsourced_user_id?: PopulatedRef[];
  file_type?: string;
  [key: string]: unknown;
}

const DocumentThreadService = {
  // Default-connection helpers (no req) used by the migrated application flow.
  newThread(payload: Partial<IDocumentthread>) {
    return DocumentthreadDAO.newThread(payload);
  },
  countThreads(filter: FilterQuery<IDocumentthread>) {
    return DocumentthreadDAO.countThreads(filter);
  },
  createThread(payload: Partial<IDocumentthread>) {
    return DocumentthreadDAO.createThread(payload);
  },
  deleteThreadById(id: string) {
    return DocumentthreadDAO.deleteThreadById(id);
  },
  updateThreadFields(id: string, payload: UpdateQuery<IDocumentthread>) {
    return DocumentthreadDAO.updateThreadFields(id, payload);
  },
  getThreadByIdLean(id: string) {
    return DocumentthreadDAO.getThreadByIdLean(id);
  },
  findThreads(filter: FilterQuery<IDocumentthread>, select: string) {
    return DocumentthreadDAO.findThreads(filter, select);
  },
  findThreadsSelectSorted(
    filter: FilterQuery<IDocumentthread>,
    select: string,
    sort: Record<string, SortOrder>
  ) {
    return DocumentthreadDAO.findThreadsSelectSorted(filter, select, sort);
  },

  getThreadsWaitingOnTeam(studentIds: string[]) {
    return DocumentthreadDAO.getThreadsWaitingOnTeam(studentIds);
  },
  getThreadDocById(id: string) {
    return DocumentthreadDAO.getThreadDocById(id);
  },
  getThreadDocByIdPopulated(id: string, populates: unknown[][]) {
    return DocumentthreadDAO.getThreadDocByIdPopulated(id, populates);
  },
  findThreadByIdPopulated(id: string, populates: unknown[][]) {
    return DocumentthreadDAO.findThreadByIdPopulated(id, populates);
  },
  findOneThreadPopulated(
    filter: FilterQuery<IDocumentthread>,
    populates: unknown[][]
  ) {
    return DocumentthreadDAO.findOneThreadPopulated(filter, populates);
  },
  findOneThreadDoc(filter: FilterQuery<IDocumentthread>) {
    return DocumentthreadDAO.findOneThreadDoc(filter);
  },
  clearAllOutsourcedUsers() {
    return DocumentthreadDAO.clearAllOutsourcedUsers();
  },
  setMessageIgnore(messageId: string, ignoreMessageState: boolean) {
    return DocumentthreadDAO.setMessageIgnore(messageId, ignoreMessageState);
  },
  // Delegates the version-control thread-creation helper to the DAO (which owns
  // the model wiring).
  createApplicationThread(
    studentId: string,
    applicationId: string,
    documentCategory: string
  ) {
    return DocumentthreadDAO.createApplicationThread(
      studentId,
      applicationId,
      documentCategory
    );
  },

  async getThreadById(messagesThreadId: string) {
    return DocumentthreadDAO.findThreadByIdFullyPopulated(messagesThreadId);
  },
  async getStudentThreadsByStudentId(studentId: string) {
    const threads = (await DocumentthreadDAO.findThreadsByStudentIdPopulated(
      studentId
    )) as unknown as PopulatedThread[];

    const filteredThreads = threads.filter(
      (thread: PopulatedThread) =>
        (thread?.application_id?.decided === 'O' || !thread?.application_id) &&
        thread.file_type !== 'Interview'
    );

    return filteredThreads;
  },
  async getStudentsThreadsByTaiGerUserId(
    userId: string,
    documentThreadFilter: FilterQuery<IDocumentthread> = {}
  ) {
    const threads = (await DocumentthreadDAO.findThreadsForTaiGerUserPopulated(
      documentThreadFilter
    )) as unknown as PopulatedThread[];

    const filteredThreads = threads.filter(
      (thread: PopulatedThread) =>
        (thread.student_id?.agents?.some(
          (agent: PopulatedRef) => agent._id.toString() === userId
        ) ||
          thread.student_id?.editors?.some(
            (editor: PopulatedRef) => editor._id.toString() === userId
          ) ||
          (thread.file_type === 'Essay' &&
            thread.outsourced_user_id?.some(
              (o_user_id: PopulatedRef) => o_user_id._id.toString() === userId
            ))) &&
        (thread?.application_id?.decided === 'O' || !thread?.application_id) &&
        thread.file_type !== 'Interview' &&
        (thread.student_id?.archiv === false ||
          thread.student_id?.archiv === undefined)
    );

    return filteredThreads;
  },
  async getAllStudentsThreads(query: FilterQuery<IDocumentthread>) {
    const queryFilter = { ...query };
    const activeStudentsIds = await StudentService.fetchSimpleStudents({
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    queryFilter.student_id = {
      $in: activeStudentsIds.map((student: { _id: unknown }) => student._id)
    };
    const threads = (await DocumentthreadDAO.findAllStudentsThreadsPopulated(
      queryFilter
    )) as unknown as PopulatedThread[];

    const filteredThreads = threads.filter(
      (thread: PopulatedThread) =>
        (thread?.application_id?.decided === 'O' || !thread?.application_id) &&
        thread.file_type !== 'Interview'
    );

    return filteredThreads;
  },

  // Active document-thread reads delegate to the DAO, which owns the
  // aggregation pipeline; these stay thin so the service is DB-free.
  async getActiveThreadsPaginated(params: ActiveThreadsParams) {
    return DocumentthreadDAO.findActiveThreadsPaginated(params);
  },

  async getActiveThreadsCounts(params: ActiveThreadsParams) {
    return DocumentthreadDAO.countActiveThreads(params);
  },

  async getThreads(filter: FilterQuery<IDocumentthread>) {
    return DocumentthreadDAO.findThreadsPopulated(filter);
  },
  async updateThreadById(
    threadId: string,
    payload: UpdateQuery<IDocumentthread>
  ) {
    return DocumentthreadDAO.updateThreadByIdReturnNew(threadId, payload);
  },
  async updateThread(
    filter: FilterQuery<IDocumentthread>,
    payload: UpdateQuery<IDocumentthread>
  ) {
    return DocumentthreadDAO.updateOneThreadReturnNew(filter, payload);
  }
};

export = DocumentThreadService;
