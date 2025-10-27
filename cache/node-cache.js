const NodeCache = require('node-cache');
// https://www.npmjs.com/package/node-cache

const ten_minutes_cache = new NodeCache({
  checkperiod: 300,
  stdTTL: 60 * 10
}); // cache 1 month

// if checkperiod = 0 => no periodic check.
const one_day_cache = new NodeCache({
  checkperiod: 86400,
  stdTTL: 86400
}); // cache 1 month

module.exports = {
  ten_minutes_cache,
  one_day_cache
};
