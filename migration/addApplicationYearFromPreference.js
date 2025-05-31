const { connectToDatabase } = require('../database');

const db = connectToDatabase('TaiGer');

async function main() {
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

main();
