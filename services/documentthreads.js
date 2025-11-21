const StudentService = require('./students');
const ProgramService = require('./programs');

const DocumentThreadService = {
  async getThreadById(req, messagesThreadId) {
    const thread = await req.db
      .model('Documentthread')
      .findById(messagesThreadId)
      .populate(
        'student_id',
        'firstname lastname firstname_chinese lastname_chinese role agents editors application_preference pictureUrl'
      )
      .populate('messages.user_id', 'firstname lastname role archiv pictureUrl')
      .populate('program_id', 'country updatedAt')
      .populate(
        'outsourced_user_id',
        'firstname lastname role archiv pictureUrl'
      )
      .lean();
    
    if (thread?.program_id) {
      thread.program_id = await ProgramService.enrichProgramWithActiveApplications(
        req,
        thread.program_id
      );
    }
    
    return thread;
  },
  async getStudentThreadsByStudentId(req, studentId) {
    const threads = await req.db
      .model('Documentthread')
      .find({ student_id: studentId })
      .populate(
        'program_id',
        'school program_name application_deadline degree semester lang country updatedAt'
      )
      .populate('student_id', 'firstname lastname pictureUrl')
      .populate('application_id')
      .populate('messages.user_id', 'firstname lastname role pictureUrl')
      .populate('outsourced_user_id', 'firstname lastname role pictureUrl')
      .lean();

    // Enrich programs with hasActiveApplications
    const enrichedThreads = await ProgramService.enrichProgramsWithActiveApplications(
      req,
      threads.map((t) => t.program_id).filter(Boolean)
    );
    const programMap = new Map(enrichedThreads.map((p) => [p._id.toString(), p]));
    
    const threadsWithEnrichedPrograms = threads.map((thread) => {
      if (thread.program_id) {
        thread.program_id = programMap.get(thread.program_id._id?.toString()) || thread.program_id;
      }
      return thread;
    });

    const filteredThreads = threadsWithEnrichedPrograms.filter(
      (thread) =>
        (thread?.application_id?.decided === 'O' || !thread?.application_id) &&
        thread.file_type !== 'Interview'
    );

    return filteredThreads;
  },
  async getStudentsThreadsByTaiGerUserId(
    req,
    userId,
    documentThreadFilter = {}
  ) {
    const threads = await req.db
      .model('Documentthread')
      .find(documentThreadFilter)
      .populate(
        'messages.user_id outsourced_user_id',
        'firstname lastname email pictureUrl'
      )
      .populate({
        path: 'student_id',
        populate: {
          path: 'editors agents',
          select: 'firstname lastname email'
        }
      })
      .populate('application_id')
      .populate(
        'program_id',
        'school program_name application_deadline degree semester lang application_start country updatedAt'
      )
      .lean();

    // Enrich programs with hasActiveApplications
    const enrichedThreads = await ProgramService.enrichProgramsWithActiveApplications(
      req,
      threads.map((t) => t.program_id).filter(Boolean)
    );
    const programMap = new Map(enrichedThreads.map((p) => [p._id.toString(), p]));
    
    const threadsWithEnrichedPrograms = threads.map((thread) => {
      if (thread.program_id) {
        thread.program_id = programMap.get(thread.program_id._id?.toString()) || thread.program_id;
      }
      return thread;
    });

    const filteredThreads = threadsWithEnrichedPrograms.filter(
      (thread) =>
        (thread.student_id?.agents.some(
          (agent) => agent._id.toString() === userId
        ) ||
          thread.student_id?.editors.some(
            (editor) => editor._id.toString() === userId
          ) ||
          (thread.file_type === 'Essay' &&
            thread.outsourced_user_id?.some(
              (o_user_id) => o_user_id._id.toString() === userId
            ))) &&
        (thread?.application_id?.decided === 'O' || !thread?.application_id) &&
        thread.file_type !== 'Interview' &&
        (thread.student_id?.archiv === false ||
          thread.student_id?.archiv === undefined)
    );

    return filteredThreads;
  },
  async getAllStudentsThreads(req, query) {
    const queryFilter = { ...query };
    const activeStudentsIds = await StudentService.fetchSimpleStudents(req, {
      $or: [{ archiv: { $exists: false } }, { archiv: false }]
    });
    queryFilter.student_id = {
      $in: activeStudentsIds.map((student) => student._id)
    };
    const threads = await req.db
      .model('Documentthread')
      .find(queryFilter)
      .populate(
        'messages.user_id outsourced_user_id',
        'firstname lastname email pictureUrl'
      )
      .populate({
        path: 'student_id',
        populate: {
          path: 'editors agents',
          select: 'firstname lastname email'
        }
      })
      .populate('application_id')
      .populate(
        'program_id',
        'school program_name application_deadline degree semester lang country updatedAt'
      )
      .lean();

    // Enrich programs with hasActiveApplications
    const enrichedThreads = await ProgramService.enrichProgramsWithActiveApplications(
      req,
      threads.map((t) => t.program_id).filter(Boolean)
    );
    const programMap = new Map(enrichedThreads.map((p) => [p._id.toString(), p]));
    
    const threadsWithEnrichedPrograms = threads.map((thread) => {
      if (thread.program_id) {
        thread.program_id = programMap.get(thread.program_id._id?.toString()) || thread.program_id;
      }
      return thread;
    });

    const filteredThreads = threadsWithEnrichedPrograms.filter(
      (thread) =>
        (thread?.application_id?.decided === 'O' || !thread?.application_id) &&
        thread.file_type !== 'Interview'
    );

    return filteredThreads;
  },
  async getThreads(req, filter) {
    const threads = await req.db
      .model('Documentthread')
      .find(filter)
      .populate(
        'student_id',
        'firstname lastname firstname_chinese lastname_chinese role agents editors application_preference pictureUrl'
      )
      .populate('application_id')
      .populate('messages.user_id', 'firstname lastname role pictureUrl')
      .populate('program_id', 'country updatedAt')
      .populate('outsourced_user_id', 'firstname lastname role pictureUrl')
      .lean();
    
    // Enrich programs with hasActiveApplications
    const enrichedThreads = await ProgramService.enrichProgramsWithActiveApplications(
      req,
      threads.map((t) => t.program_id).filter(Boolean)
    );
    const programMap = new Map(enrichedThreads.map((p) => [p._id.toString(), p]));
    
    return threads.map((thread) => {
      if (thread.program_id) {
        thread.program_id = programMap.get(thread.program_id._id?.toString()) || thread.program_id;
      }
      return thread;
    });
  },
  async updateThreadById(req, threadId, payload) {
    return req.db
      .model('Documentthread')
      .findByIdAndUpdate(threadId, payload, { new: true })
      .lean();
  },
  async updateThread(req, filter, payload) {
    return req.db
      .model('Documentthread')
      .findOneAndUpdate(filter, payload, { new: true })
      .lean();
  }
};

module.exports = DocumentThreadService;
