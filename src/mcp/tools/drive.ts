import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { Tool, ToolResult } from "../types.js";
import { config } from "../../config.js";

async function getDriveClient(googleRefreshToken: string) {
  const oauth2Client = new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret
  );
  oauth2Client.setCredentials({ refresh_token: googleRefreshToken });
  return google.drive({ version: "v3", auth: oauth2Client });
}

export const driveTools: Tool[] = [
  {
    name: 'list_drive_files',
    description: 'List files in your Google Drive. Returns file names, types, and modification dates.',
    inputSchema: {
      type: 'object',
      properties: {
        folderId: {
          type: 'string',
          description: 'Folder ID to list contents of. Omit to list recent files.',
        },
        query: {
          type: 'string',
          description: 'Search query to filter files (e.g., "name contains \'report\'")',
        },
        pageSize: {
          type: 'number',
          description: 'Number of files to return (1-100, default 20)',
          default: 20,
        },
        mimeType: {
          type: 'string',
          description: 'Filter by MIME type (e.g., "application/pdf", "application/vnd.google-apps.spreadsheet")',
        },
      },
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      const drive = await getDriveClient(googleRefreshToken);
      const pageSize = Math.min(Math.max(args?.pageSize || 20, 1), 100);
      let query = 'trashed = false';

      if (args?.folderId) {
        query += ` and '${args.folderId}' in parents`;
      }
      if (args?.query) {
        query += ` and ${args.query}`;
      }
      if (args?.mimeType) {
        query += ` and mimeType = '${args.mimeType}'`;
      }

      const response = await drive.files.list({
        pageSize,
        q: query,
        fields: 'files(id, name, mimeType, modifiedTime, size, webViewLink, parents)',
        orderBy: 'modifiedTime desc',
      });

      const files = response.data.files || [];
      const formattedFiles = files.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.mimeType,
        modified: f.modifiedTime,
        size: f.size ? `${Math.round(parseInt(f.size) / 1024)} KB` : 'N/A',
        link: f.webViewLink,
      }));

      return {
        content: [
          {
            type: 'text',
            text: `Found ${files.length} files:\n\n${JSON.stringify(formattedFiles, null, 2)}`,
          },
        ],
      };
    },
  },

  {
    name: 'get_file_info',
    description: 'Get detailed information about a specific file in Google Drive.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The ID of the file to get information about',
        },
      },
      required: ['fileId'],
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      if (!args?.fileId) {
        return {
          content: [{ type: 'text', text: 'Error: fileId is required' }],
          isError: true,
        };
      }

      const drive = await getDriveClient(googleRefreshToken);
      const response = await drive.files.get({
        fileId: args.fileId,
        fields: 'id, name, mimeType, modifiedTime, createdTime, size, webViewLink, owners, shared, permissions',
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    },
  },

  {
    name: 'search_drive',
    description: 'Search for files in Google Drive by name or content.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term to find in file names or content',
        },
        pageSize: {
          type: 'number',
          description: 'Number of results to return (1-100, default 20)',
          default: 20,
        },
      },
      required: ['query'],
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      if (!args?.query) {
        return {
          content: [{ type: 'text', text: 'Error: query is required' }],
          isError: true,
        };
      }

      const drive = await getDriveClient(googleRefreshToken);
      const pageSize = Math.min(Math.max(args?.pageSize || 20, 1), 100);
      const searchQuery = `fullText contains '${args.query.replace(/'/g, "\\'")}' and trashed = false`;

      const response = await drive.files.list({
        pageSize,
        q: searchQuery,
        fields: 'files(id, name, mimeType, modifiedTime, webViewLink)',
        orderBy: 'modifiedTime desc',
      });

      const files = response.data.files || [];

      return {
        content: [
          {
            type: 'text',
            text: `Search results for "${args.query}":\n\n${JSON.stringify(files, null, 2)}`,
          },
        ],
      };
    },
  },

  {
    name: 'create_folder',
    description: 'Create a new folder in Google Drive.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the folder to create',
        },
        parentFolderId: {
          type: 'string',
          description: 'ID of the parent folder. Omit to create in root.',
        },
      },
      required: ['name'],
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      if (!args?.name) {
        return {
          content: [{ type: 'text', text: 'Error: name is required' }],
          isError: true,
        };
      }

      const drive = await getDriveClient(googleRefreshToken);
      const folderMetadata: any = {
        name: args.name,
        mimeType: 'application/vnd.google-apps.folder',
      };

      if (args.parentFolderId) {
        folderMetadata.parents = [args.parentFolderId];
      }

      const response = await drive.files.create({
        requestBody: folderMetadata,
        fields: 'id, name, webViewLink',
      });

      return {
        content: [
          {
            type: 'text',
            text: `Folder created successfully!\n\n${JSON.stringify({
              id: response.data.id,
              name: response.data.name,
              link: response.data.webViewLink,
            }, null, 2)}`,
          },
        ],
      };
    },
  },

  {
    name: 'create_file',
    description: 'Create a new file in Google Drive with text content.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the file to create (include extension, e.g., "notes.txt", "data.json")',
        },
        content: {
          type: 'string',
          description: 'Text content of the file',
        },
        parentFolderId: {
          type: 'string',
          description: 'ID of the parent folder. Omit to create in root.',
        },
        mimeType: {
          type: 'string',
          description: 'MIME type of the file (default: text/plain). Use "application/vnd.google-apps.document" for Google Docs.',
        },
      },
      required: ['name', 'content'],
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      if (!args?.name) {
        return {
          content: [{ type: 'text', text: 'Error: name is required' }],
          isError: true,
        };
      }
      if (args?.content === undefined) {
        return {
          content: [{ type: 'text', text: 'Error: content is required' }],
          isError: true,
        };
      }

      const drive = await getDriveClient(googleRefreshToken);
      const mimeType = args.mimeType || 'text/plain';

      const fileMetadata: any = {
        name: args.name,
      };

      if (args.parentFolderId) {
        fileMetadata.parents = [args.parentFolderId];
      }

      // For Google Docs, we need to convert from text
      if (mimeType === 'application/vnd.google-apps.document') {
        fileMetadata.mimeType = mimeType;
        const response = await drive.files.create({
          requestBody: fileMetadata,
          media: {
            mimeType: 'text/plain',
            body: args.content,
          },
          fields: 'id, name, webViewLink, mimeType',
        });

        return {
          content: [
            {
              type: 'text',
              text: `Google Doc created successfully!\n\n${JSON.stringify({
                id: response.data.id,
                name: response.data.name,
                type: response.data.mimeType,
                link: response.data.webViewLink,
              }, null, 2)}`,
            },
          ],
        };
      }

      // For regular files, create with the specified content
      const { Readable } = await import('stream');
      const contentStream = Readable.from([args.content]);

      const response = await drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType: mimeType,
          body: contentStream,
        },
        fields: 'id, name, webViewLink, mimeType, size',
      });

      return {
        content: [
          {
            type: 'text',
            text: `File created successfully!\n\n${JSON.stringify({
              id: response.data.id,
              name: response.data.name,
              type: response.data.mimeType,
              size: response.data.size,
              link: response.data.webViewLink,
            }, null, 2)}`,
          },
        ],
      };
    },
  },

  {
    name: 'read_file',
    description: 'Read the content of a file from Google Drive. Works with text files, Google Docs, Sheets (as CSV), and other exportable formats.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The ID of the file to read',
        },
      },
      required: ['fileId'],
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      if (!args?.fileId) {
        return {
          content: [{ type: 'text', text: 'Error: fileId is required' }],
          isError: true,
        };
      }

      const drive = await getDriveClient(googleRefreshToken);

      // First, get file metadata to determine type
      const fileMetadata = await drive.files.get({
        fileId: args.fileId,
        fields: 'id, name, mimeType, size',
      });

      const mimeType = fileMetadata.data.mimeType || '';
      const fileName = fileMetadata.data.name || 'unknown';

      // Google Workspace files need to be exported
      const googleDocsTypes: Record<string, { exportMime: string; label: string }> = {
        'application/vnd.google-apps.document': { exportMime: 'text/plain', label: 'Google Doc' },
        'application/vnd.google-apps.spreadsheet': { exportMime: 'text/csv', label: 'Google Sheet' },
        'application/vnd.google-apps.presentation': { exportMime: 'text/plain', label: 'Google Slides' },
        'application/vnd.google-apps.drawing': { exportMime: 'image/svg+xml', label: 'Google Drawing' },
      };

      let content: string;

      if (googleDocsTypes[mimeType]) {
        // Export Google Workspace files
        const exportType = googleDocsTypes[mimeType];
        const response = await drive.files.export({
          fileId: args.fileId,
          mimeType: exportType.exportMime,
        }, {
          responseType: 'text',
        });

        content = response.data as string;

        return {
          content: [
            {
              type: 'text',
              text: `**${fileName}** (${exportType.label})\n\n${content}`,
            },
          ],
        };
      }

      // For regular files, download content
      const response = await drive.files.get({
        fileId: args.fileId,
        alt: 'media',
      }, {
        responseType: 'text',
      });

      content = response.data as string;

      // Truncate very large files
      const maxLength = 100000; // ~100KB of text
      if (content.length > maxLength) {
        content = content.substring(0, maxLength) + '\n\n... [Content truncated - file too large]';
      }

      return {
        content: [
          {
            type: 'text',
            text: `**${fileName}** (${mimeType})\n\n${content}`,
          },
        ],
      };
    },
  },

  {
    name: 'move_file',
    description: 'Move a file or folder to a different location in Google Drive.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The ID of the file or folder to move',
        },
        destinationFolderId: {
          type: 'string',
          description: 'The ID of the destination folder. Use "root" for the root of My Drive.',
        },
      },
      required: ['fileId', 'destinationFolderId'],
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      if (!args?.fileId) {
        return {
          content: [{ type: 'text', text: 'Error: fileId is required' }],
          isError: true,
        };
      }
      if (!args?.destinationFolderId) {
        return {
          content: [{ type: 'text', text: 'Error: destinationFolderId is required' }],
          isError: true,
        };
      }

      const drive = await getDriveClient(googleRefreshToken);

      // Get current parents to remove them
      const file = await drive.files.get({
        fileId: args.fileId,
        fields: 'id, name, parents',
      });

      const previousParents = file.data.parents?.join(',') || '';

      // Move file by updating parents
      const response = await drive.files.update({
        fileId: args.fileId,
        addParents: args.destinationFolderId,
        removeParents: previousParents,
        fields: 'id, name, parents, webViewLink',
      });

      return {
        content: [
          {
            type: 'text',
            text: `File moved successfully!\n\n${JSON.stringify({
              id: response.data.id,
              name: response.data.name,
              newParent: response.data.parents?.[0],
              link: response.data.webViewLink,
            }, null, 2)}`,
          },
        ],
      };
    },
  },

  {
    name: 'rename_file',
    description: 'Rename a file or folder in Google Drive.',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description: 'The ID of the file or folder to rename',
        },
        newName: {
          type: 'string',
          description: 'The new name for the file or folder',
        },
      },
      required: ['fileId', 'newName'],
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      if (!args?.fileId) {
        return {
          content: [{ type: 'text', text: 'Error: fileId is required' }],
          isError: true,
        };
      }
      if (!args?.newName) {
        return {
          content: [{ type: 'text', text: 'Error: newName is required' }],
          isError: true,
        };
      }

      const drive = await getDriveClient(googleRefreshToken);

      // Get current file info for the response
      const currentFile = await drive.files.get({
        fileId: args.fileId,
        fields: 'id, name',
      });

      const oldName = currentFile.data.name;

      // Rename the file
      const response = await drive.files.update({
        fileId: args.fileId,
        requestBody: {
          name: args.newName,
        },
        fields: 'id, name, webViewLink, mimeType',
      });

      return {
        content: [
          {
            type: 'text',
            text: `File renamed successfully!\n\n${JSON.stringify({
              id: response.data.id,
              oldName: oldName,
              newName: response.data.name,
              type: response.data.mimeType,
              link: response.data.webViewLink,
            }, null, 2)}`,
          },
        ],
      };
    },
  },
];
