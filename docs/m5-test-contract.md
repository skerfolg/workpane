# M5 Test Contract

`M5` keeps the automated release gate deterministic and Windows/Electron-first.

## Required local checks

```bash
npm run build
npm run test:unit
npm run test:e2e:gate
```

The canonical deterministic Electron gate pack is defined in [tests/e2e/helpers/gate-pack.ts](../tests/e2e/helpers/gate-pack.ts).
When the gate pack changes, keep `package.json` and workflow usage aligned with that file.

Full local e2e run:

```bash
npm run test:e2e:full
```

## Non-gating smoke

`tests/e2e/llm-live-provider.spec.ts` stays in the repo, but it is credentialed smoke and must not block CI or release publish.

Local-only command:

```bash
npm run test:e2e:live-provider
```

## M5 unit seam boundary

Unit seam expansion for `M5` is intentionally narrow:

- `src/main/llm/manager.ts`
- existing pure LLM fallback/no-api/provider-adapter contract tests
- existing monitoring-state reducer/selector tests

Do not widen `M5` into broad renderer component coverage or snapshot churn.
