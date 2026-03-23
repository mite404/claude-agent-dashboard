CREATE TABLE `logs` (
	`id` text PRIMARY KEY NOT NULL,
	`taskId` text NOT NULL,
	`timestamp` text,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text,
	FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `schema_version` (
	`version` integer PRIMARY KEY NOT NULL,
	`appliedAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schema_version_appliedAt_unique` ON `schema_version` (`appliedAt`);--> statement-breakpoint
CREATE TABLE `session_events` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionId` text NOT NULL,
	`type` text NOT NULL,
	`summary` text,
	`timestamp` text,
	`agentId` text,
	`agentType` text,
	`model` text,
	`metadata` text,
	FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_events_agentId_unique` ON `session_events` (`agentId`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_events_agentType_unique` ON `session_events` (`agentType`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`parentSessionId` text,
	`model` text,
	`agentType` text,
	`status` text NOT NULL,
	`createdAt` text,
	`stoppedAt` text,
	FOREIGN KEY (`parentSessionId`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`taskId` text NOT NULL,
	`dependsOnId` text NOT NULL,
	PRIMARY KEY(`taskId`, `dependsOnId`),
	FOREIGN KEY (`taskId`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dependsOnId`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionId` text NOT NULL,
	`parentId` text,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'unassigned' NOT NULL,
	`kind` text DEFAULT 'work',
	`priority` text DEFAULT 'normal',
	`createdBy` text,
	`claimedBy` text,
	`progressPercentage` integer DEFAULT 0,
	`createdAt` text,
	`startedAt` text,
	`claimedAt` text,
	`completedAt` text,
	FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parentId`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
