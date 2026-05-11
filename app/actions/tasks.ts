// ---------------------------------------------------------------------------
// Server actions for tasks.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { logCompletion } from "@/lib/domain/completions";
import { createClient } from "@/lib/supabase/server";

export type TaskFormState = { error: string } | null;

const taskInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required.").max(120),
    description: z.string().trim().max(500).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    earliestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    priority: z.number().int().min(1).max(3),
  })
  .refine(
    (d) => !(d.earliestDate && d.dueDate) || d.earliestDate <= d.dueDate,
    { error: "Earliest date must be on or before the due date." }
  );

// ---------------------------------------------------------------------------
// createTask — insert a new task with status='pending'.
// ---------------------------------------------------------------------------

export async function createTask(
  _prev: TaskFormState,
  formData: FormData
): Promise<TaskFormState> {
  const parsed = taskInputSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    dueDate: formData.get("dueDate") || undefined,
    earliestDate: formData.get("earliestDate") || undefined,
    priority: Number(formData.get("priority") ?? 2),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("tasks").insert({
    user_id: user.id,
    name: parsed.data.name,
    description: parsed.data.description ?? null,
    due_date: parsed.data.dueDate ?? null,
    earliest_date: parsed.data.earliestDate ?? null,
    priority: parsed.data.priority,
  });

  if (error) return { error: error.message };

  redirect("/today");
}

// ---------------------------------------------------------------------------
// completeTask — delegate to logCompletion; the single entry point.
// ---------------------------------------------------------------------------

export async function completeTask(taskId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await logCompletion(supabase, user.id, { taskIds: [taskId] });
  revalidatePath("/today");
}
