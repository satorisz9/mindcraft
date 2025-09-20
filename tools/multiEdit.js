import fs from 'fs';
import path from 'path';
import { EditTool } from './edit.js';

/**
 * MultiEdit Tool - Performs multiple edits on a single file in one atomic operation
 */
export class MultiEditTool {
    constructor(agent = null) {
        this.name = 'MultiEdit';
        this.agent = agent;
        this.description = "This is a tool for making multiple edits to a single file in one operation. It is built on top of the Edit tool and allows you to perform multiple find-and-replace operations efficiently. Prefer this tool over the Edit tool when you need to make multiple edits to the same file.\n\nBefore using this tool:\n\n1. Use the Read tool to understand the file's contents and context\n2. Verify the directory path is correct\n\nTo make multiple file edits, provide the following:\n1. file_path: The absolute path to the file to modify (must be absolute, not relative)\n2. edits: An array of edit operations to perform, where each edit contains:\n   - old_string: The text to replace (must match the file contents exactly, including all whitespace and indentation)\n   - new_string: The edited text to replace the old_string\n   - replace_all: Replace all occurences of old_string. This parameter is optional and defaults to false.\n\nIMPORTANT:\n- All edits are applied in sequence, in the order they are provided\n- Each edit operates on the result of the previous edit\n- All edits must be valid for the operation to succeed - if any edit fails, none will be applied\n- This tool is ideal when you need to make several changes to different parts of the same file\n- For Jupyter notebooks (.ipynb files), use the NotebookEdit instead\n\nCRITICAL REQUIREMENTS:\n1. All edits follow the same requirements as the single Edit tool\n2. The edits are atomic - either all succeed or none are applied\n3. Plan your edits carefully to avoid conflicts between sequential operations\n\nWARNING:\n- The tool will fail if edits.old_string doesn't match the file contents exactly (including whitespace)\n- The tool will fail if edits.old_string and edits.new_string are the same\n- Since edits are applied in sequence, ensure that earlier edits don't affect the text that later edits are trying to find\n\nWhen making edits:\n- Ensure all edits result in idiomatic, correct code\n- Do not leave the code in a broken state\n- Always use absolute file paths (starting with /)\n- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.\n- Use replace_all for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.\n\nIf you want to create a new file, use:\n- A new file path, including dir name if needed\n- First edit: empty old_string and the new file's contents as new_string\n- Subsequent edits: normal edit operations on the created content";
        this.input_schema = {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "The absolute path to the file to modify"
                },
                "edits": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "old_string": {
                                "type": "string",
                                "description": "The text to replace"
                            },
                            "new_string": {
                                "type": "string",
                                "description": "The text to replace it with"
                            },
                            "replace_all": {
                                "type": "boolean",
                                "default": false,
                                "description": "Replace all occurences of old_string (default false)."
                            }
                        },
                        "required": ["old_string", "new_string"],
                        "additionalProperties": false
                    },
                    "minItems": 1,
                    "description": "Array of edit operations to perform sequentially on the file"
                }
            },
            "required": ["file_path", "edits"],
            "additionalProperties": false,
            "$schema": "http://json-schema.org/draft-07/schema#"
        };
        this.editTool = new EditTool();
    }


    getDescription() {
        return this.description;
    }


    getInputSchema() {
        return this.input_schema;
    }

    /**
     * Execute multiple edits atomically on a single file
     * @param {Object} params - The edit parameters
     * @param {string} params.file_path - Absolute path to the file
     * @param {Array} params.edits - Array of edit operations
     * @returns {Object} Result object
     */
    async execute(params) {
        try {
            const { file_path, edits } = params;

            // Validate required parameters
            if (!file_path || !edits || !Array.isArray(edits) || edits.length === 0) {
                throw new Error('[MultiEdit Tool] Missing required parameters: file_path and edits array');
            }

            // File read check removed - allow direct editing

            // Check if file exists
            if (!fs.existsSync(file_path)) {
                throw new Error(`[MultiEdit Tool] File does not exist: ${file_path}`);
            }

            // Validate all edits first
            for (let i = 0; i < edits.length; i++) {
                const edit = edits[i];
                if (!edit.old_string || edit.new_string === undefined) {
                    throw new Error(`[MultiEdit Tool] Edit ${i + 1}: Missing required parameters old_string or new_string`);
                }
                if (edit.old_string === edit.new_string) {
                    throw new Error(`[MultiEdit Tool] Edit ${i + 1}: old_string and new_string must be different`);
                }
            }

            // Read original file content
            let content = fs.readFileSync(file_path, 'utf8');
            const originalContent = content;
            const results = [];

            // Apply edits sequentially
            for (let i = 0; i < edits.length; i++) {
                const edit = edits[i];
                const { old_string, new_string, replace_all = false } = edit;

                // Check if old_string exists in current content
                if (!content.includes(old_string)) {
                    throw new Error(`[MultiEdit Tool] Edit ${i + 1}: String not found in file: "${old_string}"`);
                }

                // Escape regex special characters in old_string for literal matching
                const escapedOld = old_string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                // Check for uniqueness if not replace_all
                if (!replace_all) {
                    const occurrences = (content.match(new RegExp(escapedOld, 'g')) || []).length;
                    if (occurrences > 1) {
                        throw new Error(`[MultiEdit Tool] Edit ${i + 1}: String "${old_string}" appears ${occurrences} times. Use replace_all=true or provide more context to make it unique`);
                    }
                }

                // Perform replacement
                const beforeLength = content.length;
                if (replace_all) {
                    content = content.replaceAll(old_string, new_string);
                } else {
                    content = content.replace(old_string, new_string);
                }

                const replacements = replace_all 
                    ? (originalContent.match(new RegExp(escapedOld, 'g')) || []).length
                    : 1;

                results.push({
                    edit: i + 1,
                    old_string: old_string.substring(0, 50) + (old_string.length > 50 ? '...' : ''),
                    new_string: new_string.substring(0, 50) + (new_string.length > 50 ? '...' : ''),
                    replacements,
                    success: true
                });
            }

            // Write the final content back to file
            fs.writeFileSync(file_path, content, 'utf8');

            const totalReplacements = results.reduce((sum, result) => sum + result.replacements, 0);

            return {
                success: true,
                message: `Successfully applied ${edits.length} edits with ${totalReplacements} total replacements in ${path.basename(file_path)}`,
                file_path,
                edits_applied: edits.length,
                total_replacements: totalReplacements,
                results
            };

        } catch (error) {
            return {
                success: false,
                message: `## MultiEdit Tool Error ##\n**Error:** ${error.message}`
            };
        }
    }
}

export default MultiEditTool;
