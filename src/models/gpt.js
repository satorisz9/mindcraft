import OpenAIApi from 'openai';
import { getKey, hasKey } from '../utils/keys.js';
import { strictFormat } from '../utils/text.js';

export class GPT {
    static prefix = 'openai';
    
    constructor(model_name, url, params) {
        this.model_name = model_name;
        this.params = params;
        this.url = url; // store so that we know whether a custom URL has been set
        
        let config = {};
        if (url)
            config.baseURL = url;

        if (hasKey('OPENAI_ORG_ID'))
            config.organization = getKey('OPENAI_ORG_ID');

        config.apiKey = getKey('OPENAI_API_KEY');

        this.openai = new OpenAIApi(config);
    }

    async sendRequest(turns, systemMessage, stop_seq='<|EOT|>', tools=null) {
        let model = this.model_name || "gpt-4o-mini";
        let res = null;

        try {
            // if a custom URL is set, use chat.completions
            // because custom "OpenAI-compatible" endpoints likely do not have responses endpoint
            if (this.url) {
                let messages = [{'role': 'system', 'content': systemMessage}].concat(turns);
                messages = strictFormat(messages);
                
                const pack = {
                    model: model,
                    messages,
                    ...(this.params || {})
                };
                
                // Handle tool calling
                if (tools && Array.isArray(tools) && tools.length > 0) {
                    console.log(`Using native tool calling with ${tools.length} tools`);
                    pack.tools = tools;
                    pack.tool_choice = 'required';
                } else if (stop_seq) {
                    pack.stop = Array.isArray(stop_seq) ? stop_seq : [stop_seq];
                }
                
                // o1, o3, and 5 series models don't support stop parameter
                if (model.includes('o1') || model.includes('o3') || model.includes('5')) {
                    delete pack.stop;
                }
                
                const logMessage = tools 
                    ? `Awaiting openai api response with native tool calling (${tools.length} tools) from model ${model}`
                    : `Awaiting openai api response from model ${model}`;
                console.log(logMessage);
                
                const completion = await this.openai.chat.completions.create(pack);
                
                if (!completion?.choices?.[0]) {
                    console.error('No completion or choices returned:', completion);
                    return 'No response received.';
                }
                
                if (completion.choices[0].finish_reason == 'length')
                    throw new Error('Context length exceeded');
                
                console.log('Received.');
                
                const message = completion.choices[0].message;
                
                // Handle tool calls response
                if (message.tool_calls && message.tool_calls.length > 0) {
                    console.log(`Received ${message.tool_calls.length} tool call(s) from API`);
                    return JSON.stringify({
                        _native_tool_calls: true,
                        tool_calls: message.tool_calls
                    });
                }
                
                res = message.content;
            } 
            // otherwise, use responses API
            else {
                console.log('Awaiting openai api response from model', model);
                
                let messages = strictFormat(turns);
                messages = messages.map(message => {
                    message.content += stop_seq;
                    return message;
                });
                
                const response = await this.openai.responses.create({
                    model: model,
                    instructions: systemMessage,
                    input: messages,
                    ...(this.params || {})
                });
                
                console.log('Received.');
                res = response.output_text;
                
                // Remove stop sequence from response
                let stop_seq_index = res.indexOf(stop_seq);
                res = stop_seq_index !== -1 ? res.slice(0, stop_seq_index) : res;
            }
        }
        catch (err) {
            if ((err.message == 'Context length exceeded' || err.code == 'context_length_exceeded') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                return await this.sendRequest(turns.slice(1), systemMessage, stop_seq, tools);
            } else if (err.message.includes('image_url')) {
                console.log(err);
                res = 'Vision is only supported by certain models.';
            } else {
                console.log(err);
                res = 'My brain disconnected, try again.';
            }
        }
        
        return res;
    }

    async sendVisionRequest(messages, systemMessage, imageBuffer) {
        const imageMessages = [...messages];
        imageMessages.push({
            role: "user",
            content: [
                { type: "input_text", text: systemMessage },
                {
                    type: "input_image",
                    image_url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                }
            ]
        });
        
        return this.sendRequest(imageMessages, systemMessage);
    }

    async embed(text) {
        if (text.length > 8191)
            text = text.slice(0, 8191);
            
        const embedding = await this.openai.embeddings.create({
            model: this.model_name || "text-embedding-3-small",
            input: text,
            encoding_format: "float",
        });
        
        return embedding.data[0].embedding;
    }
}

const sendAudioRequest = async (text, model, voice, url) => {
    const payload = {
        model: model,
        voice: voice,
        input: text
    };

    let config = {};

    if (url)
        config.baseURL = url;

    if (hasKey('OPENAI_ORG_ID'))
        config.organization = getKey('OPENAI_ORG_ID');

    config.apiKey = getKey('OPENAI_API_KEY');

    const openai = new OpenAIApi(config);

    const mp3 = await openai.audio.speech.create(payload);
    const buffer = Buffer.from(await mp3.arrayBuffer());
    const base64 = buffer.toString("base64");
    
    return base64;
};

export const TTSConfig = {
    sendAudioRequest: sendAudioRequest,
    baseUrl: 'https://api.openai.com/v1',
};
