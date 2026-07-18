/**
 * Set `isNC: false` on Program documents whose free-text fields say the program
 * has no Numerus Clausus ("no NC", "kein NC", "NC-frei", "zulassungsfrei").
 *
 * The Program schema defaults `isNC` to true, so every program is implicitly
 * NC-restricted until told otherwise. This migration finds the ones whose prose
 * contradicts that default and flips them.
 *
 * Runs against the raw collection (`Program.collection`) rather than the
 * mongoose Model on purpose: models/Program.ts registers the
 * `handleProgramChanges` / `enableVersionControl` plugins on QUERY_UPDATE_HOOKS,
 * and their pre-hook does `this.model.find(condition).lean()` — a Model-level
 * updateMany would pull every matching doc into memory and write a
 * version-control entry per doc. Collection-level ops skip middleware.
 * Trade-off: this migration leaves no version-control/audit trail, which is what
 * we want for a one-off backfill.
 *
 * Usage (from repo root). MONGODB_URI_MIGRATION is the FULL connection string
 * including the database name — it is never committed:
 *
 *   # dry run — lists the matching programs, writes nothing
 *   $env:MONGODB_URI_MIGRATION="mongodb+srv://...\/TaiGer_Prod?retryWrites=true&w=majority"
 *   npx ts-node --transpile-only scripts/migrations/setProgramsIsNC.ts
 *
 *   # actually write
 *   npx ts-node --transpile-only scripts/migrations/setProgramsIsNC.ts --apply
 */
/* eslint-disable no-console -- standalone CLI migration, not the request path */
import mongoose from 'mongoose';

import { Program } from '../../models/Program';

const APPLY = process.argv.includes('--apply');

// Matches "No NC", "no-nc", "kein NC", "NC-frei", "zulassungsfrei".
const NO_NC_PATTERN = 'no[\\s-]*nc|kein[\\s-]*nc|nc[\\s-]*frei|zulassungsfrei';
const noNcRegex = { $regex: NO_NC_PATTERN, $options: 'i' };

// Only the free-text fields that realistically carry this phrasing. Kept
// explicit rather than scanning every field so the match set stays reviewable.
const filter = {
  $or: [
    { special_notes: noNcRegex },
    { comments: noNcRegex },
    { gpa_requirement: noNcRegex }
  ]
};

const run = async () => {
  const prod_uri = ``;
  await mongoose.connect(prod_uri);
  // Log the host/db only — never the credentials in the URI.
  const { host, name } = mongoose.connection;
  console.log(`Connected to ${host}/${name}`);

  try {
    const total = await Program.collection.countDocuments({});
    const matched = await Program.collection.countDocuments(filter);
    // Docs already at isNC:false need no write; reported so matched vs. modified
    // below is not surprising.
    const alreadyFalse = await Program.collection.countDocuments({
      ...filter,
      isNC: false
    });

    console.log(`Programs total:            ${total}`);
    console.log(`Matching "no NC" text:     ${matched}`);
    console.log(`  ...already isNC=false:   ${alreadyFalse}`);
    console.log(`  ...to be flipped:        ${matched - alreadyFalse}`);

    const sample = await Program.collection
      .find(filter, {
        projection: {
          school: 1,
          program_name: 1,
          isNC: 1,
          special_notes: 1,
          comments: 1,
          gpa_requirement: 1
        }
      })
      .toArray();

    console.log('\nMatching programs:');
    for (const doc of sample) {
      const hit =
        [doc.special_notes, doc.comments, doc.gpa_requirement]
          .filter((v): v is string => typeof v === 'string')
          .find((v) => new RegExp(NO_NC_PATTERN, 'i').test(v)) ?? '';
      console.log(
        `  [isNC=${doc.isNC}] ${doc.school} — ${doc.program_name}\n` +
          `      ${hit.replace(/\s+/g, ' ').slice(0, 160)}`
      );
    }

    if (!APPLY) {
      console.log(
        `\nDRY RUN — nothing written. Review the list above, then re-run with ` +
          `--apply to set isNC=false on ${matched} document(s).`
      );
      return;
    }

    const result = await Program.collection.updateMany(filter, {
      $set: { isNC: false, updatedAt: new Date() }
    });

    console.log(
      `\nDone. matched=${result.matchedCount} modified=${result.modifiedCount}`
    );
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected');
  }
};

run().catch((error) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
