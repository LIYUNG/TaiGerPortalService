const NodeCache = require('node-cache');
// https://www.npmjs.com/package/node-cache

const ten_minutes_cache = new NodeCache({
  checkperiod: 300,
  stdTTL: 60 * 10
}); // cache 1 month

module.exports = {
  ten_minutes_cache
};
