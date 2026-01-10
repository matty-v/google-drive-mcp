import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { Tool, ToolResult } from "../types.js";
import { config } from "../../config.js";

async function getSheetsClient(googleRefreshToken: string) {
  const oauth2Client = new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret
  );
  oauth2Client.setCredentials({ refresh_token: googleRefreshToken });
  return google.sheets({ version: "v4", auth: oauth2Client });
}

async function getDriveClient(googleRefreshToken: string) {
  const oauth2Client = new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret
  );
  oauth2Client.setCredentials({ refresh_token: googleRefreshToken });
  return google.drive({ version: "v3", auth: oauth2Client });
}

export const sheetsTools: Tool[] = [
  {
    name: 'create_sheet',
    description: 'Create a new Google Sheet with optional initial data.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the spreadsheet to create',
        },
        data: {
          type: 'array',
          description: 'Optional 2D array of data to populate the sheet. Each inner array is a row.',
          items: {
            type: 'array',
            items: {
              type: ['string', 'number', 'boolean'],
            },
          },
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

      // Create the spreadsheet using Drive API
      const fileMetadata: any = {
        name: args.name,
        mimeType: 'application/vnd.google-apps.spreadsheet',
      };

      if (args.parentFolderId) {
        fileMetadata.parents = [args.parentFolderId];
      }

      const createResponse = await drive.files.create({
        requestBody: fileMetadata,
        fields: 'id, name, webViewLink',
      });

      const spreadsheetId = createResponse.data.id!;

      // If data is provided, populate the sheet using Sheets API
      if (args.data && Array.isArray(args.data) && args.data.length > 0) {
        const sheets = await getSheetsClient(googleRefreshToken);

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Sheet1!A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: args.data,
          },
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: `Google Sheet created successfully!\n\n${JSON.stringify({
              id: spreadsheetId,
              name: createResponse.data.name,
              link: createResponse.data.webViewLink,
              rowsAdded: args.data?.length || 0,
            }, null, 2)}`,
          },
        ],
      };
    },
  },
];
