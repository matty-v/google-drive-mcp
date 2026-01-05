# Testing Design

## Goal

Add unit and integration tests to catch regressions and verify critical paths before deploy.

## Framework

**Vitest** - Fast, native ESM support, Jest-compatible API.

## Test Structure

```
tests/
  unit/
    oauth/
      helpers.test.ts      # generateSecureToken, hashCodeVerifier
    mcp/
      handler.test.ts      # validateAccessToken, handleMcpMethod
      tools/
        drive.test.ts      # Tool handler logic
        docs.test.ts
        sheets.test.ts
  integration/
    oauth.test.ts          # Full OAuth flow endpoints
    mcp.test.ts            # MCP JSON-RPC endpoints
  mocks/
    firestore.ts           # Mock Firestore client
    google-apis.ts         # Mock Google Drive/Docs/Sheets APIs
    secrets.ts             # Mock Secret Manager
  setup.ts                 # Global test setup
```

## Mocking Strategy

### Firestore
```typescript
export const mockFirestore = {
  doc: vi.fn().mockReturnValue({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  }),
};
```

### Google APIs
```typescript
export const mockDrive = {
  files: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
};
export const mockDocs = {
  documents: { get: vi.fn(), batchUpdate: vi.fn() },
};
export const mockSheets = {
  spreadsheets: { values: { update: vi.fn() } },
};
```

### Secret Manager
```typescript
export const mockSecrets = {
  accessSecretVersion: vi.fn().mockResolvedValue([{
    payload: { data: Buffer.from('fake-secret') }
  }]),
};
```

## Critical Path Tests

### Unit Tests

| File | Tests |
|------|-------|
| `oauth/helpers` | `generateSecureToken` returns hex of correct length, `hashCodeVerifier` produces valid base64url |
| `mcp/handler` | `validateAccessToken` returns valid/invalid/expired correctly |
| `mcp/tools/*` | Each tool validates required args, returns proper ToolResult format |

### Integration Tests

| Endpoint | Tests |
|----------|-------|
| `GET /.well-known/oauth-authorization-server` | Returns correct OAuth metadata |
| `POST /register` | Creates client, returns credentials |
| `GET /authorize` | Validates params, redirects to Google |
| `POST /token` | Exchanges code for tokens, validates PKCE |
| `POST /` (MCP) | `initialize` returns capabilities, `tools/list` returns all 16 tools, `tools/call` executes tool |

## Configuration

### Dependencies
```json
{
  "devDependencies": {
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0"
  }
}
```

### vitest.config.ts
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
```

### package.json scripts
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

## Priority Order

1. MCP endpoint tests (core functionality)
2. Token endpoint (security-critical)
3. OAuth helpers (foundational)
4. Tool handlers (high value, many edge cases)
