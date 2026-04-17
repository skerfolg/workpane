# M7b.1 Lane-Native Surface Cleanup Status

Date: 2026-04-17
Scope: execution status after `M7b.1`

## Current state

- `M7b.1` is implemented and verified.
- The slice is complete as the post-`M7b` lane-native surface cleanup phase of `M7`.

## What completed

- Removed provider-centric public mutators for direct-HTTP enable/order control from the runtime/preload surface:
  - `setProviderEnabled`
  - `setSelectedProvider`
  - `setFallbackOrder`
- Added lane-native direct-HTTP controls:
  - `setLaneEnabled(laneId, enabled)`
  - `moveLane(laneId, delta)` with `delta: -1 | 1`
- Locked exact bounded errors for invalid lane control calls:
  - `ERR_UNKNOWN_LANE_ID: Unknown execution lane.`
  - `ERR_NON_DIRECT_HTTP_LANE: Lane control is supported only for direct_http lanes.`
- Migrated Settings to read and write direct-HTTP enable/order state from lanes instead of provider-first fields.
- Kept `selectedProvider` and `fallbackOrder` only as legacy normalization inputs plus derived outputs.
- Preserved provider-scoped `setSelectedModel(providerId, modelId)` for direct-HTTP model ownership.
- Hardened `refresh-state` / `validate` unauthenticated parity in the OpenAI official-client bridge.
- Added lifecycle cleanup for the bridge connect banner so stale “pending user action” text does not remain after refresh/disconnect.
- Rewrote verification coverage so the removed runtime surface is explicitly absent and lane-native controls are exercised directly.

## Verification

- `npm run build`
- `npm run test:unit`
- `npm run test:e2e:gate`
- `npx playwright test tests/e2e/llm-live-provider.spec.ts --project electron --workers=1 --timeout=120000`
- affected-file diagnostics: 0 errors
- architect verification: `APPROVE`
- changed-files-only deslop pass completed
- post-deslop regression: green

## Remaining risks

- No blocking risks remain in the implemented scope.
- Low residual risk:
  - exact bounded error behavior is covered most strongly at manager-unit level rather than a dedicated Electron IPC failure path
  - bridge lifecycle E2E validates user-visible behavior rather than terminal-manager internals

## Follow-up

- `M7b.1` closes the planned lane-native cleanup after `M7b`.
- `M7c` completed the second official-client bridge and closed the currently planned `M7` execution track.
