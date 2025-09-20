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

    async generateCode(agent_history,codingGoal) {
        console.log('### Generating code...');
        this.agent.bot.modes.pause('unstuck');
        
        // this message history is transient and only maintained until the coding session is finished
        let messages = agent_history.getHistory();
        const MAX_ATTEMPTS = 100;

        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            try {
                if (this.agent.bot.interrupt_code) return 'Interrupted coding session';

                // Step 1: Get AI response with interrupt check
                const response = await Promise.race([
                    this.agent.prompter.promptCoding(messages, codingGoal),
                    new Promise((_, reject) => {
                        const check = () => {
                            if (this.agent.bot.interrupt_code) {
                                this.agent.bot.pathfinder.stop();
                                reject(new Error('Interrupted coding session'));
                            } else {
                                setTimeout(check, 100);
                            }
                        };
                        check();
                    })
                ]);
                if (response.includes('Range of input length should be')) {
                    continue;
                }
                messages.push({ role: 'assistant', content: response });
                console.log('Response:', response);
                
                // Step 2: Validate Tool format
                if (!this.codeToolsManager.parseJSONTools(response).hasTools) {
                    console.log('Response is not in Tool format. Please use Tool command format.');
                    await sleep(1000);
                    messages.push({ role: 'user', content: 'Response is not in Tool format. Please use Tool command format as described above.' });
                    continue;
                }
    
                // Step 3: Execute tools
                const toolResult = await this.codeToolsManager.processResponse(response);

                // Step 4: Build execution feedback
                let toolResultFeedback = toolResult.success 
                    ? `##Tool execution succeeded##\n${toolResult.message}`
                    : `##Tool execution failed##\nPlease check command format and parameters.\n${toolResult.message}`;
                console.log(toolResult.success 
                    ? '\x1b[32mTool execution succeeded: ' + toolResult.message + '\x1b[0m'
                    : '\x1b[31mTool execution failed: ' + toolResult.message + '\x1b[0m');
                
                // Step 5: Process detailed results and check for finish coding
                if (toolResult.results && toolResult.results.length > 0) {
                    toolResultFeedback += '\n\nDetailed tool results:';
                    for (let i = 0; i < toolResult.results.length; i++) {
                        const result = toolResult.results[i];
                        toolResultFeedback += `\n- Tool ${i + 1} (${result.tool}): ${result.message}`;
                        // Check for finish coding and exit immediately
                        if (result.tool === 'FinishCoding' && result.success && result.action === 'finish_coding') {
                            console.log('\x1b[32m### Coding session finished by AI request\x1b[0m');
                            return result.message;
                        }
                    }
                }
                
                // Step 6: Continue coding loop
                messages.push({ role: 'user', content: toolResultFeedback });
                this._displayRecentMessages(messages);
                const operationSummary = toolResult.operations 
                    ? toolResult.operations.map(op => `${op.tool}: ${op.path}`).join(', ')
                    : 'No operations recorded';
                console.log('Tool operations completed successfully');
                console.log(operationSummary);

            } catch (error) {
                messages.push({ role: 'user', content: `Code generation error: ${error.message}` });
                console.warn(`Security check: Attempt ${i + 1} failed: ${error.message}`);
            }
        }
        return `Code generation failed after ${MAX_ATTEMPTS} attempts.`;
    }

    /**
     * Display the last 4 messages from the conversation history
     * @param {Array} messages - The message history array
     */
    _displayRecentMessages(messages) {
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
    }
}