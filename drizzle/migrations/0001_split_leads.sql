BEGIN;

CREATE TABLE IF NOT EXISTS lead_additional (
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

CREATE UNIQUE INDEX IF NOT EXISTS lead_tags_lead_id_tag_unique
  ON lead_tags (lead_id, tag);

CREATE TABLE IF NOT EXISTS lead_notes (
  id text PRIMARY KEY,
  lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by varchar(64),
  created_at timestamp DEFAULT now()
);

INSERT INTO lead_additional (
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

ALTER TABLE leads
  DROP COLUMN IF EXISTS tags,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS is_currently_studying,
  DROP COLUMN IF EXISTS current_year_or_graduated,
  DROP COLUMN IF EXISTS current_status,
  DROP COLUMN IF EXISTS bachelor_school,
  DROP COLUMN IF EXISTS bachelor_gpa,
  DROP COLUMN IF EXISTS bachelor_program_name,
  DROP COLUMN IF EXISTS graduated_bachelor_school,
  DROP COLUMN IF EXISTS graduated_bachelor_program,
  DROP COLUMN IF EXISTS graduated_bachelor_gpa,
  DROP COLUMN IF EXISTS master_school,
  DROP COLUMN IF EXISTS master_program_name,
  DROP COLUMN IF EXISTS master_gpa,
  DROP COLUMN IF EXISTS highest_education,
  DROP COLUMN IF EXISTS highschool_name,
  DROP COLUMN IF EXISTS highschool_gpa,
  DROP COLUMN IF EXISTS intended_programs,
  DROP COLUMN IF EXISTS intended_direction,
  DROP COLUMN IF EXISTS intended_start_time,
  DROP COLUMN IF EXISTS intended_program_level,
  DROP COLUMN IF EXISTS english_level,
  DROP COLUMN IF EXISTS german_level,
  DROP COLUMN IF EXISTS work_experience,
  DROP COLUMN IF EXISTS other_activities,
  DROP COLUMN IF EXISTS awards,
  DROP COLUMN IF EXISTS additional_info,
  DROP COLUMN IF EXISTS reason_for_germany,
  DROP COLUMN IF EXISTS reasons_to_study_abroad,
  DROP COLUMN IF EXISTS promo_code;

COMMIT;
