import Groq from 'groq-sdk'
import { getKey } from '../utils/keys.js';

// THIS API IS NOT TO BE CONFUSED WITH GROK!
// Go to grok.js for that. :)

// Umbrella class for everything under the sun... That GroqCloud provides, that is.
export class GroqCloudAPI {
    static prefix = 'groq';

    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.url = url;
        this.params = params || {};

        if (this.url)
            console.warn("Groq Cloud has no implementation for custom URLs. Ignoring provided URL.");

        this.groq = new Groq({ apiKey: getKey('GROQCLOUD_API_KEY') });
    }

    async sendRequest(turns, systemMessage, stop_seq = null, tools=null) {
        let messages = [{"role": "system", "content": systemMessage}].concat(turns);

        try {
            const logMessage = tools 
                ? `Awaiting Groq response with native tool calling (${tools.length} tools)...`
                : 'Awaiting Groq response...';
            console.log(logMessage);

            // Handle deprecated max_tokens parameter
            if (this.params.max_tokens) {
                console.warn("GROQCLOUD WARNING: A profile is using `max_tokens`. This is deprecated. Please move to `max_completion_tokens`.");
                this.params.max_completion_tokens = this.params.max_tokens;
                delete this.params.max_tokens;
            }

            if (!this.params.max_completion_tokens) {
                this.params.max_completion_tokens = 4000;
            }

            const pack = {
                messages: messages,
                model: this.model_name || "qwen/qwen3-32b",
                stream: false,
                stop: stop_seq,
                ...(this.params || {})
            };

            if (tools && Array.isArray(tools) && tools.length > 0) {
                console.log(`Using native tool calling with ${tools.length} tools`);
                pack.tools = tools;
                pack.tool_choice = 'required';
                delete pack.stop;
            }

            let completion = await this.groq.chat.completions.create(pack);

            if (!completion?.choices?.[0]) {
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

            let res = message.content;
            res = res.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            return res;
        }
        catch(err) {
            if (err.message.includes("content must be a string")) {
                return "Vision is only supported by certain models.";
            }
            console.log(err);
            return "My brain disconnected, try again.";
        }
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        const imageMessages = messages.filter(message => message.role !== 'system');
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
        
        return this.sendRequest(imageMessages);
    }

    async embed(_) {
        throw new Error('Embeddings are not supported by Groq.');
    }
}
