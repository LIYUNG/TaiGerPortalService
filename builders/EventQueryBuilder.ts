import { BaseQueryBuilder } from './BaseQueryBuilder';

class EventQueryBuilder extends BaseQueryBuilder {
  constructor() {
    super();
    this.query = {};
  }

  withStartTimeStart(startTime: string | number | Date | undefined) {
    if (startTime) {
      this.query.start = {
        ...this.query.start,
        $gte: new Date(startTime)
      };
    }
    return this;
  }

  withStartTimeEnd(endTime: string | number | Date | undefined) {
    if (endTime) {
      this.query.start = {
        ...this.query.start,
        $lte: new Date(endTime)
      };
    }
    return this;
  }

  withEndTimeStart(startTime: string | number | Date | undefined) {
    if (startTime) {
      this.query.end = {
        ...this.query.end,
        $gte: new Date(startTime)
      };
    }
    return this;
  }

  withEndTimeEnd(endTime: string | number | Date | undefined) {
    if (endTime) {
      this.query.end = {
        ...this.query.end,
        $lte: new Date(endTime)
      };
    }
    return this;
  }

  withReceiverId(receiverId: unknown) {
    if (receiverId) {
      this.query.receiver_id = receiverId;
    }
    return this;
  }

  withRequesterId(requesterId: unknown) {
    if (requesterId) {
      this.query.requester_id = requesterId;
    }
    return this;
  }

  withConfirmedReceiver(trueOrFalse = true) {
    this.query.isConfirmedReceiver = trueOrFalse;
    return this;
  }

  withConfirmedRequester(trueOrFalse = true) {
    this.query.isConfirmedRequester = trueOrFalse;
    return this;
  }

  build() {
    return {
      filter: this.query,
      options: this.options
    };
  }
}

export = EventQueryBuilder;
