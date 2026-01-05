import { vi } from 'vitest';

export const mockSecrets = {
  accessSecretVersion: vi.fn().mockResolvedValue([
    {
      payload: {
        data: Buffer.from('fake-secret'),
      },
    },
  ]),
};

export function resetSecretsMocks() {
  mockSecrets.accessSecretVersion.mockReset().mockResolvedValue([
    {
      payload: {
        data: Buffer.from('fake-secret'),
      },
    },
  ]);
}

// Helper to mock specific secrets
export function mockSecret(secretName: string, value: string) {
  mockSecrets.accessSecretVersion.mockImplementation(async (request: { name: string }) => {
    if (request.name.includes(secretName)) {
      return [{ payload: { data: Buffer.from(value) } }];
    }
    return [{ payload: { data: Buffer.from('fake-secret') } }];
  });
}
