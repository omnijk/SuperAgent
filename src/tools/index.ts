import type { ToolDefinition } from './registry.js';
import { weatherTool, calculatorTool,fetchUrlTool } from './utility-tools.js';
import { readFileTool, writeFileTool, editFileTool, listDirectoryTool } from './file-tools.js';
import { globTool, grepTool } from './search-tools.js';
import { bashTool } from './shell-tools.js';
import {startPreviewTool} from './server-preview.js'
import { pickSearchTool, webFetchTool } from './web-search.js';

export const allTools: ToolDefinition[] = [
  weatherTool,
  calculatorTool,
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  editFileTool,
  globTool,
  grepTool,
  bashTool,
  pickSearchTool(),
  webFetchTool,
  fetchUrlTool,
  startPreviewTool,
];

export {
  weatherTool, calculatorTool,
  readFileTool, writeFileTool, editFileTool, listDirectoryTool,
  globTool, grepTool,
  bashTool,
};

