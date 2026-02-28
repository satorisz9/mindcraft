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

        // [mindaxis-patch:stateful] Responses API ステートフルセッション
        this.lastResponseId = null;
        this.lastSentCount = 0;
    }

    async sendRequest(turns, systemMessage, stop_seq='***', stateful=false) {
        let messages = strictFormat(turns);
        messages = messages.map(message => {
            message.content += stop_seq;
            return message;
        });
        let model = this.model_name || "gpt-4o-mini";

        let res = null;

        try {
            console.log('Awaiting openai api response from model', model);
            // if a custom URL is set, use chat.completions
            // because custom "OpenAI-compatible" endpoints likely do not have responses endpoint
            if (this.url) {
                let messages = [{'role': 'system', 'content': systemMessage}].concat(turns);
                messages = strictFormat(messages);
                const pack = {
                    model: model,
                    messages,
                    stop: stop_seq,
                    ...(this.params || {})
                };
                if (model.includes('o1') || model.includes('o3') || model.includes('5')) {
                    delete pack.stop;
                }
                let completion = await this.openai.chat.completions.create(pack);
                if (completion.choices[0].finish_reason == 'length')
                    throw new Error('Context length exceeded'); 
                console.log('Received.');
                res = completion.choices[0].message.content;
            } 
            // otherwise, use responses (with stateful session support)
            else {
                let inputTurns = turns;

                // [mindaxis-patch] ステートフル: 履歴はコンテキストに含めない
                if (stateful) {
                    inputTurns = this.lastResponseId
                        ? turns.slice(this.lastSentCount)  // 既存セッション: 差分のみ
                        : turns.slice(-1);                  // 新規セッション: 最新1件のみ
                }

                let messages = strictFormat(inputTurns);
                messages = messages.map(message => {
                    message.content += stop_seq;
                    return message;
                });

                const pack = {
                    model: model,
                    instructions: systemMessage,
                    input: messages,
                    ...(this.params || {})
                };

                // [mindaxis-patch] 前回のレスポンスにチェーン
                if (stateful && this.lastResponseId) {
                    pack.previous_response_id = this.lastResponseId;
                }
                if (stateful) {
                    pack.store = true;
                }

                // [mindaxis-patch] API タイムアウト（120秒）でハングを防止
                const _ac = new AbortController();
                const _tid = setTimeout(() => _ac.abort(), 120_000);
                let response;
                try {
                    response = await this.openai.responses.create(pack, { signal: _ac.signal });
                } finally {
                    clearTimeout(_tid);
                }

                // [mindaxis-patch] レスポンスIDを保存してチェーン
                if (stateful) {
                    // [mindaxis-patch:auto-compact] ターン数が500を超えたらチェーンをリセット
                    const MAX_STATEFUL_TURNS = 500;
                    // リセット後のターン数 = 全体 - リセット時点のオフセット
                    if (!this._resetOffset) this._resetOffset = 0;
                    const effectiveTurns = turns.length - this._resetOffset;
                    if (effectiveTurns > MAX_STATEFUL_TURNS) {
                        console.log(`[mindaxis] Resetting stateful chain (effective turns: ${effectiveTurns} > ${MAX_STATEFUL_TURNS})`);
                        this.lastResponseId = null;
                        this.lastSentCount = 0;
                        this._resetOffset = turns.length;  // 現在のターン数をオフセットとして記録
                    } else {
                        this.lastResponseId = response.id;
                        this.lastSentCount = turns.length;
                    }
                    console.log(`Received (stateful, sent ${messages.length} new, total ${turns.length}, effective ${effectiveTurns}).`);
                } else {
                    console.log('Received.');
                }

                res = response.output_text;
                let stop_seq_index = res.indexOf(stop_seq);
                res = stop_seq_index !== -1 ? res.slice(0, stop_seq_index) : res;
            }
        }
        catch (err) {
            if ((err.message == 'Context length exceeded' || err.code == 'context_length_exceeded') && turns.length > 1) {
                console.log('Context length exceeded, trying again with shorter context.');
                // [mindaxis-patch] stateful chain reset on context overflow
                if (stateful) { this.lastResponseId = null; this.lastSentCount = 0; }
                return await this.sendRequest(turns.slice(1), systemMessage, stop_seq, stateful);
            } else if (err.message.includes('image_url')) {
                console.log(err);
                res = 'Vision is only supported by certain models.';
            } else {
                console.log(err);
                // [mindaxis-patch] stateful chain reset on error
                if (stateful && this.lastResponseId) {
                    console.log('Resetting stateful session due to error.');
                    this.lastResponseId = null;
                    this.lastSentCount = 0;
                }
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
    }

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
}

export const TTSConfig = {
    sendAudioRequest: sendAudioRequest,
    baseUrl: 'https://api.openai.com/v1',
}
