const { is_TaiGer_Agent, is_TaiGer_Editor } = require('@taiger-common/core');

const queryStudent = (q, user) => {
  const query = { ...q };
  if (is_TaiGer_Agent(user)) {
    query.agents = user._id.toString();
  } else if (is_TaiGer_Editor(user)) {
    query.editors = user._id.toString();
  }
  return query;
};

module.exports = { queryStudent };
