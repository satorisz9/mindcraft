import { sleep } from 'groq-sdk/core.mjs';
import { ToolManager } from './tools/toolManager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class Coder {
    constructor(agent) {
        this.agent = agent;
        this.codeToolsManager = new ToolManager(agent);
    }

    async generateCode(agent_history) {
        console.log('### Generating code...');
        this.agent.bot.modes.pause('unstuck');
        // this message history is transient and only maintained in this function
        let messages = agent_history.getHistory();

        const MAX_ATTEMPTS = 100000;

        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            // if (this.agent.bot.interrupt_code) return null;

            try {
                const response = await this.agent.prompter.promptCoding(messages);
                if(response.includes('Range of input length should be')){
                    continue;
                }
                messages.push({
                    role: 'assistant',
                    content: response
                });
                console.log('Response:', response);
                
                // Check if response is in JSON tool format
                if (!this.codeToolsManager.parseJSONTools(response).hasTools) {
                    console.log('Response is not in JSON tool format. Please use JSON tool command format.');
                    await sleep(1000);
                    messages.push({
                        role: 'user',
                        content: 'Response is not in JSON tool format. Please use JSON tool command format as described above.'
                    });

                    continue;
                }
    
                // Process JSON tool commands
                const toolResult = await this.codeToolsManager.processResponse(response);
 
                // Build feedback for tool execution results
                let toolResultFeedback = '';
                
                if (!toolResult.success) {
                    console.log('\x1b[31mJSON tool execution failed: ' + toolResult.message + '\x1b[0m');
                    toolResultFeedback = `##JSON tool execution failed##\nPlease check command format and parameters.\n${toolResult.message}`;
                } else {
                    console.log('\x1b[32mJSON tool execution succeeded: ' + toolResult.message + '\x1b[0m');
                    toolResultFeedback = `##JSON tool execution succeeded##\n${toolResult.message}`;
                }
                
                // If there are specific tool results, add detailed information
                if (toolResult.results && toolResult.results.length > 0) {
                    toolResultFeedback += '\n\nDetailed tool results:';
                    toolResult.results.forEach((result, index) => {
                        toolResultFeedback += `\n- Tool ${index + 1} (${result.tool}): `;
                            
                        toolResultFeedback += result.message;
                         
                    });
                }
                
                messages.push({
                    role: 'user',
                    content: toolResultFeedback
                });
                console.log("\x1b[32m==================:\x1b[0m");
                // Display the last 4 messages
                const lastMessages = messages.slice(-4);
                lastMessages.forEach((msg, index) => {
                    console.log(`\x1b[32mMessage ${index + 1} (${msg.role}):\x1b[0m`);
                    // Process escape characters to make the content easier to read
                    let content = msg.content;
                    if (typeof content === 'string') {
                        // Create a regular expression for ANSI escape sequences
                        const ansiEscape = String.fromCharCode(27) + '\\[[0-9]+m';
                        const ansiRegex = new RegExp(ansiEscape, 'g');
                        
                        content = content
                            .replace(/\\n/g, '\n')  // Convert \\n to actual newline
                            .replace(/\\t/g, '\t')  // Convert \\t to actual tab
                            .replace(/\\"/g, '"')   // Convert \\\" to a quote
                            .replace(ansiRegex, ''); // Remove ANSI color codes
                    }
                    console.log(`\x1b[32m${content}\x1b[0m`);
                    console.log('\x1b[32m---\x1b[0m');
                });
                console.log("\x1b[32m==================\x1b[0m");
                // Generate operation summary for reporting
                const operationSummary = toolResult.operations ? 
                    toolResult.operations.map(op => `${op.tool}: ${op.path}`).join(', ') : 
                    'No operations recorded';
                
                console.log('Tool operations completed successfully');
                console.log(operationSummary);
            } catch (error) {
                messages.push({
                    role: 'user',
                    content: `Code generation error: ${error.message}`
                });
                console.warn(`Security check: Attempt ${i + 1} failed: ${error.message}`);
            }
        }

        return `Code generation failed after ${MAX_ATTEMPTS} attempts.`;
    }


}