const { Role, is_TaiGer_Agent } = require('@taiger-common/core');

const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');

const getCourses = asyncHandler(async (req, res) => {
  const courses = await req.db.model('Allcourse').find();
  res.status(200).send({ success: true, data: courses });
});

const getCourse = asyncHandler(async (req, res) => {
  const { courseId } = req.params;

  if (!courseId.match(/^[0-9a-fA-F]{24}$/)) {
    // Check if courseId is a valid ObjectId
    return res
      .status(400)
      .send({ success: false, message: 'Invalid course ID.' });
  }

  const course = await req.db.model('Allcourse').findById(courseId);

  if (!course) {
    return res
      .status(404)
      .send({ success: false, message: 'Course not found.' });
  }

  res.status(200).send({ success: true, data: course });
});

const deleteCourse = asyncHandler(async (req, res) => {
  const { courseId } = req.params;

  if (!courseId.match(/^[0-9a-fA-F]{24}$/)) {
    // Check if courseId is a valid ObjectId
    return res
      .status(400)
      .send({ success: false, message: 'Invalid course ID.' });
  }

  const course = await req.db.model('Allcourse').findByIdAndDelete(courseId);

  if (!course) {
    return res
      .status(404)
      .send({ success: false, message: 'Course not found.' });
  }

  res
    .status(200)
    .send({ success: true, message: 'Course deleted successfully.' });
});

const updateCourse = asyncHandler(async (req, res) => {
  const { courseId } = req.params; // Expecting courseId as a parameter
  const payload = req.body;

  // Validation for required fields
  if (!payload.all_course_chinese || !payload.all_course_english) {
    return res.status(400).send({
      success: false,
      message: 'Course name (English and Chinese) is required.'
    });
  }

  try {
    // Attempt to find and update the course
    const updatedCourse = await req.db
      .model('Allcourse')
      .findByIdAndUpdate(courseId, payload, { new: true, runValidators: true });

    if (!updatedCourse) {
      return res.status(404).send({
        success: false,
        message: 'Course not found.'
      });
    }

    res.status(200).send({
      success: true,
      message: 'Course updated successfully.',
      data: updatedCourse
    });
  } catch (error) {
    res.status(500).send({
      success: false,
      message: 'Error updating course.',
      error: error.message
    });
  }
});

const createCourse = asyncHandler(async (req, res) => {
  const payload = req.body;

  if (!payload.all_course_chinese || !payload.all_course_english) {
    return res.status(400).send({
      success: false,
      message: 'Course name (English and Chinese) and are required.'
    });
  }

  try {
    const newCourse = await req.db.model('Allcourse').create(payload);

    res.status(201).send({
      success: true,
      message: 'Course created successfully.',
      data: newCourse
    });
  } catch (error) {
    res.status(500).send({
      success: false,
      message: 'Error creating course.',
      error: error.message
    });
  }
});

module.exports = {
  getCourses,
  getCourse,
  deleteCourse,
  updateCourse,
  createCourse
};
