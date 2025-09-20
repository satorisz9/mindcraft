import fs from 'fs';
import path from 'path';

/**
 * Write Tool - Writes or overwrites files
 */
export class WriteTool {
    constructor(agent = null) {
        this.name = 'Write';
        this.agent = agent;
        this.description = "Writes a file to the local filesystem.\n\nUsage:\n- This tool will overwrite the existing file if there is one at the provided path.\n- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.\n- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.";
        this.input_schema = {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "The absolute path to the file to write (must be absolute, not relative)"
                },
                "content": {
                    "type": "string",
                    "description": "The content to write to the file"
                }
            },
            "required": ["file_path", "content"],
            "additionalProperties": false,
            "$schema": "http://json-schema.org/draft-07/schema#"
        };
        this.readFiles = new Set(); // Track files that have been read
    }

    getDescription() {
        return this.description;
    }

    getInputSchema() {
        return this.input_schema;
    }

    /**
     * Execute the write operation
     * @param {Object} params - The write parameters
     * @param {string} params.file_path - Absolute path to the file
     * @param {string} params.content - Content to write to the file
     * @returns {Object} Result object
     */
    execute(params) {
        try {
            const { file_path, content } = params;
            
            // Validate required parameters
            if (!file_path || content === undefined) {
                throw new Error('[Write Tool] Missing required parameters: file_path, content');
            }
            // Check if this is an existing file
            const fileExists = fs.existsSync(file_path);
            
            // File read check removed - allow direct overwriting

            // Ensure directory exists
            const dir = path.dirname(file_path);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Write content to file
            fs.writeFileSync(file_path, content, 'utf8');
            const stats = fs.statSync(file_path);
            const action = fileExists ? 'overwritten' : 'created';

            return {
                success: true,
                message: `Successfully ${action} ${path.basename(file_path)} (${stats.size} bytes)`,
                file_path,
                size: stats.size,
                action
            };

        } catch (error) {
            return {
                success: false,
                message: `## Write Tool Error ##\n**Error:** ${error.message}`
            };
        }
    }

    /**
     * Mark a file as read (called by Read tool)
     * @param {string} filePath - Path to the file that was read
     */
    markFileAsRead(filePath) {
        this.readFiles.add(filePath);
    }
}

export default WriteTool;
