import Anthropic from '@anthropic-ai/sdk';
import { strictFormat } from '../utils/text.js';
import { getKey } from '../utils/keys.js';

export class Claude {
    static prefix = 'anthropic';
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.params = params || {};

        let config = {};
        if (url)
            config.baseURL = url;
        
        config.apiKey = getKey('ANTHROPIC_API_KEY');

        this.anthropic = new Anthropic(config);
    }

    async sendRequest(turns, systemMessage, stop_seq='<|EOT|>', tools=null) {
        const messages = strictFormat(turns);
        
        try {
            const logMessage = tools 
                ? `Awaiting anthropic response with native tool calling (${tools.length} tools) from ${this.model_name}...`
                : `Awaiting anthropic response from ${this.model_name}...`;
            console.log(logMessage);
            
            if (!this.params.max_tokens) {
                if (this.params.thinking?.budget_tokens) {
                    this.params.max_tokens = this.params.thinking.budget_tokens + 1000;
                } else {
                    this.params.max_tokens = 4096;
                }
            }
            
            const requestConfig = {
                model: this.model_name || "claude-sonnet-4-20250514",
                system: systemMessage,
                messages: messages,
                ...(this.params || {})
            };
            
            if (tools && Array.isArray(tools) && tools.length > 0) {
                console.log(`Using native tool calling with ${tools.length} tools`);
                requestConfig.tools = tools.map(tool => ({
                    name: tool.function.name,
                    description: tool.function.description,
                    input_schema: tool.function.parameters
                }));
            }
            
            const resp = await this.anthropic.messages.create(requestConfig);
            console.log('Received.')
            
            // Check for tool use
            const toolUse = resp.content.find(content => content.type === 'tool_use');
            if (toolUse) {
                console.log(`Received tool call from API`);
                const tool_calls = resp.content
                    .filter(item => item.type === 'tool_use')
                    .map((item, index) => ({
                        id: item.id || `call_${Date.now()}_${index}`,
                        type: 'function',
                        function: {
                            name: item.name,
                            arguments: JSON.stringify(item.input || {})
                        }
                    }));
                return JSON.stringify({
                    _native_tool_calls: true,
                    tool_calls
                });
            }
            
            const textContent = resp.content.find(content => content.type === 'text');
            if (textContent) {
                return textContent.text;
            }
            
            console.warn('No text content found in the response.');
            return 'No response from Claude.';
        }
        catch (err) {
            if (err.message.includes("does not support image input")) {
                return "Vision is only supported by certain models.";
            }
            console.log(err);
            return "My brain disconnected, try again.";
        }
    }

    async sendVisionRequest(turns, systemMessage, imageBuffer) {
        const imageMessages = [...turns];
        imageMessages.push({
            role: "user",
            content: [
                {
                    type: "text",
                    text: systemMessage
                },
                {
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: "image/jpeg",
                        data: imageBuffer.toString('base64')
                    }
                }
            ]
        });

        return this.sendRequest(imageMessages, systemMessage);
    }

    async embed(text) {
        throw new Error('Embeddings are not supported by Claude.');
    }
}
