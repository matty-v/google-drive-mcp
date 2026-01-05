import { vi } from 'vitest';

export const mockDriveFiles = {
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  copy: vi.fn(),
  export: vi.fn(),
};

export const mockDrive = {
  files: mockDriveFiles,
};

export const mockDocsDocuments = {
  get: vi.fn(),
  batchUpdate: vi.fn(),
};

export const mockDocs = {
  documents: mockDocsDocuments,
};

export const mockSheetsSpreadsheets = {
  values: {
    update: vi.fn(),
  },
  create: vi.fn(),
  get: vi.fn(),
};

export const mockSheets = {
  spreadsheets: mockSheetsSpreadsheets,
};

export const mockOAuth2Client = {
  setCredentials: vi.fn(),
  getAccessToken: vi.fn(),
  generateAuthUrl: vi.fn(),
  getToken: vi.fn(),
};

export function resetGoogleApiMocks() {
  mockDriveFiles.list.mockReset();
  mockDriveFiles.get.mockReset();
  mockDriveFiles.create.mockReset();
  mockDriveFiles.update.mockReset();
  mockDriveFiles.copy.mockReset();
  mockDriveFiles.export.mockReset();
  mockDocsDocuments.get.mockReset();
  mockDocsDocuments.batchUpdate.mockReset();
  mockSheetsSpreadsheets.values.update.mockReset();
  mockSheetsSpreadsheets.create.mockReset();
  mockSheetsSpreadsheets.get.mockReset();
  mockOAuth2Client.setCredentials.mockReset();
  mockOAuth2Client.getAccessToken.mockReset();
  mockOAuth2Client.generateAuthUrl.mockReset();
  mockOAuth2Client.getToken.mockReset();
}
