import { model, Schema, Types } from 'mongoose';

const { ObjectId } = Types;

import { programModule } from './Program';

const programKeys = Object.keys(programModule);
const programAIModule = {};
programKeys.forEach((key, _i) => {
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
export = { ProgramAI, programAISchema };
