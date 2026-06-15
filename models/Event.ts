import { EventSchema } from '@taiger-common/model';

EventSchema.index({ receiver_id: 1 });
EventSchema.index({ requester_id: 1 });
EventSchema.index({ start: 1 });

// Race-proof office-hours slot exclusivity: a given agent/editor timeslot can be
// booked by only one student. `receiver_id` is an array (multikey) but `start`
// is scalar, so this compound unique index is permitted, and two documents with
// an overlapping (receiver element, start) pair collide at insert (E11000) —
// closing the gap the app-level conflict check leaves open under concurrency.
// NOTE (ops): if the collection already contains duplicate (receiver_id, start)
// docs the unique build is skipped (autoIndex logs it); dedupe existing rows for
// the index to take effect. Until then the app-level check remains the guard.
EventSchema.index({ receiver_id: 1, start: 1 }, { unique: true });

export = { EventSchema };
