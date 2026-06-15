import NodeCache from 'node-cache';
// https://www.npmjs.com/package/node-cache

export const ten_minutes_cache = new NodeCache({
  checkperiod: 300,
  stdTTL: 60 * 10
}); // cache 1 month

// Short-lived cache for values that change rarely but are read on every request
// (e.g. the active-students id set behind the thread dashboards).
export const two_minutes_cache = new NodeCache({
  checkperiod: 60,
  stdTTL: 60 * 2
});
