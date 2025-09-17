import fs from 'fs';
import path from 'path';

/**
 * Read Tool - Reads file contents with line number formatting
 */
export class ReadTool {
    constructor(agent = null) {
        this.name = 'Read';
        this.agent = agent;
        this.description = "Reads a file at the specified relative path.\nThis tool is only able to read files in the workspace that are not gitignored.\nIf the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.\n\nUsage:\n- The file_path parameter must be an absolute path, not a relative path\n- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters\n- Any lines longer than 2000 characters will be truncated\n- Text files are returned with 1-indexed line numbers in cat -n format\n- Image files (jpg, jpeg, png, gif, bmp, webp, svg, tiff, ico, heic, heif) are automatically presented visually\n- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.\n- You will regularly be asked to read screenshots. If the user provides a path to a screenshot ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths like /var/folders/123/abc/T/TemporaryItems/NSIRD_screencaptureui_ZfB1tD/Screenshot.png\n- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.";
        this.input_schema = {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "The path to the file to read. Must be an absolute path."
                },
                "limit": {
                    "type": "integer",
                    "description": "The number of lines to read. Only provide if the file is too large to read at once."
                },
                "offset": {
                    "type": "integer",
                    "description": "The 1-indexed line number to start reading from. Only provide if the file is too large to read at once"
                }
            },
            "required": ["file_path"],
            "additionalProperties": false,
            "$schema": "http://json-schema.org/draft-07/schema#"
        };
        this.toolRegistry = null; // Will be set by ToolManager
    }

    /**
     * Get tool description
     * @returns {string} Tool description
     */
    getDescription() {
        return this.description;
    }

    /**
     * Get input schema
     * @returns {Object} Input schema
     */
    getInputSchema() {
        return this.input_schema;
    }

    /**
     * Execute the read operation
     * @param {Object} params - The read parameters
     * @param {string} params.file_path - Absolute path to the file
     * @param {number} params.offset - Line offset to start reading from (1-indexed)
     * @param {number} params.limit - Number of lines to read
     * @returns {Object} Result object
     */
    async execute(params) {
        try {
            const { file_path, offset, limit } = params;

            // Validate required parameters
            if (!file_path) {
                throw new Error('[Read Tool] Missing required parameter: file_path');
            }

            // Check if file exists
            if (!fs.existsSync(file_path)) {
                throw new Error(`[Read Tool] File does not exist: ${file_path}`);
            }

            // Check if it's a file (not directory)
            const stats = fs.statSync(file_path);
            if (!stats.isFile()) {
                throw new Error(`[Read Tool] Path is not a file: ${file_path}`);
            }

            // Read file content
            const content = fs.readFileSync(file_path, 'utf8');
            const lines = content.split('\n');

            // Apply offset and limit if specified
            let displayLines = lines;
            let startLine = 1;
            let endLine = lines.length;

            if (offset !== undefined) {
                startLine = Math.max(1, offset);
                displayLines = lines.slice(startLine - 1);
            }

            if (limit !== undefined) {
                displayLines = displayLines.slice(0, limit);
                endLine = Math.min(startLine + limit - 1, lines.length);
            } else if (offset !== undefined) {
                endLine = lines.length;
            }

            // Format output with line numbers (cat -n format)
            const formattedContent = displayLines
                .map((line, index) => {
                    const lineNumber = startLine + index;
                    return `     ${lineNumber}→${line}`;
                })
                .join('\n');

            // Mark file as read for other tools
            this.markFileAsReadInOtherTools(file_path);

            const truncated = offset !== undefined || limit !== undefined;
            const fullLength = lines.length;

            return {
                success: true,
                message: `Read ${path.basename(file_path)} (${stats.size} bytes)`,
                file_path,
                size: stats.size,
                start_line: startLine,
                end_line: endLine,
                full_length: fullLength,
                truncated,
                content: formattedContent
            };

        } catch (error) {
            return {
                success: false,
                message: `## Read Tool Error ##\n**Error:** ${error.message}`
            };
        }
    }

    /**
     * Mark file as read in other tools that need this information
     * @param {string} filePath - Path to the file that was read
     */
    markFileAsReadInOtherTools(filePath) {
        if (this.toolRegistry) {
            // Mark in Edit tool
            const editTool = this.toolRegistry.get('Edit');
            if (editTool) {
                editTool.markFileAsRead(filePath);
            }

            // Mark in MultiEdit tool
            const multiEditTool = this.toolRegistry.get('MultiEdit');
            if (multiEditTool) {
                multiEditTool.markFileAsRead(filePath);
            }

            // Mark in Write tool
            const writeTool = this.toolRegistry.get('Write');
            if (writeTool) {
                writeTool.markFileAsRead(filePath);
            }
        }
    }

    /**
     * Set the tool registry for cross-tool communication
     * @param {Map} registry - Tool registry
     */
    setToolRegistry(registry) {
        this.toolRegistry = registry;
    }
}

export default ReadTool;
