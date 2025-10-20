import { getKey } from '../utils/keys.js';

export class Hyperbolic {
    static prefix = 'hyperbolic';
    constructor(modelName, apiUrl) {
        this.modelName = modelName || "deepseek-ai/DeepSeek-V3";
        this.apiUrl = apiUrl || "https://api.hyperbolic.xyz/v1/chat/completions";

        // Retrieve the Hyperbolic API key from keys.js
        this.apiKey = getKey('HYPERBOLIC_API_KEY');
        if (!this.apiKey) {
            throw new Error('HYPERBOLIC_API_KEY not found. Check your keys.js file.');
        }
    }

    /**
     * Sends a chat completion request to the Hyperbolic endpoint.
     *
     * @param {Array} turns - An array of message objects, e.g. [{role: 'user', content: 'Hi'}].
     * @param {string} systemMessage - The system prompt or instruction.
     * @param {string} stopSeq - A stopping sequence, default '<|EOT|>'.
     * @returns {Promise<string>} - The model's reply.
     */
    async sendRequest(turns, systemMessage, stopSeq = '<|EOT|>', tools=null) {
        const messages = [{ role: 'system', content: systemMessage }, ...turns];

        const payload = {
            model: this.modelName,
            messages: messages,
            max_tokens: 8192,
            temperature: 0.7,
            top_p: 0.9,
            stream: false
        };

        if (tools && Array.isArray(tools) && tools.length > 0) {
            console.log(`Using native tool calling with ${tools.length} tools`);
            payload.tools = tools;
            payload.tool_choice = 'required';
        }

        const maxAttempts = 5;
        let attempt = 0;
        let finalRes = null;

        while (attempt < maxAttempts) {
            attempt++;
            const logMessage = tools 
                ? `Awaiting Hyperbolic API response with native tool calling (${tools.length} tools)... (attempt: ${attempt})`
                : `Awaiting Hyperbolic API response... (attempt: ${attempt})`;
            console.log(logMessage);

            let completionContent = null;

            try {
                const response = await fetch(this.apiUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const data = await response.json();
                if (data?.choices?.[0]?.finish_reason === 'length') {
                    throw new Error('Context length exceeded');
                }

                const message = data?.choices?.[0]?.message;
                if (message?.tool_calls && message.tool_calls.length > 0) {
                    console.log(`Received ${message.tool_calls.length} tool call(s) from API`);
                    return JSON.stringify({
                        _native_tool_calls: true,
                        tool_calls: message.tool_calls
                    });
                }

                completionContent = message?.content || '';
                console.log('Received response from Hyperbolic.');
            } catch (err) {
                if (
                    (err.message === 'Context length exceeded' || err.code === 'context_length_exceeded') &&
                    turns.length > 1
                ) {
                    console.log('Context length exceeded, trying again with a shorter context...');
                    return await this.sendRequest(turns.slice(1), systemMessage, stopSeq, tools);
                } else {
                    console.error(err);
                    completionContent = 'My brain disconnected, try again.';
                }
            }

            // Check for <think> blocks
            const hasOpenTag = completionContent.includes("<think>");
            const hasCloseTag = completionContent.includes("</think>");

            if ((hasOpenTag && !hasCloseTag)) {
                console.warn("Partial <think> block detected. Re-generating...");
                continue;
            }

            if (hasCloseTag && !hasOpenTag) {
                completionContent = '<think>' + completionContent;
            }

            if (hasOpenTag && hasCloseTag) {
                completionContent = completionContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            }

            finalRes = completionContent.replace(/<\|separator\|>/g, '*no response*');
            break;
        }

        if (finalRes == null) {
            console.warn("Could not get a valid <think> block or normal response after max attempts.");
            finalRes = 'I thought too hard, sorry, try again.';
        }
        return finalRes;
    }

    async embed(text) {
        throw new Error('Embeddings are not supported by Hyperbolic.');
    }
}
