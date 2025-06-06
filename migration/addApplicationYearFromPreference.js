const mongoose = require('mongoose');
const { connectToDatabase } = require('../database');

const db = connectToDatabase('TaiGer');

async function addApplicationYear() {
  console.log('Starting migration...');
  const startTime = Date.now();

  try {
    const students = await db.model('Student').find({});
    console.log(`Found ${students.length} students to process`);

    let processedCount = 0;
    let errorCount = 0;

    for (const student of students) {
      try {
        // Get the application year from preference or use current year
        const applicationYear =
          student.application_preference?.expected_application_date || '<TBD>';

        // Update all applications for this student
        await db.model('Student').updateOne(
          { _id: student._id },
          {
            $set: {
              'applications.$[].application_year': applicationYear
            }
          }
        );

        processedCount += 1;
        if (processedCount % 10 === 0) {
          console.log(`Processed ${processedCount} students`);
        }
      } catch (err) {
        errorCount += 1;
        console.error(`Error on student ${student._id}:`, err.message);
      }
    }

    const duration = (Date.now() - startTime) / 1000;
    console.log('\nMigration Summary:');
    console.log(`Processed: ${processedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Time: ${duration.toFixed(2)}s`);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

async function addApplicationIdinThread() {
  console.log('Starting document thread migration...');
  const startTime = Date.now();

  const allApplications = [];

  try {
    const applications = await db.model('Application').find({}).lean();
    console.log(`Found ${applications.length} applications to process`);

    let processedCount = 0;
    let errorCount = 0;

    for (const application of applications) {
      try {
        // Get the application year from preference or use current year
        const applicationId = application._id;

        const doc_ids = application.doc_modification_thread.map(
          (thread) => thread.doc_thread_id
        );
        // Update all applications for this student
        await db.model('Documentthread').updateMany(
          { _id: { $in: doc_ids } },
          {
            $set: {
              application_id: applicationId
            }
          }
        );

        processedCount += 1;
        if (processedCount % 10 === 0) {
          console.log(`Processed ${processedCount} applications`);
        }
      } catch (err) {
        errorCount += 1;
        console.error(`Error on application ${application._id}:`, err.message);
      }
    }

    const duration = (Date.now() - startTime) / 1000;
    console.log('\nMigration Summary:');
    console.log(`Processed: ${processedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Time: ${duration.toFixed(2)}s`);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

async function copyApplicationToNewCollection() {
  console.log('Starting application copy migration...');
  const startTime = Date.now();

  try {
    const students = await db
      .model('Student')
      .find({})
      .select(
        '+applications.portal_credentials.application_portal_a.account +applications.portal_credentials.application_portal_b.account +applications.portal_credentials.application_portal_a.password +applications.portal_credentials.application_portal_b.password'
      );
    console.log(`Found ${students.applications} students to process`);

    let processedCount = 0;
    let errorCount = 0;
    const allApplications = [];

    for (const student of students) {
      try {
        const applications = student.applications.map((application) => {
          // Debug log to check the application data
          //   console.log('Original application:', {
          //     _id: application._id,
          //     programId: application.programId,
          //     type: typeof application.programId
          //   });

          // Ensure programId is properly handled
          const programId = application.programId
            ? new mongoose.Types.ObjectId(application.programId)
            : null;

          return {
            ...application.toObject(), // Convert to plain object
            studentId: student._id,
            programId
          };
        });

        allApplications.push(...applications);
        processedCount += 1;

        if (processedCount % 10 === 0) {
          console.log(`Processed ${processedCount} students`);
        }
      } catch (err) {
        errorCount += 1;
        console.error(`Error on student ${student._id}:`, err.message);
      }
    }

    if (allApplications.length > 0) {
      console.log(`Inserting ${allApplications.length} applications...`);
      await db.model('Application').insertMany(allApplications);
      console.log('Applications inserted successfully');
    } else {
      console.log('No applications to insert');
    }

    const duration = (Date.now() - startTime) / 1000;
    console.log('\nMigration Summary:');
    console.log(`Processed: ${processedCount}`);
    console.log(`Errors: ${errorCount}`);
    console.log(`Time: ${duration.toFixed(2)}s`);

    await addApplicationIdinThread();
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

addApplicationYear();
copyApplicationToNewCollection();
