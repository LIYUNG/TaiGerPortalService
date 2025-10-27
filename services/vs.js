const VCService = {
  async getVC(req, filter) {
    return req.db.model('VC').findOne(filter).lean();
  }
};

module.exports = VCService;
