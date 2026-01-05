import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Google OAuth client
vi.mock('../../../../src/oauth/index.js', () => ({
  getGoogleOAuthClient: vi.fn().mockResolvedValue({
    setCredentials: vi.fn(),
  }),
}));

// Mock googleapis
const mockFilesList = vi.fn();
const mockFilesGet = vi.fn();
const mockFilesCreate = vi.fn();
const mockFilesUpdate = vi.fn();
const mockFilesExport = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn(() => ({
      files: {
        list: mockFilesList,
        get: mockFilesGet,
        create: mockFilesCreate,
        update: mockFilesUpdate,
        export: mockFilesExport,
      },
    })),
  },
}));

import { driveTools } from '../../../../src/mcp/tools/drive.js';

describe('mcp/tools/drive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const findTool = (name: string) => driveTools.find((t) => t.name === name)!;

  describe('list_drive_files', () => {
    const tool = findTool('list_drive_files');

    it('has correct tool definition', () => {
      expect(tool.name).toBe('list_drive_files');
      expect(tool.description).toContain('List files');
      expect(tool.inputSchema).toBeDefined();
    });

    it('returns files in correct format', async () => {
      mockFilesList.mockResolvedValue({
        data: {
          files: [
            {
              id: 'file1',
              name: 'test.txt',
              mimeType: 'text/plain',
              modifiedTime: '2025-01-01T00:00:00Z',
              size: '1024',
              webViewLink: 'https://drive.google.com/file1',
            },
          ],
        },
      });

      const result = await tool.handler({}, 'test-refresh-token');

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Found 1 files');
      expect(result.isError).toBeUndefined();
    });

    it('clamps pageSize to max 100', async () => {
      mockFilesList.mockResolvedValue({ data: { files: [] } });

      await tool.handler({ pageSize: 150 }, 'test-refresh-token');

      expect(mockFilesList).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 100 })
      );
    });

    it('treats pageSize 0 as default (20) due to falsy check', async () => {
      mockFilesList.mockResolvedValue({ data: { files: [] } });

      await tool.handler({ pageSize: 0 }, 'test-refresh-token');

      // 0 || 20 = 20, so pageSize 0 is treated as "not provided"
      expect(mockFilesList).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 20 })
      );
    });

    it('clamps negative pageSize to 1', async () => {
      mockFilesList.mockResolvedValue({ data: { files: [] } });

      await tool.handler({ pageSize: -5 }, 'test-refresh-token');

      expect(mockFilesList).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 1 })
      );
    });
  });

  describe('get_file_info', () => {
    const tool = findTool('get_file_info');

    it('returns error when fileId is missing', async () => {
      const result = await tool.handler({}, 'test-refresh-token');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Error: fileId is required');
    });

    it('returns file info in correct format', async () => {
      mockFilesGet.mockResolvedValue({
        data: {
          id: 'file1',
          name: 'test.txt',
          mimeType: 'text/plain',
        },
      });

      const result = await tool.handler({ fileId: 'file1' }, 'test-refresh-token');

      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('file1');
      expect(result.isError).toBeUndefined();
    });
  });

  describe('search_drive', () => {
    const tool = findTool('search_drive');

    it('returns error when query is missing', async () => {
      const result = await tool.handler({}, 'test-refresh-token');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Error: query is required');
    });

    it('escapes single quotes in query', async () => {
      mockFilesList.mockResolvedValue({ data: { files: [] } });

      await tool.handler({ query: "test's query" }, 'test-refresh-token');

      expect(mockFilesList).toHaveBeenCalledWith(
        expect.objectContaining({
          q: expect.stringContaining("\\'"),
        })
      );
    });

    it('returns search results in correct format', async () => {
      mockFilesList.mockResolvedValue({
        data: {
          files: [{ id: 'file1', name: 'match.txt' }],
        },
      });

      const result = await tool.handler({ query: 'test' }, 'test-refresh-token');

      expect(result.content[0].text).toContain('Search results for "test"');
      expect(result.isError).toBeUndefined();
    });
  });

  describe('create_folder', () => {
    const tool = findTool('create_folder');

    it('returns error when name is missing', async () => {
      const result = await tool.handler({}, 'test-refresh-token');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Error: name is required');
    });

    it('creates folder with correct mime type', async () => {
      mockFilesCreate.mockResolvedValue({
        data: { id: 'folder1', name: 'New Folder', webViewLink: 'https://...' },
      });

      const result = await tool.handler({ name: 'New Folder' }, 'test-refresh-token');

      expect(mockFilesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            mimeType: 'application/vnd.google-apps.folder',
          }),
        })
      );
      expect(result.content[0].text).toContain('Folder created successfully');
    });

    it('sets parent folder when provided', async () => {
      mockFilesCreate.mockResolvedValue({
        data: { id: 'folder1', name: 'Subfolder', webViewLink: 'https://...' },
      });

      await tool.handler(
        { name: 'Subfolder', parentFolderId: 'parent123' },
        'test-refresh-token'
      );

      expect(mockFilesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            parents: ['parent123'],
          }),
        })
      );
    });
  });

  describe('create_file', () => {
    const tool = findTool('create_file');

    it('returns error when name is missing', async () => {
      const result = await tool.handler({ content: 'test' }, 'test-refresh-token');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Error: name is required');
    });

    it('returns error when content is missing', async () => {
      const result = await tool.handler({ name: 'test.txt' }, 'test-refresh-token');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Error: content is required');
    });

    it('creates file with correct content', async () => {
      mockFilesCreate.mockResolvedValue({
        data: { id: 'file1', name: 'test.txt', mimeType: 'text/plain' },
      });

      const result = await tool.handler(
        { name: 'test.txt', content: 'Hello World' },
        'test-refresh-token'
      );

      expect(result.content[0].text).toContain('File created successfully');
    });
  });

  describe('read_file', () => {
    const tool = findTool('read_file');

    it('returns error when fileId is missing', async () => {
      const result = await tool.handler({}, 'test-refresh-token');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Error: fileId is required');
    });

    it('exports Google Docs as plain text', async () => {
      mockFilesGet.mockResolvedValue({
        data: {
          id: 'doc1',
          name: 'My Doc',
          mimeType: 'application/vnd.google-apps.document',
        },
      });
      mockFilesExport.mockResolvedValue({ data: 'Document content' });

      const result = await tool.handler({ fileId: 'doc1' }, 'test-refresh-token');

      expect(mockFilesExport).toHaveBeenCalledWith(
        { fileId: 'doc1', mimeType: 'text/plain' },
        { responseType: 'text' }
      );
      expect(result.content[0].text).toContain('My Doc');
      expect(result.content[0].text).toContain('Google Doc');
    });

    it('exports Google Sheets as CSV', async () => {
      mockFilesGet.mockResolvedValue({
        data: {
          id: 'sheet1',
          name: 'My Sheet',
          mimeType: 'application/vnd.google-apps.spreadsheet',
        },
      });
      mockFilesExport.mockResolvedValue({ data: 'col1,col2\n1,2' });

      const result = await tool.handler({ fileId: 'sheet1' }, 'test-refresh-token');

      expect(mockFilesExport).toHaveBeenCalledWith(
        { fileId: 'sheet1', mimeType: 'text/csv' },
        { responseType: 'text' }
      );
      expect(result.content[0].text).toContain('Google Sheet');
    });
  });

  describe('move_file', () => {
    const tool = findTool('move_file');

    it('returns error when fileId is missing', async () => {
      const result = await tool.handler(
        { destinationFolderId: 'dest1' },
        'test-refresh-token'
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Error: fileId is required');
    });

    it('returns error when destinationFolderId is missing', async () => {
      const result = await tool.handler({ fileId: 'file1' }, 'test-refresh-token');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Error: destinationFolderId is required');
    });

    it('moves file to new parent', async () => {
      mockFilesGet.mockResolvedValue({
        data: { id: 'file1', name: 'test.txt', parents: ['oldParent'] },
      });
      mockFilesUpdate.mockResolvedValue({
        data: { id: 'file1', name: 'test.txt', parents: ['newParent'] },
      });

      const result = await tool.handler(
        { fileId: 'file1', destinationFolderId: 'newParent' },
        'test-refresh-token'
      );

      expect(mockFilesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          addParents: 'newParent',
          removeParents: 'oldParent',
        })
      );
      expect(result.content[0].text).toContain('File moved successfully');
    });
  });

  describe('rename_file', () => {
    const tool = findTool('rename_file');

    it('returns error when fileId is missing', async () => {
      const result = await tool.handler({ newName: 'new.txt' }, 'test-refresh-token');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Error: fileId is required');
    });

    it('returns error when newName is missing', async () => {
      const result = await tool.handler({ fileId: 'file1' }, 'test-refresh-token');

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('Error: newName is required');
    });

    it('renames file successfully', async () => {
      mockFilesGet.mockResolvedValue({
        data: { id: 'file1', name: 'old.txt' },
      });
      mockFilesUpdate.mockResolvedValue({
        data: { id: 'file1', name: 'new.txt', mimeType: 'text/plain' },
      });

      const result = await tool.handler(
        { fileId: 'file1', newName: 'new.txt' },
        'test-refresh-token'
      );

      expect(mockFilesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: { name: 'new.txt' },
        })
      );
      expect(result.content[0].text).toContain('File renamed successfully');
      expect(result.content[0].text).toContain('old.txt');
      expect(result.content[0].text).toContain('new.txt');
    });
  });
});
