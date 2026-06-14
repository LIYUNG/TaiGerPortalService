const {
  model,
  Schema,
  Types: { ObjectId }
} = require('mongoose');

const { programModule } = require('./Program');

const programKeys = Object.keys(programModule);
const programAIModule = {};
programKeys.forEach((key, i) => {
  programAIModule[key] = {
    Result: {
      type: String
    },
    Source: {
      type: String
    }
  };
});

const programAISchema = new Schema(
  {
    ...programAIModule,
    program_id: { type: ObjectId, ref: 'Program' },
    ai_generated: {
      type: String
    }
  },
  { timestamps: true }
);

const ProgramAI = model('ProgramAI', programAISchema);
module.exports = { ProgramAI, programAISchema };
