const {
  model,
  Schema,
  Types: { ObjectId }
} = require('mongoose');

const changesSchema = new Schema(
  {
    originalValues: Object,
    updatedValues: { type: Object, required: true },
    changedAt: {
      type: Date,
      default: () => Date.now()
    },
    changedBy: {
      type: String
      // type: mongoose.Schema.Types.ObjectId,
      // ref: 'User'
    },
    changeRequest: {
      type: ObjectId,
      refPath: 'changeRequestRef'
    }
  },
  { _id: false }
);

const versionControlSchema = new Schema({
  docId: {
    type: ObjectId,
    refPath: 'collectionName'
  },
  collectionName: {
    type: String,
    required: true
  },
  changes: [changesSchema]
});

// Mapping to original collection and change request collection
const collectionMap = {
  Program: 'ProgramChangeRequest'
};
versionControlSchema.virtual('changeRequestRef').get(function () {
  return collectionMap?.[this.collectionName];
});

versionControlSchema.statics.getVersion = async function (
  docId,
  collectionName
) {
  return await this.findOne({ docId, collectionName });
};

versionControlSchema.index({ docId: 1, collectionName: 1 });

const VC = model('VC', versionControlSchema);

module.exports = { VC, versionControlSchema };
