// Stand-in for src/lib/queries/trash.ts (which pulls in browser-only modules).
// reservations.ts imports softDeleteEntity from it; no fixture exercises it.
export async function softDeleteEntity() {
  throw new Error('softDeleteEntity is not available in the Node fixtures');
}
