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
