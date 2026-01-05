import { vi } from 'vitest';

export const mockDocRef = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

export const mockCollection = {
  doc: vi.fn().mockReturnValue(mockDocRef),
  add: vi.fn(),
  get: vi.fn(),
};

export const mockFirestore = {
  collection: vi.fn().mockReturnValue(mockCollection),
  doc: vi.fn().mockReturnValue(mockDocRef),
};

export function resetFirestoreMocks() {
  mockDocRef.get.mockReset();
  mockDocRef.set.mockReset();
  mockDocRef.delete.mockReset();
  mockCollection.doc.mockReset().mockReturnValue(mockDocRef);
  mockCollection.add.mockReset();
  mockCollection.get.mockReset();
  mockFirestore.collection.mockReset().mockReturnValue(mockCollection);
  mockFirestore.doc.mockReset().mockReturnValue(mockDocRef);
}

// Helper to create a mock document snapshot
export function createMockSnapshot(exists: boolean, data?: Record<string, unknown>) {
  return {
    exists,
    data: () => data,
    id: 'mock-doc-id',
  };
}
