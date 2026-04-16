# WorkPane v1.0.0 Early Access

WorkPane is an Electron desktop app for managing prompts, workspace documents, terminal sessions, code and markdown editing, and related workspace workflows in one place.

## Early Access

This is the `v1.0.0` Early Access release. Core workflows are available, but release hardening is still in progress and behavior may continue to change as post-`v1.0.0` work lands.

## Data Flow and Consent

LLM-backed features are opt-in.

When consent is enabled and a provider is available, WorkPane can send relevant terminal output and related workspace context to the enabled provider for API-backed `L2` classification.

When consent is disabled, or when no provider is available, WorkPane does not perform API-backed `L2` classification. The supervision flow still starts at `L1`, and the fallback cause surface remains `no-API` when consent/provider availability is absent.

Classification results are constrained to the release contract categories:

- `approval`
- `input-needed`
- `error`

This README is a release disclosure surface for `v1.0.0`, not a privacy policy or terms document. Formal legal documents remain out of scope for this release.
