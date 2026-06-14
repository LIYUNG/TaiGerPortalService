const mongoose = require('mongoose');

// Function to strip out `required` and `default` properties recursively
const stripModel = (modelObj) => {
  if (modelObj instanceof mongoose.Schema) {
    throw new Error('Schema instances are not supported.');
  }

  const strippedSchema = {};

  Object.keys(modelObj).forEach((key) => {
    const value = modelObj[key];

    // Handle shorthand notations
    if (typeof value === 'function' || Array.isArray(value)) {
      strippedSchema[key] = value;
    } else if (typeof value === 'object' && value !== null) {
      if (value.type && typeof value.type !== 'object') {
        // Standard type field (non-nested)
        strippedSchema[key] = { type: value.type };
        if (value.unique) {
          strippedSchema[key].unique = value.unique; // Preserve unique
        }
      } else {
        // Nested object or array
        strippedSchema[key] = stripModel(value);
      }
    } else {
      strippedSchema[key] = value;
    }
  });

  return strippedSchema;
};

module.exports = stripModel;
