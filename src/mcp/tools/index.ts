import { Tool, ToolDefinition } from '../types.js';
import { driveTools } from './drive.js';
import { docsTools } from './docs.js';
import { sheetsTools } from './sheets.js';

export const tools: Tool[] = [
  ...driveTools,
  ...docsTools,
  ...sheetsTools,
];

export const toolDefinitions: ToolDefinition[] = tools.map(({ name, description, inputSchema }) => ({
  name,
  description,
  inputSchema,
}));

export const toolsByName = new Map(tools.map(t => [t.name, t]));
