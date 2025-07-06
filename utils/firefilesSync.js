const { FIREFILES_API_TOKEN } = require('../config');
const { transcripts } = require('../drizzle/schema/schema');
const { sql } = require('drizzle-orm');
const { postgresDb } = require('../database');
const fetch = require('node-fetch');

async function fetchAllTranscripts() {
  const query = `
    query GetAllTranscripts {
      transcripts {
        id
        title
        speakers {
          id
          name
        }
        transcript_url
        participants
        meeting_attendees {
          displayName
          email
          name
        }
        duration
        date
        dateString
        summary {
          keywords
          action_items
          shorthand_bullet
          overview
          bullet_gist
          gist
          short_summary
        }
        meeting_info {
          fred_joined
          silent_meeting
          summary_status
        }
      }
    }
  `;

  const response = await fetch('https://api.fireflies.ai/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FIREFILES_API_TOKEN}`
    },
    body: JSON.stringify({ query })
  });

  const result = await response.json();
  return result?.data?.transcripts || [];
}

async function syncAllTranscripts() {
  const allTranscripts = await fetchAllTranscripts();
  if (!allTranscripts.length) {
    console.log('No transcripts to sync.');
    return;
  } else {
    console.log(`Fetched ${allTranscripts.length} transcripts from Fireflies.`);
  }

  const mappedTranscripts = allTranscripts.map((t) => ({
    id: t.id,
    title: t.title ?? '',
    speakers: t.speakers ?? [],
    transcriptUrl: t.transcript_url ?? '',
    participants: t.participants ?? [],
    meetingAttendees: t.meeting_attendees ?? [],
    duration: t.duration ?? 0,
    date: t.date ? new Date(t.date).getTime() : Date.now(),
    dateString: t.dateString ?? '',
    summary: t.summary ?? {},
    meetingInfo: t.meeting_info ?? {}
  }));

  await postgresDb
    .insert(transcripts)
    .values(mappedTranscripts)
    .onConflictDoUpdate({
      target: transcripts.id, // primary key
      set: {
        title: sql`excluded.title`,
        speakers: sql`excluded.speakers`,
        transcriptUrl: sql`excluded.transcript_url`,
        participants: sql`excluded.participants`,
        meetingAttendees: sql`excluded.meeting_attendees`,
        duration: sql`excluded.duration`,
        date: sql`excluded.date`,
        dateString: sql`excluded.date_string`,
        summary: sql`excluded.summary`,
        meetingInfo: sql`excluded.meeting_info`
      }
    });

  console.log(`Synced ${mappedTranscripts.length} transcripts successfully.`);
}

module.exports = { fetchAllTranscripts, syncAllTranscripts };
