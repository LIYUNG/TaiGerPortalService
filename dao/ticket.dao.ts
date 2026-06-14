import { Ticket } from '../models';

const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * TicketDAO — data access for the Ticket model (central default-connection
 * model). Plain params, no req.
 */
const TicketDAO = {
  // Paginated + searchable overview. Joins the referenced program and requester
  // so the search can span the program's school/name and the requester's name,
  // not just the ticket's own description. Returns { tickets, total }.
  async getTicketsOverview({
    filters = {},
    search = '',
    skip = 0,
    limit = 20,
    sort = { createdAt: -1 }
  } = {}) {
    const match = {};
    if (filters.type) {
      match.type = filters.type;
    }
    if (filters.status) {
      match.status = filters.status;
    }

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: 'programs',
          let: { pid: '$program_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$pid'] } } },
            {
              $project: {
                school: 1,
                program_name: 1,
                degree: 1,
                semester: 1
              }
            }
          ],
          as: 'program_id'
        }
      },
      { $unwind: { path: '$program_id', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'users',
          let: { rid: '$requester_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$rid'] } } },
            { $project: { firstname: 1, lastname: 1, email: 1 } }
          ],
          as: 'requester_id'
        }
      },
      { $unwind: { path: '$requester_id', preserveNullAndEmptyArrays: true } }
    ];

    if (search) {
      const regex = { $regex: escapeRegex(search), $options: 'i' };
      pipeline.push({
        $match: {
          $or: [
            { description: regex },
            { 'program_id.school': regex },
            { 'program_id.program_name': regex },
            { 'requester_id.firstname': regex },
            { 'requester_id.lastname': regex },
            { 'requester_id.email': regex }
          ]
        }
      });
    }

    pipeline.push({
      $facet: {
        data: [{ $sort: sort }, { $skip: skip }, { $limit: limit }],
        total: [{ $count: 'count' }]
      }
    });

    const [result] = await Ticket.aggregate(pipeline);
    return {
      tickets: result?.data ?? [],
      total: result?.total?.[0]?.count ?? 0
    };
  },

  async getTickets(query, { populateRequester = false } = {}) {
    const cursor = Ticket.find(query).populate(
      'program_id',
      'school program_name degree'
    );
    if (populateRequester) {
      cursor.populate('requester_id', 'firstname lastname email');
    }
    return cursor.sort({ createdAt: -1 });
  },

  async createTicket(data) {
    return Ticket.create(data);
  },

  async updateTicketById(id, fields) {
    return Ticket.findByIdAndUpdate(id, fields, { new: true })
      .populate('requester_id', 'firstname lastname email archiv')
      .populate('program_id', 'school program_name degree semester');
  },

  async deleteTicketById(id) {
    return Ticket.findByIdAndDelete(id);
  },

  async deleteTicketsByProgramId(programId) {
    return Ticket.deleteMany({ program_id: programId });
  }
};

module.exports = TicketDAO;
