/**
 * FinishCoding Tool - Allows AI to finish the current coding session and return to normal mode
 */
export class FinishCodingTool {
    constructor(agent = null) {
        this.agent = agent;
    }

    /**
     * Execute the FinishCoding tool
     * @param {Object} params - Tool parameters
     * @param {string} params.summary - Summary of what was accomplished during the coding session
     * @returns {Object} Tool execution result
     */
    execute(params) {
        const { summary } = params;

        if (!summary || typeof summary !== 'string' || summary.trim().length === 0) {
            return {
                success: false,
                error: 'Summary parameter is required and must be a non-empty string'
            };
        }

        try {
            console.log('\x1b[36m[FinishCoding]\x1b[0m Coding session finish requested with summary:', summary.trim());
            
            return {
                success: true,
                message: `Coding session will be finished. Summary: ${summary.trim()}`,
                action: 'finish_coding'  // 添加特殊标识
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to finish coding session: ${error.message}`
            };
        }
    }
}
