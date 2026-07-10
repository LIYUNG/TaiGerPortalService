import mongoose from 'mongoose';

// Function to strip out `required` and `default` properties recursively
const stripModel = (
  modelObj: Record<string, unknown>
): Record<string, unknown> => {
  if (modelObj instanceof mongoose.Schema) {
    throw new Error('Schema instances are not supported.');
  }

  const strippedSchema: Record<string, unknown> = {};

  Object.keys(modelObj).forEach((key) => {
    const value = modelObj[key];

    // Handle shorthand notations
    if (typeof value === 'function' || Array.isArray(value)) {
      strippedSchema[key] = value;
    } else if (typeof value === 'object' && value !== null) {
      const valueObj = value as Record<string, unknown>;
      if (valueObj.type && typeof valueObj.type !== 'object') {
        // Standard type field (non-nested)
        const stripped: { type: unknown; unique?: unknown } = {
          type: valueObj.type
        };
        if (valueObj.unique) {
          stripped.unique = valueObj.unique; // Preserve unique
        }
        strippedSchema[key] = stripped;
      } else {
        // Nested object or array
        strippedSchema[key] = stripModel(valueObj);
      }
    } else {
      strippedSchema[key] = value;
    }
  });

  return strippedSchema;
};

export = stripModel;
