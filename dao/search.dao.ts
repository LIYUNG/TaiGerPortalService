import { Documentation, User, Internaldoc, Program } from '../models';

const textScore = { score: { $meta: 'textScore' } };

/**
 * SearchDAO — read-only text/regex search across several models (central
 * default-connection models). Plain params, no req.
 */
const SearchDAO = {
  async searchPublicDocumentations(q) {
    return Documentation.find(
      {
        $text: { $search: q },
        category: { $not: { $regex: new RegExp('portal-instruction', 'i') } }
      },
      textScore
    )
      .sort(textScore)
      .limit(5)
      .select('title')
      .lean();
  },

  async searchUsers(q) {
    return User.find(
      {
        $text: { $search: q },
        role: { $in: ['Student', 'Guest', 'Agent', 'Editor'] }
      },
      textScore
    )
      .sort(textScore)
      .limit(5)
      .select('firstname lastname firstname_chinese lastname_chinese role')
      .lean();
  },

  async searchDocumentations(q) {
    return Documentation.find({ $text: { $search: q } }, textScore)
      .sort(textScore)
      .limit(5)
      .select('title')
      .lean();
  },

  async searchInternaldocs(q) {
    return Internaldoc.find({ $text: { $search: q } }, textScore)
      .sort(textScore)
      .limit(5)
      .select('title internal')
      .lean();
  },

  async searchPrograms(q) {
    return Program.find(
      { $text: { $search: q }, isArchiv: { $ne: true } },
      textScore
    )
      .sort(textScore)
      .limit(5)
      .select('school program_name degree semester')
      .lean();
  },

  async searchStudentsByName(q) {
    return User.find({
      $and: [
        {
          $or: [
            { firstname: { $regex: q, $options: 'i' } },
            { lastname: { $regex: q, $options: 'i' } },
            { firstname_chinese: { $regex: q, $options: 'i' } },
            { lastname_chinese: { $regex: q, $options: 'i' } },
            { email: { $regex: q, $options: 'i' } }
          ]
        },
        { role: { $in: ['Student'] } }
      ]
    })
      .limit(6)
      .select(
        'firstname lastname firstname_chinese lastname_chinese role email'
      )
      .lean();
  }
};

module.exports = SearchDAO;
