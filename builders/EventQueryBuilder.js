const { BaseQueryBuilder } = require('./BaseQueryBuilder');

class EventQueryBuilder extends BaseQueryBuilder {
  constructor() {
    super();
    this.query = {};
  }

  withStartTimeStart(startTime) {
    if (startTime) {
      this.query.start = {
        ...this.query.start,
        $gte: new Date(startTime)
      };
    }
    return this;
  }

  withStartTimeEnd(endTime) {
    if (endTime) {
      this.query.start = {
        ...this.query.start,
        $lte: new Date(endTime)
      };
    }
    return this;
  }

  withEndTimeStart(startTime) {
    if (startTime) {
      this.query.end = {
        ...this.query.end,
        $gte: new Date(startTime)
      };
    }
    return this;
  }

  withEndTimeEnd(endTime) {
    if (endTime) {
      this.query.end = {
        ...this.query.end,
        $lte: new Date(endTime)
      };
    }
    return this;
  }

  withReceiverId(receiverId) {
    if (receiverId) {
      this.query.receiverId = receiverId;
    }
    return this;
  }

  withRequesterId(requesterId) {
    if (requesterId) {
      this.query.requesterId = requesterId;
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

module.exports = EventQueryBuilder;
