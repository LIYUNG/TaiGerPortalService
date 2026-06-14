import { Schema } from 'mongoose';

const attributeSchema = new Schema({
  value: {
    type: Number,
    required: true
  },
  name: {
    type: String,
    required: true
  }
});

module.exports = {
  attributeSchema
};
