import { Documentation, User, Internaldoc, Program } from '../models';

// Escape regex metacharacters so the user's query is matched literally — avoids
// invalid-regex crashes and ReDoS from attacker-controlled input (e.g. "C++",
// "a(b").
const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Split a query into whitespace-separated terms (e.g. "tum elektrotechnik" ->
// ["tum", "elektrotechnik"]).
const toTerms = (q: string) => q.trim().split(/\s+/).filter(Boolean);

// Build a filter where EVERY term must appear (case-insensitive substring) in
// AT LEAST ONE of `fields` — an AND across terms, OR across fields. This lets a
// query span multiple fields: "tum elektrotechnik" matches a program whose
// school contains "tum" and whose program_name contains "elektrotechnik", even
// though no single field contains the whole string. Substring (not whole-word)
// also means "tes" matches "testing" — the old $text search only matched whole,
// stemmed tokens, so "tes" and cross-field queries both returned nothing.
const matchesAllTerms = (q: string, fields: string[]) => {
  const terms = toTerms(q);
  const safeTerms = terms.length > 0 ? terms : [''];
  return {
    $and: safeTerms.map((term) => ({
      $or: fields.map((field) => ({
        [field]: { $regex: escapeRegExp(term), $options: 'i' }
      }))
    }))
  };
};

// Lightweight relevance rank so the combined result list can be ordered. Each
// term scores against its best field — exact (3) > prefix (2) > substring (1) —
// and the per-term scores are summed, so results matching more terms (or
// matching them more tightly) rank higher. Replaces the old $text `textScore`
// (regex search has no built-in score). Consumed by SearchService's byScoreDesc.
const rank = (q: string, values: unknown[]): number => {
  const terms = toTerms(q).map((term) => term.toLowerCase());
  if (terms.length === 0) return 0;
  const haystacks = values
    .filter((value) => value != null)
    .map((value) => String(value).toLowerCase());

  let total = 0;
  for (const term of terms) {
    let best = 0;
    for (const hay of haystacks) {
      const index = hay.indexOf(term);
      if (index === -1) continue;
      if (hay === term) best = Math.max(best, 3);
      else if (index === 0) best = Math.max(best, 2);
      else best = Math.max(best, 1);
    }
    total += best;
  }
  return total;
};

const USER_SEARCH_FIELDS = [
  'firstname',
  'lastname',
  'firstname_chinese',
  'lastname_chinese',
  'email'
];

/**
 * SearchDAO — read-only substring search across several models (central
 * default-connection models). Plain params, no req.
 */
const SearchDAO = {
  async searchPublicDocumentations(q: string) {
    const docs = await Documentation.find({
      ...matchesAllTerms(q, ['title', 'text']),
      category: { $not: { $regex: new RegExp('portal-instruction', 'i') } }
    })
      .limit(5)
      .select('title')
      .lean();
    return docs.map((doc) => ({ ...doc, score: rank(q, [doc.title]) }));
  },

  async searchUsers(q: string) {
    const users = await User.find({
      ...matchesAllTerms(q, USER_SEARCH_FIELDS),
      role: { $in: ['Student', 'Guest', 'Agent', 'Editor'] }
    })
      .limit(5)
      .select('firstname lastname firstname_chinese lastname_chinese role')
      .lean();
    return users.map((user) => ({
      ...user,
      score: rank(q, [
        user.firstname,
        user.lastname,
        user.firstname_chinese,
        user.lastname_chinese
      ])
    }));
  },

  async searchDocumentations(q: string) {
    const docs = await Documentation.find(matchesAllTerms(q, ['title', 'text']))
      .limit(5)
      .select('title')
      .lean();
    return docs.map((doc) => ({ ...doc, score: rank(q, [doc.title]) }));
  },

  async searchInternaldocs(q: string) {
    const docs = await Internaldoc.find(matchesAllTerms(q, ['title', 'text']))
      .limit(5)
      .select('title internal')
      .lean();
    return docs.map((doc) => ({ ...doc, score: rank(q, [doc.title]) }));
  },

  async searchPrograms(q: string) {
    const programs = await Program.find({
      ...matchesAllTerms(q, ['school', 'program_name']),
      isArchiv: { $ne: true }
    })
      .limit(5)
      .select('school program_name degree semester')
      .lean();
    return programs.map((program) => ({
      ...program,
      score: rank(q, [program.school, program.program_name])
    }));
  },

  async searchStudentsByName(q: string) {
    return User.find({
      ...matchesAllTerms(q, USER_SEARCH_FIELDS),
      role: { $in: ['Student'] }
    })
      .limit(6)
      .select(
        'firstname lastname firstname_chinese lastname_chinese role email'
      )
      .lean();
  }
};

export = SearchDAO;
