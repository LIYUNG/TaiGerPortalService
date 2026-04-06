BEGIN;

ALTER TABLE leads
ADD COLUMN source_country varchar(100);

ALTER TABLE leads
ALTER COLUMN preferred_contact TYPE varchar(255);

ALTER TABLE leads
RENAME COLUMN source TO referral_source;

CREATE TABLE IF NOT EXISTS lead_profile (
  lead_id text PRIMARY KEY REFERENCES leads(id) ON DELETE CASCADE,
  is_currently_studying text,
  current_year_or_graduated text,
  current_status text,
  bachelor_school text,
  bachelor_gpa text,
  bachelor_program_name text,
  graduated_bachelor_school text,
  graduated_bachelor_program text,
  graduated_bachelor_gpa text,
  master_school text,
  master_program_name text,
  master_gpa text,
  highest_education text,
  highschool_name text,
  highschool_gpa text,
  intended_programs text,
  intended_direction text,
  intended_start_time text,
  intended_program_level text,
  english_level text,
  german_level text,
  work_experience text,
  other_activities text,
  awards text,
  additional_info text,
  reason_for_germany text,
  reasons_to_study_abroad text,
  promo_code text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_tags (
  id text PRIMARY KEY,
  lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tag text NOT NULL,
  created_by varchar(64),
  created_at timestamp DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lead_profile TO PUBLIC;

CREATE UNIQUE INDEX IF NOT EXISTS lead_tags_lead_id_tag_unique
  ON lead_tags (lead_id, tag);

CREATE TABLE IF NOT EXISTS lead_notes (
  id text PRIMARY KEY,
  lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by varchar(64),
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_notes_lead_id_created_at_idx
  ON lead_notes (lead_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lead_notes TO PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE lead_tags TO PUBLIC;

INSERT INTO lead_profile (
  lead_id,
  is_currently_studying,
  current_year_or_graduated,
  current_status,
  bachelor_school,
  bachelor_gpa,
  bachelor_program_name,
  graduated_bachelor_school,
  graduated_bachelor_program,
  graduated_bachelor_gpa,
  master_school,
  master_program_name,
  master_gpa,
  highest_education,
  highschool_name,
  highschool_gpa,
  intended_programs,
  intended_direction,
  intended_start_time,
  intended_program_level,
  english_level,
  german_level,
  work_experience,
  other_activities,
  awards,
  additional_info,
  reason_for_germany,
  reasons_to_study_abroad,
  promo_code,
  created_at,
  updated_at
)
SELECT
  id,
  is_currently_studying,
  current_year_or_graduated,
  current_status,
  bachelor_school,
  bachelor_gpa,
  bachelor_program_name,
  graduated_bachelor_school,
  graduated_bachelor_program,
  graduated_bachelor_gpa,
  master_school,
  master_program_name,
  master_gpa,
  highest_education,
  highschool_name,
  highschool_gpa,
  intended_programs,
  intended_direction,
  intended_start_time,
  intended_program_level,
  english_level,
  german_level,
  work_experience,
  other_activities,
  awards,
  additional_info,
  reason_for_germany,
  reasons_to_study_abroad,
  promo_code,
  created_at,
  updated_at
FROM leads;

INSERT INTO lead_tags (id, lead_id, tag, created_at)
SELECT
  md5(l.id || ':' || trim(tag)),
  l.id,
  trim(tag),
  l.created_at
FROM leads l
CROSS JOIN LATERAL unnest(string_to_array(coalesce(l.tags, ''), ',')) AS tag
WHERE trim(tag) <> '';

INSERT INTO lead_notes (id, lead_id, note, created_at)
SELECT
  md5(l.id || ':' || l.notes),
  l.id,
  l.notes,
  l.created_at
FROM leads l
WHERE l.notes IS NOT NULL AND l.notes <> '';

COMMIT;
