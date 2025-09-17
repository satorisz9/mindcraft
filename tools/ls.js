import fs from 'fs';
import path from 'path';
import { minimatch } from 'minimatch';

/**
 * LS Tool - Lists directory contents with detailed metadata
 */
export class LSTool {
    constructor(agent = null) {
        this.name = 'LS';
        this.agent = agent;
        this.description = "Lists files and directories in a given path. The path parameter must be an absolute path, not a relative path. You can optionally provide an array of glob patterns to ignore with the ignore parameter. You should generally prefer the Glob and Grep tools, if you know which directories to search.";
        this.input_schema = {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The absolute path to the directory to list (must be absolute, not relative)"
                },
                "ignore": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    },
                    "description": "List of glob patterns to ignore"
                }
            },
            "required": ["path"],
            "additionalProperties": false,
            "$schema": "http://json-schema.org/draft-07/schema#"
        };
    }

    /**
     * Execute the ls operation
     * @param {Object} params - The ls parameters
     * @param {string} params.path - Absolute path to the directory
     * @param {Array} params.ignore - Array of glob patterns to ignore
     * @returns {Object} Result object
     */
    async execute(params) {
        try {
            const { path: dirPath, ignore = [] } = params;

            // Validate required parameters
            if (!dirPath) {
                throw new Error('Missing required parameter: path');
            }

            // Check if directory exists
            if (!fs.existsSync(dirPath)) {
                throw new Error(`Directory does not exist: ${dirPath}`);
            }

            // Check if it's actually a directory
            const stats = fs.statSync(dirPath);
            if (!stats.isDirectory()) {
                throw new Error(`Path is not a directory: ${dirPath}`);
            }

            // Read directory contents
            const entries = fs.readdirSync(dirPath);
            const results = [];

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry);
                
                // Check if entry should be ignored
                if (this.shouldIgnore(entry, ignore)) {
                    continue;
                }

                try {
                    const entryStats = fs.statSync(fullPath);
                    const isDirectory = entryStats.isDirectory();
                    
                    let size;
                    if (isDirectory) {
                        // For directories, count items recursively
                        size = this.countDirectoryItems(fullPath);
                    } else {
                        size = entryStats.size;
                    }

                    results.push({
                        name: entry,
                        path: fullPath,
                        relativePath: entry,
                        type: isDirectory ? 'directory' : 'file',
                        size,
                        modified: entryStats.mtime,
                        permissions: this.getPermissions(entryStats.mode)
                    });
                } catch (error) {
                    // Skip entries that can't be accessed
                    continue;
                }
            }

            // Sort: directories first, then files, both alphabetically
            results.sort((a, b) => {
                if (a.type !== b.type) {
                    return a.type === 'directory' ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });

            return {
                success: true,
                message: `Listed ${results.length} items in ${path.basename(dirPath)}`,
                path: dirPath,
                totalItems: results.length,
                directories: results.filter(item => item.type === 'directory').length,
                files: results.filter(item => item.type === 'file').length,
                items: results
            };

        } catch (error) {
            return {
                success: false,
                message: `## List Tool Error ##\n**Error:** ${error.message}`
            };
        }
    }

    /**
     * Check if an entry should be ignored based on glob patterns
     * @param {string} entry - Entry name
     * @param {Array} ignorePatterns - Array of glob patterns
     * @returns {boolean} True if should be ignored
     */
    shouldIgnore(entry, ignorePatterns) {
        for (const pattern of ignorePatterns) {
            if (minimatch(entry, pattern)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Count items in a directory recursively
     * @param {string} dirPath - Directory path
     * @returns {number} Number of items
     */
    countDirectoryItems(dirPath) {
        try {
            const entries = fs.readdirSync(dirPath);
            let count = entries.length;
            
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry);
                try {
                    const stats = fs.statSync(fullPath);
                    if (stats.isDirectory()) {
                        count += this.countDirectoryItems(fullPath);
                    }
                } catch (error) {
                    // Skip inaccessible entries
                    continue;
                }
            }
            
            return count;
        } catch (error) {
            return 0;
        }
    }

    /**
     * Get human-readable permissions string
     * @param {number} mode - File mode
     * @returns {string} Permissions string
     */
    getPermissions(mode) {
        const permissions = [];
        
        // Owner permissions
        permissions.push((mode & 0o400) ? 'r' : '-');
        permissions.push((mode & 0o200) ? 'w' : '-');
        permissions.push((mode & 0o100) ? 'x' : '-');
        
        // Group permissions
        permissions.push((mode & 0o040) ? 'r' : '-');
        permissions.push((mode & 0o020) ? 'w' : '-');
        permissions.push((mode & 0o010) ? 'x' : '-');
        
        // Other permissions
        permissions.push((mode & 0o004) ? 'r' : '-');
        permissions.push((mode & 0o002) ? 'w' : '-');
        permissions.push((mode & 0o001) ? 'x' : '-');
        
        return permissions.join('');
    }
}

export default LSTool;
