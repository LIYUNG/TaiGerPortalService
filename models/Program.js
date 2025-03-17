const { Schema } = require('mongoose');
const mongoose = require('mongoose');
const { programModule } = require('@taiger-common/model');

const programSchema = new Schema(programModule, { timestamps: true });

programSchema.index({ school: 1, program_name: 1 });
const Program = mongoose.model('Program', programSchema);
module.exports = {
  Program,
  programSchema,
  programModule
};
