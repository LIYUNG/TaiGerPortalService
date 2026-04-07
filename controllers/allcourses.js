const { asyncHandler } = require('../middlewares/error-handler');
const logger = require('../services/logger');

const getCourses = asyncHandler(async (req, res) => {
  const courses = await req.db
    .model('Allcourse')
    .find()
    .populate('updatedBy', 'firstname lastname pictureUrl')
    .lean();
  res.status(200).send({ success: true, data: courses });
});

const getCourse = asyncHandler(async (req, res) => {
  const { courseId } = req.params;

  const course = await req.db
    .model('Allcourse')
    .findById(courseId)
    .populate('updatedBy', 'firstname lastname pictureUrl');

  if (!course) {
    return res
      .status(404)
      .send({ success: false, message: 'Course not found.' });
  }

  res.status(200).send({ success: true, data: course });
});

const deleteCourse = asyncHandler(async (req, res) => {
  const { courseId } = req.params;

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
  const { user } = req;
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
    payload.updatedBy = user._id;
    const updatedCourse = await req.db
      .model('Allcourse')
      .findByIdAndUpdate(courseId, payload, { new: true, runValidators: true })
      .populate('updatedBy', 'firstname lastname pictureUrl');

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
