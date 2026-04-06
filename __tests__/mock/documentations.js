const { ObjectId } = require('mongoose').Types;
const { faker } = require('@faker-js/faker');

const generateDocsPage = (category = 'visa') => ({
  _id: new ObjectId().toHexString(),
  category,
  content: faker.lorem.paragraphs(2),
  updatedAt: new Date()
});

const generateInternaldoc = () => ({
  _id: new ObjectId().toHexString(),
  title: faker.lorem.words(5),
  category: 'general',
  content: faker.lorem.paragraphs(2),
  isPublic: false,
  updatedAt: new Date()
});

const generateDocumentation = () => ({
  _id: new ObjectId().toHexString(),
  title: faker.lorem.words(5),
  category: 'visa',
  content: faker.lorem.paragraphs(2),
  isPublic: true,
  updatedAt: new Date()
});

const docsPage1 = generateDocsPage('visa');
const docsPage2 = generateDocsPage('housing');
const docsPages = [docsPage1, docsPage2];

const internaldoc1 = generateInternaldoc();
const internaldoc2 = generateInternaldoc();
const internaldocs = [internaldoc1, internaldoc2];

const documentation1 = generateDocumentation();
const documentation2 = generateDocumentation();
const documentations = [documentation1, documentation2];

module.exports = {
  generateDocsPage,
  generateInternaldoc,
  generateDocumentation,
  docsPage1,
  docsPage2,
  docsPages,
  internaldoc1,
  internaldoc2,
  internaldocs,
  documentation1,
  documentation2,
  documentations
};
