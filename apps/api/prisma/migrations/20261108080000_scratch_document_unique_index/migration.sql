-- Postgres treats NULLs as distinct in a UNIQUE constraint, so the
-- @@unique([interviewId, questionId]) on CodeDocument does not prevent two
-- scratch documents (questionId IS NULL) for the same interview.
-- This partial index closes that gap.
CREATE UNIQUE INDEX IF NOT EXISTS "CodeDocument_interviewId_scratch_key"
  ON "CodeDocument" ("interviewId")
  WHERE "questionId" IS NULL;
