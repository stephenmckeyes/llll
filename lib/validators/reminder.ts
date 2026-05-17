// ---------------------------------------------------------------------------
// Reminder validator — one entry of the activities.reminders jsonb array.
//
// Semantics: "remind me `amount` `unit`s before the scheduled occurrence."
// Notification *delivery* (cron, email, push) is handled separately; this
// schema just guards the shape so we never persist garbage.
// ---------------------------------------------------------------------------

import { z } from "zod";

export const reminderUnitSchema = z.enum([
  "minutes",
  "hours",
  "days",
  "weeks",
]);

export const reminderSchema = z.object({
  amount: z.number().int().min(1).max(999),
  unit: reminderUnitSchema,
});

export const remindersSchema = z.array(reminderSchema).max(10);

export type Reminder = z.infer<typeof reminderSchema>;
export type ReminderUnit = z.infer<typeof reminderUnitSchema>;
