import { complaintSchema } from '@taiger-common/model';

complaintSchema.index({ requester_id: 1 });

export = { complaintSchema };
