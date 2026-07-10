import { model, Schema, Types } from 'mongoose';

import { programModule } from './Program';

const { ObjectId } = Types;

const programKeys = Object.keys(programModule);
const programAIModule: Record<string, unknown> = {};
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

export const programAISchema = new Schema(
  {
    ...programAIModule,
    program_id: { type: ObjectId, ref: 'Program' },
    ai_generated: {
      type: String
    }
  },
  { timestamps: true }
);

export const ProgramAI = model('ProgramAI', programAISchema);
