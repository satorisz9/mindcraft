import OpenAIApi from 'openai';
import { getKey } from '../utils/keys.js';
import { GPT } from './gpt.js';

export class GLHF extends GPT {
    static prefix = 'glhf';
    constructor(model_name, url, params) {
        super(model_name, url, params);
    }

    initClient() {
        const apiKey = getKey('GHLF_API_KEY');
        if (!apiKey) {
            throw new Error('API key not found. Please check keys.json and ensure GHLF_API_KEY is defined.');
        }
        this.openai = new OpenAIApi({
            apiKey,
            baseURL: this.url || "https://glhf.chat/api/openai/v1"
        });
    }

    async sendRequest(turns, systemMessage, stop_seq = '<|EOT|>', tools=null) {
        const maxAttempts = 5;
        let attempt = 0;
        let finalRes = null;

        while (attempt < maxAttempts) {
            attempt++;
            console.log(`Awaiting glhf.chat API response... (attempt: ${attempt})`);
            
            try {
                let res = await super.sendRequest(turns, systemMessage, stop_seq, tools);
                
                // If it's a tool calling response, return directly without processing
                if (res.startsWith('{') && res.includes('_native_tool_calls')) {
                    return res;
                }
                
                // If there's an open <think> tag without a corresponding </think>, retry.
                if (res.includes("<think>") && !res.includes("</think>")) {
                    console.warn("Partial <think> block detected. Re-generating...");
                    continue;
                }
                // If there's a closing </think> tag but no opening <think>, prepend one.
                if (res.includes("</think>") && !res.includes("<think>")) {
                    res = "<think>" + res;
                }
                finalRes = res.replace(/<\|separator\|>/g, '*no response*');
                break;
            } catch (err) {
                if ((err.message === 'Context length exceeded' || err.code === 'context_length_exceeded') && turns.length > 1) {
                    console.log('Context length exceeded, trying again with shorter context.');
                    return await this.sendRequest(turns.slice(1), systemMessage, stop_seq, tools);
                } else {
                    console.error(err);
                    finalRes = 'My brain disconnected, try again.';
                    break;
                }
            }
        }
        if (finalRes === null) {
            finalRes = "I thought too hard, sorry, try again";
        }
        return finalRes;
    }

    async embed(text) {
        throw new Error('Embeddings are not supported by glhf.');
    }
}
