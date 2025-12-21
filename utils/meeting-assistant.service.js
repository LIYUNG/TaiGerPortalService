const axios = require('axios');
const {
  FIREFLIES_API_URL,
  FIREFLIES_API_TOKEN,
  FIREFLIES_GOOGLE_INVITE_N8N_URL
} = require('../config');

/**
 * Schedule invite a TaiGer assitant to a meeting. Creates a Google meeting event by posting meeting details to an external workflow.
 *
 * @async
 * @param {string} meetingSummary - A brief title or description of the meeting.
 * @param {string} meetingLink - The meeting join URL (e.g., a Google Meet link).
 * @param {string|Date} meetingTimeFrom - Meeting start time as an ISO 8601 string or Date.
 * @param {string|Date} meetingTimeTo - Meeting end time as an ISO 8601 string or Date.
 * @returns {Promise<any>} Resolves with the upstream service response payload.
 * @throws {Error} If the request fails, includes the underlying error message or response data.
 */
const scheduleInviteTA = async (
  meetingSummary,
  meetingLink,
  meetingTimeFrom,
  meetingTimeTo
) => {
  if (!FIREFLIES_GOOGLE_INVITE_N8N_URL) {
    throw new Error('FIREFLIES_GOOGLE_INVITE_N8N_URL is not configured');
  }

  if (!meetingSummary || !meetingLink || !meetingTimeFrom || !meetingTimeTo) {
    throw new Error(
      'Missing required parameters: meetingSummary, meetingLink, meetingTimeFrom, meetingTimeTo'
    );
  }

  try {
    const payload = {
      summary: meetingSummary,
      url: meetingLink,
      start: meetingTimeFrom,
      end: meetingTimeTo
    };

    const response = await axios.post(FIREFLIES_GOOGLE_INVITE_N8N_URL, payload);
    return response.data;
  } catch (error) {
    const errorMessage = error.response?.data || error.message;
    throw new Error(
      `Failed to create Google Meeting event: ${JSON.stringify(errorMessage)}`
    );
  }
};

/**
 * Adds a TaiGer assistant to a live meeting.
 *
 * Sends the AddToLiveMeeting mutation with the meeting link and a title derived from
 * the provided meeting summary. Handles GraphQL- and HTTP-level failures, including
 * rate limiting (too_many_requests).
 *
 * @function instantInviteTA
 * @async
 * @param {string} meetingSummary - Title or short summary to label the meeting.
 * @param {string} meetingLink - URL of the live meeting to join.
 * @returns {Promise<InstantInviteResult>} A discriminated result describing success or detailed failure reasons.
 *
 *  * Success example from Fireflies API:
 *   { data: { addToLiveMeeting: { success: true } } }
 *
 * Common failure example (rate limited):
 *   [{
 *     "friendly": true,
 *     "message": "Too many requests. Please retry after <timestamp>",
 *     "extensions": {
 *       "code": "too_many_requests",
 *       "status": 429,
 *       "metadata": { "retryAfter": 1766168190612 }
 *     }
 *   }]
 *
 */
const instantInviteTA = async (meetingSummary, meetingLink) => {
  if (!FIREFLIES_API_URL || !FIREFLIES_API_TOKEN) {
    throw new Error(
      'FIREFLIES_API_URL or FIREFLIES_API_TOKEN is not configured'
    );
  }

  if (!meetingSummary || !meetingLink) {
    throw new Error('Missing required parameters: meetingSummary, meetingLink');
  }

  try {
    const response = await axios.post(
      FIREFLIES_API_URL,
      {
        query: `
          mutation AddToLiveMeeting($meetingLink: String!, $title: String) {
            addToLiveMeeting(
              meeting_link: $meetingLink
              title: $title
            ) {
              success
            }
          }
        `,
        variables: {
          meetingLink,
          title: meetingSummary
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${FIREFLIES_API_TOKEN}`
        }
      }
    );

    const { data, errors } = response.data || {};

    // 1️⃣ Handle GraphQL errors (even if HTTP 200)
    if (errors?.length) {
      const rateLimitError = errors.find(
        (err) => err.extensions?.code === 'too_many_requests'
      );

      if (rateLimitError) {
        const retryAfter = rateLimitError.extensions?.metadata?.retryAfter;

        return {
          success: false,
          rateLimited: true,
          retryAfter,
          message: rateLimitError.message
        };
      }

      return {
        success: false,
        message: 'GraphQL error',
        errors
      };
    }

    // 2️⃣ Validate mutation response
    const mutationResult = data?.addToLiveMeeting;

    if (!mutationResult?.success) {
      return {
        success: false,
        message: 'Instant invite unsuccessful',
        response: mutationResult
      };
    }

    // 3️⃣ Success path
    return {
      success: true,
      payload: mutationResult
    };
  } catch (error) {
    // 4️⃣ Handle HTTP-level errors (network, 5xx, etc.)
    if (axios.isAxiosError(error)) {
      return {
        success: false,
        message: 'HTTP request failed',
        status: error.response?.status,
        data: error.response?.data
      };
    }

    return {
      success: false,
      message: 'Unexpected error',
      error: error.message
    };
  }
};

module.exports = {
  scheduleInviteTA,
  instantInviteTA
};
