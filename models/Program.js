const { Schema } = require('mongoose');
const mongoose = require('mongoose');
const { programModule } = require('@taiger-common/model');
const {
  handleProgramChanges,
  enableVersionControl
} = require('../utils/modelHelper/versionControl');

const programSchema = new Schema(programModule, { timestamps: true });

programSchema.index({ school: 1, program_name: 1 });

// Version-control + program-change plugins are applied ONCE on the shared
// schema. The plugins resolve their sibling models (Student/Application/VC/...)
// from the connection of the model that fired the hook (`this.model.db`), so
// both the default-connection Program (below) and the per-request Program
// (database.js#applyProgramSchema, which compiles from this same schema) get the
// hooks exactly once — no double-fire.
programSchema.plugin(handleProgramChanges);
programSchema.plugin(enableVersionControl);

const Program = mongoose.model('Program', programSchema);
module.exports = {
  Program,
  programSchema,
  programModule
};
