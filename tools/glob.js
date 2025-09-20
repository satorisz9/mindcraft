import fs from 'fs';
import path from 'path';
import process from 'process';
import { glob } from 'glob';

/**
 * Glob Tool - Fast file pattern matching using glob syntax
 */
export class GlobTool {
    constructor(agent = null) {
        this.name = 'Glob';
        this.agent = agent;
        this.description = "- Fast file pattern matching tool that works with any codebase size\n- Supports glob patterns like \"**/*.js\" or \"src/**/*.ts\"\n- Returns matching file paths sorted by modification time\n- Use this tool when you need to find files by name patterns\n- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead\n- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.";
        this.input_schema = {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "The glob pattern to match files against"
                },
                "path": {
                    "type": "string",
                    "description": "The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter \"undefined\" or \"null\" - simply omit it for the default behavior. Must be a valid directory path if provided."
                }
            },
            "required": ["pattern"],
            "additionalProperties": false,
            "$schema": "http://json-schema.org/draft-07/schema#"
        };
    }
    
    getDescription() {
        return this.description;
    }
    
    getInputSchema() {
        return this.input_schema;
    }

    /**
     * Execute the glob search
     * @param {Object} params - The glob parameters
     * @param {string} params.pattern - The glob pattern to match files against
     * @param {string} params.path - The directory to search in (optional)
     * @returns {Object} Result object
     */
    async execute(params) {
        try {
            const { pattern, path: searchPath } = params;

            // Validate required parameters
            if (!pattern) {
                throw new Error('Missing required parameter: pattern');
            }

            // Use current working directory if no path specified
            const cwd = searchPath || process.cwd();

            // Check if search directory exists
            if (!fs.existsSync(cwd)) {
                throw new Error(`Directory does not exist: ${cwd}`);
            }

            // Perform glob search
            const matches = await glob(pattern, {
                cwd,
                absolute: true,
                dot: false, // Don't match hidden files by default
                ignore: ['node_modules/**', '.git/**', '**/.DS_Store'] // Common ignore patterns
            });

            // Sort by modification time (newest first)
            const filesWithStats = await Promise.all(
                matches.map(async (filePath) => {
                    try {
                        const stats = fs.statSync(filePath);
                        return {
                            path: filePath,
                            relativePath: path.relative(cwd, filePath),
                            size: stats.size,
                            modified: stats.mtime,
                            isDirectory: stats.isDirectory()
                        };
                    } catch (error) {
                        // File might have been deleted between glob and stat
                        return null;
                    }
                })
            );

            // Filter out null entries and sort by modification time
            const sortedFiles = filesWithStats
                .filter(file => file !== null)
                .sort((a, b) => b.modified - a.modified);

            return {
                success: true,
                message: `Found ${sortedFiles.length} matches for pattern "${pattern}"`,
                pattern,
                searchPath: cwd,
                matches: sortedFiles.length,
                files: sortedFiles
            };

        } catch (error) {
            return {
                success: false,
                message: `## Glob Tool Error ##\n**Error:** ${error.message}`
            };
        }
    }
}

export default GlobTool;
