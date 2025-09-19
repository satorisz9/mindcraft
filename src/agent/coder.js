import { sleep } from 'groq-sdk/core.mjs';
import { ToolManager } from '../../tools/toolManager.js';
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
                if (!this.codeToolsManager.isJSONToolResponse(response)) {
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
 
                // 构建工具执行结果反馈
                let toolResultFeedback = '';
                
                if (!toolResult.success) {
                    console.log('\x1b[31mJSON tool execution failed: ' + toolResult.message + '\x1b[0m');
                    toolResultFeedback = `##JSON tool execution failed##\nPlease check command format and parameters.\n${toolResult.message}`;
                } else {
                    console.log('\x1b[32mJSON tool execution succeeded: ' + toolResult.message + '\x1b[0m');
                    toolResultFeedback = `##JSON tool execution succeeded##\n${toolResult.message}`;
                }
                
                // 如果有具体的工具执行结果，添加详细信息
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
                //显示最后4条消息
                const lastMessages = messages.slice(-4);
                lastMessages.forEach((msg, index) => {
                    console.log(`\x1b[32mMessage ${index + 1} (${msg.role}):\x1b[0m`);
                    // 处理转义字符，让内容更易读
                    let content = msg.content;
                    if (typeof content === 'string') {
                        // 创建ANSI转义序列的正则表达式
                        const ansiEscape = String.fromCharCode(27) + '\\[[0-9]+m';
                        const ansiRegex = new RegExp(ansiEscape, 'g');
                        
                        content = content
                            .replace(/\\n/g, '\n')  // 转换 \n 为真正的换行
                            .replace(/\\t/g, '\t')  // 转换 \t 为真正的制表符
                            .replace(/\\"/g, '"')   // 转换 \" 为引号
                            .replace(ansiRegex, ''); // 移除ANSI颜色代码
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