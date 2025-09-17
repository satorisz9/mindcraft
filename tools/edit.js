import fs from 'fs';
import path from 'path';

/**
 * Edit Tool - Performs exact string replacements in files
 */
export class EditTool {
    constructor(agent = null) {
        this.name = 'Edit';
        this.agent = agent;
        this.description = "Performs exact string replacements in files. \n\nUsage:\n- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.\n- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`. \n- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.";
        this.input_schema = {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "The absolute path to the file to modify"
                },
                "old_string": {
                    "type": "string",
                    "description": "The text to replace"
                },
                "new_string": {
                    "type": "string",
                    "description": "The text to replace it with (must be different from old_string)"
                },
                "replace_all": {
                    "type": "boolean",
                    "default": false,
                    "description": "Replace all occurences of old_string (default false)"
                }
            },
            "required": ["file_path", "old_string", "new_string"],
            "additionalProperties": false,
            "$schema": "http://json-schema.org/draft-07/schema#"
        };
        this.readFiles = new Set(); // Track files that have been read
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
     * Execute the edit operation
     * @param {Object} params - The edit parameters
     * @param {string} params.file_path - Absolute path to the file
     * @param {string} params.old_string - Text to replace
     * @param {string} params.new_string - Replacement text
     * @param {boolean} params.replace_all - Replace all occurrences
     * @returns {Object} Result object
     */
    async execute(params) {
        try {
            const { file_path, old_string, new_string, replace_all = false } = params;

            // Validate required parameters
            if (!file_path || !old_string || new_string === undefined) {
                throw new Error('[Edit Tool] Missing required parameters: file_path, old_string, new_string');
            }

            // Validate old_string and new_string are different
            if (old_string === new_string) {
                throw new Error('[Edit Tool] old_string and new_string must be different');
            }

            // File read check removed - allow direct editing

            // Check if file exists
            if (!fs.existsSync(file_path)) {
                throw new Error(`[Edit Tool] File does not exist: ${file_path}`);
            }

            // Read current file content
            const content = fs.readFileSync(file_path, 'utf8');

            // Check if old_string exists in file
            if (!content.includes(old_string)) {
                throw new Error(`[Edit Tool] String not found in file: "${old_string}"`);
            }

            // Check for uniqueness if not replace_all
            if (!replace_all) {
                const occurrences = (content.match(new RegExp(this.escapeRegex(old_string), 'g')) || []).length;
                if (occurrences > 1) {
                    throw new Error(`[Edit Tool] String "${old_string}" appears ${occurrences} times. Use replace_all=true or provide more context to make it unique`);
                }
            }

            // Perform replacement
            let newContent;
            if (replace_all) {
                newContent = content.replaceAll(old_string, new_string);
            } else {
                newContent = content.replace(old_string, new_string);
            }

            // Write back to file
            fs.writeFileSync(file_path, newContent, 'utf8');

            const replacements = replace_all 
                ? (content.match(new RegExp(this.escapeRegex(old_string), 'g')) || []).length
                : 1;

            return {
                success: true,
                message: `Successfully replaced ${replacements} occurrence(s) in ${path.basename(file_path)}`,
                replacements,
                file_path
            };

        } catch (error) {
            return {
                success: false,
                message: `## Edit Tool Error ##\n**Error:** ${error.message}`
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

    /**
     * Escape special regex characters
     * @param {string} string - String to escape
     * @returns {string} Escaped string
     */
    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

export default EditTool;
