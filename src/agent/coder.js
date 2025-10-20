import { sleep } from 'groq-sdk/core.mjs';
import { ToolManager } from './tools/toolManager.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class Coder {
    constructor(agent) {
        this.agent = agent;
        this.codeToolsManager = new ToolManager(agent);
        this.MAX_ATTEMPTS;
        this.debug = false;
        // Modes to pause during coding to prevent interference
        // this.MODES_TO_PAUSE = ['unstuck', 'item_collecting', 'hunting', 'self_defense', 'self_preservation']; //TODO: remove after test
        this.MODES_TO_PAUSE = ['unstuck', 'item_collecting'];
    }

    async generateCode(agent_history,codingGoal) {
        console.log('### Generating code...'); 
        
        try {
            // this message history is transient and only maintained until the coding session is finished
            let messages = agent_history.getHistory();

            if(this.debug)
                this.MAX_ATTEMPTS = 10000;                
            else
                this.MAX_ATTEMPTS = 100;
            // Pause some automatic modes to prevent interference with code execution
            this.MODES_TO_PAUSE.forEach(mode => this.agent.bot.modes.pause(mode));
            for (let i = 0; i < this.MAX_ATTEMPTS; i++) {
            try {
                if (this.agent.bot.interrupt_code && this.debug == false) 
                    return "Coding session interrupted";

                // Step 1: Get AI response with interrupt check
                const response = await Promise.race([
                    this.agent.prompter.promptCoding(messages, codingGoal),
                    new Promise((_, reject) => {
                        const check = () => {
                            if (this.agent.bot.interrupt_code) {
                                this.agent.bot.pathfinder.stop();
                                // This prevents deadlock when promptCoding is still waiting for AI response
                                this.agent.prompter.awaiting_coding = false;
                                console.log('[Coder] Interrupt detected, reset awaiting_coding flag');
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
                
                // Step 2: Handle no response case
                if (response.includes('//no response')) {
                    this.agent.bot.interrupt_code = true;
                    console.log('Received no response due to concurrent request protection. Waiting...');
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
                    continue;
                }
                // Step 3: Validate Tool format
                if (!this.codeToolsManager.parseJSONTools(response).hasTools) {
                    console.log('Response is not in Tool format. Please use Tool command format.');
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
                this._displayRecentMessages(messages);//TODO: remove after test
                const operationSummary = toolResult.operations 
                    ? toolResult.operations.map(op => `${op.tool}: ${op.path}`).join(', ')
                    : 'No operations recorded';
                console.log('Tool operations completed successfully');
                console.log(operationSummary);

            } catch (error) {
                // Reset awaiting_coding flag in case of error to prevent deadlock
                this.agent.prompter.awaiting_coding = false;
                console.log('[Coder] Error caught, reset awaiting_coding flag');
                
                messages.push({ role: 'user', content: `Code generation error: ${error.message}` });
                console.warn(`Security check: Attempt ${i + 1} failed: ${error.message}`);
                }
            }
            
            return `Code generation failed after ${this.MAX_ATTEMPTS} attempts.`;
            
        } finally {
            this.MODES_TO_PAUSE.forEach(mode => this.agent.bot.modes.unpause(mode));
            this.agent.prompter.awaiting_coding = false;
        }
    }

    /**
     * TODO: Remove after testing
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