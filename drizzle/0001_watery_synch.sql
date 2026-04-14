ALTER TABLE `schema_version` RENAME COLUMN "appliedAt" TO "applied_at";--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`timestamp` text,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_logs`("id", "task_id", "timestamp", "level", "message") SELECT "id", "task_id", "timestamp", "level", "message" FROM `logs`;--> statement-breakpoint
DROP TABLE `logs`;--> statement-breakpoint
ALTER TABLE `__new_logs` RENAME TO `logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
DROP INDEX `schema_version_appliedAt_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `schema_version_appliedAt_unique` ON `schema_version` (`applied_at`);--> statement-breakpoint
CREATE TABLE `__new_session_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`summary` text,
	`timestamp` text,
	`agent_id` text,
	`agent_type` text,
	`model` text,
	`metadata` text DEFAULT 'null',
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_session_events`("id", "session_id", "type", "summary", "timestamp", "agent_id", "agent_type", "model", "metadata") SELECT "id", "session_id", "type", "summary", "timestamp", "agent_id", "agent_type", "model", "metadata" FROM `session_events`;--> statement-breakpoint
DROP TABLE `session_events`;--> statement-breakpoint
ALTER TABLE `__new_session_events` RENAME TO `session_events`;--> statement-breakpoint
CREATE TABLE `__new_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`parent_session_id` text,
	`model` text,
	`agent_type` text,
	`status` text NOT NULL,
	`created_at` text,
	`stopped_at` text,
	FOREIGN KEY (`parent_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_sessions`("id", "type", "parent_session_id", "model", "agent_type", "status", "created_at", "stopped_at") SELECT "id", "type", "parent_session_id", "model", "agent_type", "status", "created_at", "stopped_at" FROM `sessions`;--> statement-breakpoint
DROP TABLE `sessions`;--> statement-breakpoint
ALTER TABLE `__new_sessions` RENAME TO `sessions`;--> statement-breakpoint
CREATE TABLE `__new_task_dependencies` (
	`task_id` text NOT NULL,
	`depends_on_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `depends_on_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`depends_on_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_task_dependencies`("task_id", "depends_on_id") SELECT "task_id", "depends_on_id" FROM `task_dependencies`;--> statement-breakpoint
DROP TABLE `task_dependencies`;--> statement-breakpoint
ALTER TABLE `__new_task_dependencies` RENAME TO `task_dependencies`;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'unassigned' NOT NULL,
	`kind` text DEFAULT 'work',
	`priority` text DEFAULT 'normal',
	`created_by` text,
	`claimed_by` text,
	`progress_percentage` integer DEFAULT 0,
	`created_at` text,
	`started_at` text,
	`claimed_at` text,
	`worktree_path` text,
	`completed_at` text,
	`agent_id` text,
	`agent_type` text,
	`originating_skill` text,
	`task_kind` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "session_id", "parent_id", "name", "description", "status", "kind", "priority", "created_by", "claimed_by", "progress_percentage", "created_at", "started_at", "claimed_at", "worktree_path", "completed_at", "agent_id", "agent_type", "originating_skill", "task_kind") SELECT "id", "session_id", "parent_id", "name", "description", "status", "kind", "priority", "created_by", "claimed_by", "progress_percentage", "created_at", "started_at", "claimed_at", "worktree_path", "completed_at", "agent_id", "agent_type", "originating_skill", "task_kind" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;