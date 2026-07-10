import { FilterQuery, SortOrder, UpdateQuery } from 'mongoose';
import { IEvent } from '@taiger-common/model';
import { Event } from '../models';

const TEAM_POPULATE_PATH = 'receiver_id requester_id';
const TEAM_POPULATE_SELECT = 'firstname lastname email pictureUrl';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

// Parse pagination/sort params for getEventsPaginated. Events sort on `start`
// (default newest-first for the "Past" list); `_id` is a stable tiebreak.
const parseEventsQuery = (
  query: {
    page?: string | number;
    limit?: string | number;
    sortOrder?: string;
  } = {}
) => {
  const { page, limit, sortOrder } = query;
  const parsedPage = typeof page === 'number' ? page : parseInt(page ?? '', 10);
  const parsedLimit =
    typeof limit === 'number' ? limit : parseInt(limit ?? '', 10);
  const safePage = parsedPage > 0 ? parsedPage : DEFAULT_PAGE;
  const safeLimit =
    parsedLimit > 0 ? Math.min(parsedLimit, MAX_LIMIT) : DEFAULT_LIMIT;
  const sortDir: SortOrder =
    String(sortOrder || 'desc').toLowerCase() === 'asc' ? 1 : -1;
  return {
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
    sort: { start: sortDir, _id: 1 as SortOrder }
  };
};

/**
 * EventDAO — data access for the Event model (default-connection model from
 * models/index.js). Plain params, no req.
 */
const EventDAO = {
  // Flexible event query. `populate` = { path, select }; `select` projects the
  // event document itself.
  async findEvents(
    filter: FilterQuery<IEvent>,
    {
      populate,
      select
    }: { populate?: { path: string; select?: string }; select?: string } = {}
  ) {
    let query = Event.find(filter);
    if (populate) {
      query = query.populate(populate.path, populate.select);
    }
    if (select) {
      query = query.select(select);
    }
    return query.lean();
  },

  async getEventById(eventId: string) {
    return Event.findById(eventId);
  },

  async getEventByIdLean(eventId: string) {
    return Event.findById(eventId).lean();
  },

  async getEventByIdPopulated(eventId: string, populateSelect: string) {
    return Event.findById(eventId)
      .populate(TEAM_POPULATE_PATH, populateSelect)
      .lean();
  },

  async createEvent(payload: Partial<IEvent>) {
    return Event.create(payload);
  },

  async updateEventById(
    eventId: string,
    payload: UpdateQuery<IEvent>,
    populateSelect: string
  ) {
    return Event.findByIdAndUpdate(eventId, payload, {
      upsert: false,
      new: true
    })
      .populate(TEAM_POPULATE_PATH, populateSelect)
      .lean();
  },

  async deleteEventById(eventId: string) {
    return Event.findByIdAndDelete(eventId);
  },

  // Raw update (no populate, returns the pre-update doc) — used where the result
  // is not consumed.
  async updateEventRawById(eventId: string, payload: UpdateQuery<IEvent>) {
    return Event.findByIdAndUpdate(eventId, payload, {});
  },

  // Delete and return the deleted event populated (for cancellation emails).
  async deleteEventByIdPopulated(eventId: string, populateSelect: string) {
    return Event.findByIdAndDelete(eventId)
      .populate(TEAM_POPULATE_PATH, populateSelect)
      .lean();
  },

  /**
   * Server-side paginated events. `filter` is the fully-built Mongo match
   * (role scope + time window, built in the controller); `query` carries
   * page/limit/sortOrder. A plain find+count is enough here — events have no
   * computed/joined columns, and `.find()` auto-casts string ids via the schema
   * (so no aggregation/$facet is needed, unlike the interview/application DAOs).
   *
   * @returns {{ events: object[], total: number, page: number, limit: number }}
   */
  async getEventsPaginated({
    filter = {},
    query = {}
  }: {
    filter?: FilterQuery<IEvent>;
    query?: {
      page?: string | number;
      limit?: string | number;
      sortOrder?: string;
    };
  }) {
    const { page, limit, skip, sort } = parseEventsQuery(query);
    const [events, total] = await Promise.all([
      Event.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate(TEAM_POPULATE_PATH, TEAM_POPULATE_SELECT)
        .lean(),
      Event.countDocuments(filter)
    ]);
    return { events, total, page, limit };
  }
};

export = EventDAO;
