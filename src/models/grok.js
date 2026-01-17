import OpenAIApi from 'openai';
import { getKey } from '../utils/keys.js';
import { GPT } from './gpt.js';

// xAI doesn't supply a SDK for their models, but fully supports OpenAI and Anthropic SDKs
export class Grok extends GPT {
    static prefix = 'xai';
    constructor(model_name, url, params) {
        super(model_name, url, params);
    }

    initClient() {
        let config = {};
        config.baseURL = this.url || 'https://api.x.ai/v1';
        config.apiKey = getKey('XAI_API_KEY');
        this.openai = new OpenAIApi(config);
    }

    async sendRequest(turns, systemMessage, stop_seq='<|EOT|>', tools=null) {
        // Grok doesn't support stop parameter, pass null to disable it
        // Official docs: "stop parameters are not supported by reasoning models"
        const res = await super.sendRequest(turns, systemMessage, null, tools);
        
        // If it's a tool calling response, return directly without processing
        if (res.startsWith('{') && res.includes('_native_tool_calls')) {
            return res;
        }
        
        // sometimes outputs special token <|separator|>, just replace it
        return res.replace(/<\|separator\|>/g, '*no response*');
    }

    async embed(text) {
        throw new Error('Embeddings are not supported by Grok.');
    }
}



