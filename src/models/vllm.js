// This code uses Dashscope and HTTP to ensure the latest support for the Qwen model.
// Qwen is also compatible with the OpenAI API format;

import OpenAIApi from 'openai';
import { GPT } from './gpt.js';

export class VLLM extends GPT {
    static prefix = 'vllm';
    constructor(model_name, url, params) {
        super(model_name, url, params);
    }

    initClient() {
        let vllm_config = {};
        vllm_config.baseURL = this.url || 'http://0.0.0.0:8000/v1';
        vllm_config.apiKey = "";
        this.openai = new OpenAIApi(vllm_config);
    }

    async embed(text) {
        throw new Error('Embeddings are not supported by VLLM. Use OpenAI text-embedding-3-small model for simple embedding.');
    }
}