import fs from 'fs';
import path from 'path';

export class WriteTool {
    constructor(agent = null) {
        this.name = 'Write';
        this.agent = agent;
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
            
            if (!file_path || content === undefined) {
                throw new Error('[Write Tool] Missing required parameters: file_path, content');
            }
            const fileExists = fs.existsSync(file_path);
            
            const dir = path.dirname(file_path);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

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
                message: `## Write Tool Error ##\n**Error:** ${error.message}`,
                file_path: params.file_path
            };
        }
    }

}

export default WriteTool;
