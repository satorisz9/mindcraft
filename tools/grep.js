import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import process from 'process';

/**
 * Grep Tool - Powerful regex-based content searching using ripgrep
 */
export class GrepTool {
    constructor(agent = null) {
        this.name = 'Grep';
        this.agent = agent;
        this.description = "A powerful search tool built on ripgrep\n\n  Usage:\n  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.\n  - Supports full regex syntax (e.g., \"log.*Error\", \"function\\s+\\w+\")\n  - Filter files with glob parameter (e.g., \"*.js\", \"**/*.tsx\") or type parameter (e.g., \"js\", \"py\", \"rust\")\n  - Output modes: \"content\" shows matching lines, \"files_with_matches\" shows only file paths (default), \"count\" shows match counts\n  - Use Task tool for open-ended searches requiring multiple rounds\n  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\\{\\}` to find `interface{}` in Go code)\n  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \\{[\\s\\S]*?field`, use `multiline: true`\n";
        this.input_schema = {
            "type": "object",
            "properties": {
                "pattern": {
                    "type": "string",
                    "description": "The regular expression pattern to search for in file contents"
                },
                "path": {
                    "type": "string",
                    "description": "File or directory to search in (rg PATH). Defaults to current working directory."
                },
                "glob": {
                    "type": "string",
                    "description": "Glob pattern to filter files (e.g. \"*.js\", \"*.{ts,tsx}\") - maps to rg --glob"
                },
                "output_mode": {
                    "type": "string",
                    "enum": ["content", "files_with_matches", "count"],
                    "description": "Output mode: \"content\" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), \"files_with_matches\" shows file paths (supports head_limit), \"count\" shows match counts (supports head_limit). Defaults to \"files_with_matches\"."
                },
                "-B": {
                    "type": "number",
                    "description": "Number of lines to show before each match (rg -B). Requires output_mode: \"content\", ignored otherwise."
                },
                "-A": {
                    "type": "number",
                    "description": "Number of lines to show after each match (rg -A). Requires output_mode: \"content\", ignored otherwise."
                },
                "-C": {
                    "type": "number",
                    "description": "Number of lines to show before and after each match (rg -C). Requires output_mode: \"content\", ignored otherwise."
                },
                "-n": {
                    "type": "boolean",
                    "description": "Show line numbers in output (rg -n). Requires output_mode: \"content\", ignored otherwise."
                },
                "-i": {
                    "type": "boolean",
                    "description": "Case insensitive search (rg -i)"
                },
                "type": {
                    "type": "string",
                    "description": "File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types."
                },
                "head_limit": {
                    "type": "number",
                    "description": "Limit output to first N lines/entries, equivalent to \"| head -N\". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). When unspecified, shows all results from ripgrep."
                },
                "multiline": {
                    "type": "boolean",
                    "description": "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false."
                }
            },
            "required": ["pattern"],
            "additionalProperties": false,
            "$schema": "http://json-schema.org/draft-07/schema#"
        };
    }

    /**
     * Execute the grep search
     * @param {Object} params - The grep parameters
     * @returns {Object} Result object
     */
    async execute(params) {
        try {
            const {
                pattern,
                path: searchPath = process.cwd(),
                glob: globPattern,
                output_mode = 'files_with_matches',
                type,
                head_limit,
                multiline = false,
                '-B': beforeContext,
                '-A': afterContext,
                '-C': context,
                '-n': showLineNumbers = false,
                '-i': caseInsensitive = false
            } = params;

            // Validate required parameters
            if (!pattern) {
                throw new Error('Missing required parameter: pattern');
            }

            // Check if search path exists
            if (!fs.existsSync(searchPath)) {
                throw new Error(`Path does not exist: ${searchPath}`);
            }

            // Build ripgrep command
            const args = [];

            // Basic pattern
            args.push(pattern);

            // Case insensitive
            if (caseInsensitive) {
                args.push('-i');
            }

            // Multiline mode
            if (multiline) {
                args.push('-U', '--multiline-dotall');
            }

            // Output mode
            switch (output_mode) {
                case 'files_with_matches':
                    args.push('-l');
                    break;
                case 'count':
                    args.push('-c');
                    break;
                case 'content':
                    // Default behavior, add context and line numbers if specified
                    if (showLineNumbers) {
                        args.push('-n');
                    }
                    if (context !== undefined) {
                        args.push('-C', context.toString());
                    } else {
                        if (beforeContext !== undefined) {
                            args.push('-B', beforeContext.toString());
                        }
                        if (afterContext !== undefined) {
                            args.push('-A', afterContext.toString());
                        }
                    }
                    break;
            }

            // File type filter
            if (type) {
                args.push('--type', type);
            }

            // Glob pattern
            if (globPattern) {
                args.push('--glob', globPattern);
            }

            // Search path
            args.push(searchPath);

            // Execute ripgrep
            const result = await this.executeRipgrep(args);

            let output = result.stdout;

            // Apply head limit if specified
            if (head_limit && output) {
                const lines = output.split('\n');
                output = lines.slice(0, head_limit).join('\n');
            }

            const matches = output ? output.split('\n').filter(line => line.trim()).length : 0;

            return {
                success: true,
                message: `Found ${matches} matches for pattern "${pattern}"`,
                pattern,
                searchPath,
                output_mode,
                matches,
                output: output || 'No matches found'
            };

        } catch (error) {
            return {
                success: false,
                message: `## Grep Tool Error ##\n**Error:** ${error.message}`
            };
        }
    }

    /**
     * Execute ripgrep command
     * @param {Array} args - Command arguments
     * @returns {Promise<Object>} Command result
     */
    executeRipgrep(args) {
        return new Promise((resolve, reject) => {
            const rg = spawn('rg', args, {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            rg.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            rg.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            rg.on('close', (code) => {
                // ripgrep returns 1 when no matches found, which is not an error
                if (code === 0 || code === 1) {
                    resolve({ stdout, stderr, code });
                } else {
                    reject(new Error(`ripgrep failed with code ${code}: ${stderr}`));
                }
            });

            rg.on('error', (error) => {
                if (error.code === 'ENOENT') {
                    reject(new Error('ripgrep (rg) is not installed. Please install ripgrep first.'));
                } else {
                    reject(error);
                }
            });
        });
    }
}

export default GrepTool;
