import CerebrasSDK from '@cerebras/cerebras_cloud_sdk';
import { strictFormat } from '../utils/text.js';
import { getKey } from '../utils/keys.js';

export class Cerebras {
    static prefix = 'cerebras';
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.url = url;
        this.params = params;

        // Initialize client with API key
        this.client = new CerebrasSDK({ apiKey: getKey('CEREBRAS_API_KEY') });
    }

    async sendRequest(turns, systemMessage, stop_seq = '<|EOT|>', tools=null) {
        const messages = strictFormat(turns);
        messages.unshift({ role: 'system', content: systemMessage });

        const pack = {
            model: this.model_name || 'gpt-oss-120b',
            messages,
            stream: false,
            ...(this.params || {}),
        };

        if (tools && Array.isArray(tools) && tools.length > 0) {
            console.log(`Using native tool calling with ${tools.length} tools`);
            pack.tools = tools;
            pack.tool_choice = 'required';
        }

        try {
            const logMessage = tools 
                ? `Awaiting Cerebras API response with native tool calling (${tools.length} tools)...`
                : 'Awaiting Cerebras API response...';
            console.log(logMessage);

            const completion = await this.client.chat.completions.create(pack);
            
            if (!completion?.choices?.[0]) {
                console.error('No completion or choices returned');
                return 'No response received.';
            }

            const message = completion.choices[0].message;
            if (message.tool_calls && message.tool_calls.length > 0) {
                console.log(`Received ${message.tool_calls.length} tool call(s) from API`);
                return JSON.stringify({
                    _native_tool_calls: true,
                    tool_calls: message.tool_calls
                });
            }

            return message.content || '';
        } catch (err) {
            console.error('Cerebras API error:', err);
            return 'My brain disconnected, try again.';
        }
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        const imageMessages = [...messages];
        imageMessages.push({
            role: "user",
            content: [
                { type: "text", text: systemMessage },
                {
                    type: "image_url",
                    image_url: {
                        url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                    }
                }
            ]
        });
        
        return this.sendRequest(imageMessages, systemMessage);
    }
    
    async embed(text) {
        throw new Error('Embeddings are not supported by Cerebras.');
    }
}
