import { google } from 'googleapis';
import { Tool, ToolResult } from '../types.js';
import { getGoogleOAuthClient } from '../../oauth/index.js';

async function getDocsClient(googleRefreshToken: string) {
  const googleOAuth = await getGoogleOAuthClient();
  googleOAuth.setCredentials({ refresh_token: googleRefreshToken });
  return google.docs({ version: 'v1', auth: googleOAuth });
}

export const docsTools: Tool[] = [
  {
    name: 'append_to_doc',
    description: 'Append text to the end of an existing Google Doc.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc to append to',
        },
        text: {
          type: 'string',
          description: 'The text to append to the document',
        },
      },
      required: ['documentId', 'text'],
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      if (!args?.documentId) {
        return {
          content: [{ type: 'text', text: 'Error: documentId is required' }],
          isError: true,
        };
      }
      if (!args?.text) {
        return {
          content: [{ type: 'text', text: 'Error: text is required' }],
          isError: true,
        };
      }

      const docs = await getDocsClient(googleRefreshToken);

      // Get document to find the end index
      const doc = await docs.documents.get({ documentId: args.documentId });
      const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

      // Insert text at the end (before the final newline)
      await docs.documents.batchUpdate({
        documentId: args.documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: endIndex - 1 },
                text: args.text,
              },
            },
          ],
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Text appended successfully to document "${doc.data.title}".\n\nAppended ${args.text.length} characters.`,
          },
        ],
      };
    },
  },

  {
    name: 'find_replace_in_doc',
    description: 'Find and replace text in a Google Doc.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc',
        },
        findText: {
          type: 'string',
          description: 'The text to find',
        },
        replaceText: {
          type: 'string',
          description: 'The text to replace it with',
        },
        matchCase: {
          type: 'boolean',
          description: 'Whether to match case (default: false)',
        },
      },
      required: ['documentId', 'findText', 'replaceText'],
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      if (!args?.documentId) {
        return {
          content: [{ type: 'text', text: 'Error: documentId is required' }],
          isError: true,
        };
      }
      if (!args?.findText) {
        return {
          content: [{ type: 'text', text: 'Error: findText is required' }],
          isError: true,
        };
      }
      if (args?.replaceText === undefined) {
        return {
          content: [{ type: 'text', text: 'Error: replaceText is required' }],
          isError: true,
        };
      }

      const docs = await getDocsClient(googleRefreshToken);

      const response = await docs.documents.batchUpdate({
        documentId: args.documentId,
        requestBody: {
          requests: [
            {
              replaceAllText: {
                containsText: {
                  text: args.findText,
                  matchCase: args.matchCase || false,
                },
                replaceText: args.replaceText,
              },
            },
          ],
        },
      });

      const occurrences = response.data.replies?.[0]?.replaceAllText?.occurrencesChanged || 0;

      return {
        content: [
          {
            type: 'text',
            text: `Find and replace completed.\n\nReplaced ${occurrences} occurrence(s) of "${args.findText}" with "${args.replaceText}".`,
          },
        ],
      };
    },
  },

  {
    name: 'insert_text',
    description: 'Insert text at a specific position in a Google Doc with optional formatting.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc',
        },
        text: {
          type: 'string',
          description: 'The text to insert',
        },
        position: {
          type: 'string',
          enum: ['start', 'end'],
          description: 'Where to insert: "start" or "end" of the document (default: end)',
        },
        formatting: {
          type: 'object',
          description: 'Optional formatting to apply',
          properties: {
            bold: { type: 'boolean', description: 'Make text bold' },
            italic: { type: 'boolean', description: 'Make text italic' },
            underline: { type: 'boolean', description: 'Underline the text' },
            fontSize: { type: 'number', description: 'Font size in points (e.g., 12, 14, 18)' },
            foregroundColor: {
              type: 'object',
              description: 'Text color as RGB (0-1 values)',
              properties: {
                red: { type: 'number' },
                green: { type: 'number' },
                blue: { type: 'number' },
              },
            },
          },
        },
      },
      required: ['documentId', 'text'],
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      if (!args?.documentId) {
        return {
          content: [{ type: 'text', text: 'Error: documentId is required' }],
          isError: true,
        };
      }
      if (!args?.text) {
        return {
          content: [{ type: 'text', text: 'Error: text is required' }],
          isError: true,
        };
      }

      const docs = await getDocsClient(googleRefreshToken);

      // Get document to find positions
      const doc = await docs.documents.get({ documentId: args.documentId });
      const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

      // Determine insert position
      const insertIndex = args.position === 'start' ? 1 : endIndex - 1;

      const requests: any[] = [
        {
          insertText: {
            location: { index: insertIndex },
            text: args.text,
          },
        },
      ];

      // Apply formatting if specified
      if (args.formatting) {
        const textStyle: any = {};
        const fields: string[] = [];

        if (args.formatting.bold !== undefined) {
          textStyle.bold = args.formatting.bold;
          fields.push('bold');
        }
        if (args.formatting.italic !== undefined) {
          textStyle.italic = args.formatting.italic;
          fields.push('italic');
        }
        if (args.formatting.underline !== undefined) {
          textStyle.underline = args.formatting.underline;
          fields.push('underline');
        }
        if (args.formatting.fontSize) {
          textStyle.fontSize = { magnitude: args.formatting.fontSize, unit: 'PT' };
          fields.push('fontSize');
        }
        if (args.formatting.foregroundColor) {
          textStyle.foregroundColor = { color: { rgbColor: args.formatting.foregroundColor } };
          fields.push('foregroundColor');
        }

        if (fields.length > 0) {
          requests.push({
            updateTextStyle: {
              range: {
                startIndex: insertIndex,
                endIndex: insertIndex + args.text.length,
              },
              textStyle,
              fields: fields.join(','),
            },
          });
        }
      }

      await docs.documents.batchUpdate({
        documentId: args.documentId,
        requestBody: { requests },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Text inserted successfully at ${args.position || 'end'} of document "${doc.data.title}".\n\nInserted ${args.text.length} characters.`,
          },
        ],
      };
    },
  },

  {
    name: 'set_heading',
    description: 'Convert a paragraph containing specific text to a heading style.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc',
        },
        text: {
          type: 'string',
          description: 'The text of the paragraph to convert to a heading',
        },
        level: {
          type: 'number',
          enum: [1, 2, 3, 4, 5, 6],
          description: 'Heading level (1-6, where 1 is the largest)',
        },
      },
      required: ['documentId', 'text', 'level'],
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      if (!args?.documentId) {
        return {
          content: [{ type: 'text', text: 'Error: documentId is required' }],
          isError: true,
        };
      }
      if (!args?.text) {
        return {
          content: [{ type: 'text', text: 'Error: text is required' }],
          isError: true,
        };
      }
      if (!args?.level || args.level < 1 || args.level > 6) {
        return {
          content: [{ type: 'text', text: 'Error: level must be between 1 and 6' }],
          isError: true,
        };
      }

      const docs = await getDocsClient(googleRefreshToken);

      // Get document to find the text
      const doc = await docs.documents.get({ documentId: args.documentId });

      // Find the paragraph containing the text
      let startIndex = -1;
      let endIndex = -1;

      const content = doc.data.body?.content || [];
      for (const element of content) {
        if (element.paragraph) {
          const paragraphText = element.paragraph.elements
            ?.map((e: any) => e.textRun?.content || '')
            .join('') || '';

          if (paragraphText.includes(args.text)) {
            startIndex = element.startIndex || 0;
            endIndex = element.endIndex || 0;
            break;
          }
        }
      }

      if (startIndex === -1) {
        return {
          content: [{ type: 'text', text: `Error: Could not find paragraph containing "${args.text}"` }],
          isError: true,
        };
      }

      const headingType = `HEADING_${args.level}`;

      await docs.documents.batchUpdate({
        documentId: args.documentId,
        requestBody: {
          requests: [
            {
              updateParagraphStyle: {
                range: { startIndex, endIndex },
                paragraphStyle: { namedStyleType: headingType },
                fields: 'namedStyleType',
              },
            },
          ],
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Heading applied successfully. Set "${args.text}" as Heading ${args.level}.`,
          },
        ],
      };
    },
  },

  {
    name: 'insert_image',
    description: 'Insert an image into a Google Doc from a URL.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc',
        },
        imageUrl: {
          type: 'string',
          description: 'The URL of the image to insert (must be publicly accessible)',
        },
        position: {
          type: 'string',
          enum: ['start', 'end'],
          description: 'Where to insert: "start" or "end" of the document (default: end)',
        },
        width: {
          type: 'number',
          description: 'Optional width in points (72 points = 1 inch)',
        },
        height: {
          type: 'number',
          description: 'Optional height in points (72 points = 1 inch)',
        },
      },
      required: ['documentId', 'imageUrl'],
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      if (!args?.documentId) {
        return {
          content: [{ type: 'text', text: 'Error: documentId is required' }],
          isError: true,
        };
      }
      if (!args?.imageUrl) {
        return {
          content: [{ type: 'text', text: 'Error: imageUrl is required' }],
          isError: true,
        };
      }

      const docs = await getDocsClient(googleRefreshToken);

      // Get document to find positions
      const doc = await docs.documents.get({ documentId: args.documentId });
      const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

      // Determine insert position
      const insertIndex = args.position === 'start' ? 1 : endIndex - 1;

      const imageRequest: any = {
        insertInlineImage: {
          location: { index: insertIndex },
          uri: args.imageUrl,
        },
      };

      // Add size if specified
      if (args.width || args.height) {
        imageRequest.insertInlineImage.objectSize = {};
        if (args.width) {
          imageRequest.insertInlineImage.objectSize.width = { magnitude: args.width, unit: 'PT' };
        }
        if (args.height) {
          imageRequest.insertInlineImage.objectSize.height = { magnitude: args.height, unit: 'PT' };
        }
      }

      await docs.documents.batchUpdate({
        documentId: args.documentId,
        requestBody: {
          requests: [imageRequest],
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Image inserted successfully at ${args.position || 'end'} of document "${doc.data.title}".`,
          },
        ],
      };
    },
  },

  {
    name: 'insert_link',
    description: 'Insert a hyperlink into a Google Doc.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc',
        },
        text: {
          type: 'string',
          description: 'The display text for the link',
        },
        url: {
          type: 'string',
          description: 'The URL the link points to',
        },
        position: {
          type: 'string',
          enum: ['start', 'end'],
          description: 'Where to insert: "start" or "end" of the document (default: end)',
        },
      },
      required: ['documentId', 'text', 'url'],
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      if (!args?.documentId) {
        return {
          content: [{ type: 'text', text: 'Error: documentId is required' }],
          isError: true,
        };
      }
      if (!args?.text) {
        return {
          content: [{ type: 'text', text: 'Error: text is required' }],
          isError: true,
        };
      }
      if (!args?.url) {
        return {
          content: [{ type: 'text', text: 'Error: url is required' }],
          isError: true,
        };
      }

      const docs = await getDocsClient(googleRefreshToken);

      // Get document to find positions
      const doc = await docs.documents.get({ documentId: args.documentId });
      const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

      // Determine insert position
      const insertIndex = args.position === 'start' ? 1 : endIndex - 1;

      await docs.documents.batchUpdate({
        documentId: args.documentId,
        requestBody: {
          requests: [
            {
              insertText: {
                location: { index: insertIndex },
                text: args.text,
              },
            },
            {
              updateTextStyle: {
                range: {
                  startIndex: insertIndex,
                  endIndex: insertIndex + args.text.length,
                },
                textStyle: {
                  link: { url: args.url },
                },
                fields: 'link',
              },
            },
          ],
        },
      });

      return {
        content: [
          {
            type: 'text',
            text: `Link inserted successfully at ${args.position || 'end'} of document "${doc.data.title}".\n\nLink text: "${args.text}"\nURL: ${args.url}`,
          },
        ],
      };
    },
  },

  {
    name: 'insert_list',
    description: 'Insert a bulleted or numbered list into a Google Doc.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: {
          type: 'string',
          description: 'The ID of the Google Doc',
        },
        items: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of list items',
        },
        listType: {
          type: 'string',
          enum: ['bullet', 'numbered'],
          description: 'Type of list: "bullet" or "numbered" (default: bullet)',
        },
        position: {
          type: 'string',
          enum: ['start', 'end'],
          description: 'Where to insert: "start" or "end" of the document (default: end)',
        },
      },
      required: ['documentId', 'items'],
    },
    handler: async (args: any, googleRefreshToken: string): Promise<ToolResult> => {
      if (!args?.documentId) {
        return {
          content: [{ type: 'text', text: 'Error: documentId is required' }],
          isError: true,
        };
      }
      if (!args?.items || !Array.isArray(args.items) || args.items.length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: items array is required and must not be empty' }],
          isError: true,
        };
      }

      const docs = await getDocsClient(googleRefreshToken);

      // Get document to find positions
      const doc = await docs.documents.get({ documentId: args.documentId });
      const endIndex = doc.data.body?.content?.slice(-1)[0]?.endIndex || 1;

      // Determine insert position
      const insertIndex = args.position === 'start' ? 1 : endIndex - 1;

      // Create the list text with newlines
      const listText = args.items.map((item: string) => item).join('\n') + '\n';

      const requests: any[] = [
        {
          insertText: {
            location: { index: insertIndex },
            text: listText,
          },
        },
      ];

      // Apply bullet/numbered list formatting
      const bulletPreset = args.listType === 'numbered'
        ? 'NUMBERED_DECIMAL_ALPHA_ROMAN'
        : 'BULLET_DISC_CIRCLE_SQUARE';

      requests.push({
        createParagraphBullets: {
          range: {
            startIndex: insertIndex,
            endIndex: insertIndex + listText.length,
          },
          bulletPreset,
        },
      });

      await docs.documents.batchUpdate({
        documentId: args.documentId,
        requestBody: { requests },
      });

      return {
        content: [
          {
            type: 'text',
            text: `${args.listType === 'numbered' ? 'Numbered' : 'Bulleted'} list inserted successfully at ${args.position || 'end'} of document "${doc.data.title}".\n\nInserted ${args.items.length} items.`,
          },
        ],
      };
    },
  },
];
