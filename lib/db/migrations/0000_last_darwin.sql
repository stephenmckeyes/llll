CREATE TYPE "public"."instance_status" AS ENUM('pending', 'completed', 'skipped', 'shifted', 'missed');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('private', 'friends', 'clan', 'public');--> statement-breakpoint
CREATE TABLE "completion_instances" (
	"completion_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "completion_tasks" (
	"completion_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"skill_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effort_rating" smallint,
	"note" text,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"recurrence" jsonb NOT NULL,
	"default_skill_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"default_metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recurring_activity_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recurring_activity_id" uuid NOT NULL,
	"scheduled_for" date NOT NULL,
	"status" "instance_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"due_date" date,
	"earliest_date" date,
	"priority" smallint DEFAULT 2 NOT NULL,
	"default_skill_tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"abandoned_reason" text,
	"visibility" "visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "completion_instances" ADD CONSTRAINT "completion_instances_completion_id_completions_id_fk" FOREIGN KEY ("completion_id") REFERENCES "public"."completions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_instances" ADD CONSTRAINT "completion_instances_instance_id_recurring_activity_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."recurring_activity_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_tasks" ADD CONSTRAINT "completion_tasks_completion_id_completions_id_fk" FOREIGN KEY ("completion_id") REFERENCES "public"."completions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completion_tasks" ADD CONSTRAINT "completion_tasks_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_activities" ADD CONSTRAINT "recurring_activities_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_activity_instances" ADD CONSTRAINT "recurring_activity_instances_recurring_activity_id_recurring_activities_id_fk" FOREIGN KEY ("recurring_activity_id") REFERENCES "public"."recurring_activities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "completion_instances_pk" ON "completion_instances" USING btree ("completion_id","instance_id");--> statement-breakpoint
CREATE INDEX "completion_instances_instance_idx" ON "completion_instances" USING btree ("instance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "completion_tasks_pk" ON "completion_tasks" USING btree ("completion_id","task_id");--> statement-breakpoint
CREATE INDEX "completion_tasks_task_idx" ON "completion_tasks" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "completions_user_occurred_idx" ON "completions" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "recurring_activities_user_idx" ON "recurring_activities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rai_activity_date_idx" ON "recurring_activity_instances" USING btree ("recurring_activity_id","scheduled_for");--> statement-breakpoint
CREATE INDEX "rai_status_idx" ON "recurring_activity_instances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tasks_user_idx" ON "tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_status_idx" ON "tasks" USING btree ("status");