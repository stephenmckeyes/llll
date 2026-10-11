// ---------------------------------------------------------------------------
// parseActivityTemplateForm — parse the shared ActivityFormFields FormData down
// to the fields a coach activity template needs (name, notes, rhythm, times,
// tags). Dates/completion/reminders/pinned/rollover don't apply to a template
// (the client picks a start date when accepting an offer), so they're ignored.
//
// Lives in a plain module (not a "use server" file) so both the coaches server
// actions and any client code can import it.
// ---------------------------------------------------------------------------

import { rhythmSchema, type Rhythm } from "@/lib/validators/rhythm";

export type ParsedActivityTemplate = {
  name: string;
  notes: string | null;
  rhythm: Rhythm;
  scheduledTimes: string[];
  scheduledEndTimes: string[];
  tags: string[];
};

export function parseActivityTemplateForm(
  formData: FormData
): ParsedActivityTemplate | { error: string } {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Activity name is required." };
  if (name.length > 120) return { error: "Name is too long (max 120)." };

  const notesRaw = String(formData.get("notes") ?? "").trim();
  const tags = Array.from(
    new Set(
      formData
        .getAll("tag")
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );

  // Times of day: zip parallel scheduledTime / scheduledEndTime arrays,
  // dropping blank starts and keeping ends aligned by index.
  const rawStarts = formData.getAll("scheduledTime").map(String);
  const rawEnds = formData.getAll("scheduledEndTime").map(String);
  const scheduledTimes: string[] = [];
  const scheduledEndTimes: string[] = [];
  for (let i = 0; i < rawStarts.length; i++) {
    const t = rawStarts[i].trim();
    if (!/^\d{2}:\d{2}$/.test(t)) continue;
    scheduledTimes.push(t);
    const e = (rawEnds[i] ?? "").trim();
    scheduledEndTimes.push(/^\d{2}:\d{2}$/.test(e) ? e : "");
  }

  const rhythmType = String(formData.get("rhythmType") ?? "single");
  let candidate: unknown;
  switch (rhythmType) {
    case "single":
    case "selection":
      candidate = { type: "single" };
      break;
    case "daily":
      candidate =
        scheduledTimes.length > 1
          ? {
              type: "frequency",
              count: scheduledTimes.length,
              perCount: 1,
              perUnit: "days",
            }
          : { type: "daily" };
      break;
    case "weekdays":
      candidate = {
        type: "weekdays",
        days: formData.getAll("weekday").map(String),
      };
      break;
    case "interval": {
      const n = parseInt(String(formData.get("intervalDays") ?? "2"), 10);
      candidate = {
        type: "interval",
        days: Number.isFinite(n) ? Math.min(Math.max(n, 1), 365) : 2,
      };
      break;
    }
    case "frequency": {
      const count = parseInt(String(formData.get("frequencyCount") ?? "3"), 10);
      const perCount = parseInt(
        String(formData.get("frequencyPerCount") ?? "1"),
        10
      );
      candidate = {
        type: "frequency",
        count: Number.isFinite(count) ? Math.min(Math.max(count, 1), 99) : 3,
        perCount: Number.isFinite(perCount) ? Math.min(Math.max(perCount, 1), 99) : 1,
        perUnit: String(formData.get("frequencyPerUnit") ?? "weeks"),
      };
      break;
    }
    default:
      return { error: `Unknown rhythm type: ${rhythmType}` };
  }

  const parsed = rhythmSchema.safeParse(candidate);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid rhythm." };
  }

  return {
    name,
    notes: notesRaw.length > 0 ? notesRaw : null,
    rhythm: parsed.data,
    scheduledTimes,
    scheduledEndTimes,
    tags,
  };
}
