import { Mistral as MistralClient } from '@mistralai/mistralai';
import { getKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';

export class Mistral {
    static prefix = 'mistral';
    #client;

    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.params = params;

        if (typeof url === "string") {
            console.warn("Mistral does not support custom URL's, ignoring!");

        }

        if (!getKey("MISTRAL_API_KEY")) {
            throw new Error("Mistral API Key missing, make sure to set MISTRAL_API_KEY in settings.json")
        }

        this.#client = new MistralClient(
            {
                apiKey: getKey("MISTRAL_API_KEY")
            }
        );

        
        // Prevents the following code from running when model not specified
        if (typeof this.model_name === "undefined") return;

        // get the model name without the "mistral" or "mistralai" prefix
        // e.g "mistral/mistral-large-latest" -> "mistral-large-latest"
        if (typeof model_name.split("/")[1] !== "undefined") {
            this.model_name = model_name.split("/")[1];
        }
    }

    async sendRequest(turns, systemMessage, stop_seq='<|EOT|>', tools=null) {
        try {
            const model = this.model_name || "mistral-large-latest";

            const messages = [
                { role: "system", content: systemMessage }
            ];
            messages.push(...strictFormat(turns));

            const requestConfig = {
                model,
                messages,
                ...(this.params || {})
            };

            if (tools && Array.isArray(tools) && tools.length > 0) {
                // Tools are already in correct format from ToolManager: { type: "function", function: {...} }
                requestConfig.tools = tools;
                // Force tool usage - 'any' requires at least one tool call per response
                requestConfig.tool_choice = 'any';
            }

            const logMessage = tools 
                ? `Awaiting mistral api response with native tool calling (${tools.length} tools)...`
                : 'Awaiting mistral api response...';
            console.log(logMessage);

            const response = await this.#client.chat.complete(requestConfig);

            const message = response.choices[0].message;
            if (message.toolCalls && message.toolCalls.length > 0) {
                return JSON.stringify({
                    _native_tool_calls: true,
                    tool_calls: message.toolCalls
                });
            }

            return message.content;
        } catch (err) {
            if (err.message.includes("A request containing images has been given to a model which does not have the 'vision' capability.")) {
                return "Vision is only supported by certain models.";
            }
            console.log(err);
            return "My brain disconnected, try again.";
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
                    imageUrl: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                }
            ]
        });
        
        return this.sendRequest(imageMessages, systemMessage);
    }

    async embed(text) {
        const embedding = await this.#client.embeddings.create({
            model: "mistral-embed",
            inputs: text
        });
        return embedding.data[0].embedding;
    }
}