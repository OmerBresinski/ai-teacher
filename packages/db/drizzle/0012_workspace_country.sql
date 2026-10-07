-- Existing Workspaces keep England; new ones start unset (NULL reads as England) until the
-- sign-up country hint or the teacher's own choice sets it (TEACH-33 part b).
ALTER TABLE "workspaces" ADD COLUMN "country" text DEFAULT 'england';--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "country" DROP DEFAULT;