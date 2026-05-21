// ---------------------------------------------------------------------------
// instance-resolved-event — a tiny window-event bus that lets the
// "Unlabeled (N)" chip drop instantly when the user marks a past-due
// instance complete or missed, without waiting for the server to
// revalidate the page.
//
// Flow:
//   1. User clicks Complete / Missed on a past-due instance.
//   2. The component calling the action also calls
//      `dispatchInstanceResolved({ wasUnlabeled: true })`.
//   3. The IncompleteButton subscribes to the event and decrements
//      its local count on each `wasUnlabeled: true` hit.
//   4. When the next server-revalidated `info` prop arrives, the chip
//      resyncs to the authoritative count (so over- or under-counting
//      from out-of-order events gets corrected).
//
// We use a plain CustomEvent because:
//   - It works across any client component without a context provider.
//   - SSR-safe (window check before dispatch / subscribe).
//   - Fires only when an action that COULD drop the unlabeled count
//     happens — no over-firing.
// ---------------------------------------------------------------------------

export const INSTANCE_RESOLVED_EVENT = "mission-instance-resolved";

export type InstanceResolvedDetail = {
  /** True when the instance was past-due-pending ("unlabeled") at the
   *  time of resolution. Drives the Unlabeled chip's optimistic
   *  decrement; false-valued events are still dispatched for future
   *  optimistic-UI consumers but currently ignored. */
  wasUnlabeled: boolean;
};

export function dispatchInstanceResolved(detail: InstanceResolvedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<InstanceResolvedDetail>(INSTANCE_RESOLVED_EVENT, {
      detail,
    })
  );
}

export function subscribeInstanceResolved(
  handler: (detail: InstanceResolvedDetail) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const wrapped = (e: Event) => {
    const ce = e as CustomEvent<InstanceResolvedDetail>;
    handler(ce.detail);
  };
  window.addEventListener(INSTANCE_RESOLVED_EVENT, wrapped);
  return () => window.removeEventListener(INSTANCE_RESOLVED_EVENT, wrapped);
}
