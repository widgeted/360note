# ADR-007: No CRDT or real-time co-editing in v0.1

- Status: accepted
- Date: 2026-11-07

## Context

Real-time collaboration requires CRDT/OT, persistent op logs, presence, permissions and mobile sync. Reference projects show high complexity and edge cases (SilverBullet removed CRDT; Livebook uses OT only within sessions). 360note's core users need reliable capture and sharing more than simultaneous character-level editing.

## Decision

Use save-based sharing (view/comment/edit links), comments, versions and conflict copies. Do not add CRDT/OT/realtime cursors in v0.1. If added later, prefer Yjs/Automerge with a persisted op log; do not build OT from scratch.

## Consequences

- Two people editing the same note can create a conflict copy; this is visible and safe.
- Lower engineering risk, stronger data integrity.
- Real-time collaboration remains a P2 roadmap item.
