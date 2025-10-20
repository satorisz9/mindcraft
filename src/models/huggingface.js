import { toSinglePrompt } from '../utils/text.js';
import { getKey } from '../utils/keys.js';
import { HfInference } from "@huggingface/inference";

export class HuggingFace {
  static prefix = 'huggingface';
  constructor(model_name, url, params) {
    // Remove 'huggingface/' prefix if present
    this.model_name = model_name.replace('huggingface/', '');
    this.url = url;
    this.params = params;

    if (this.url) {
      console.warn("Hugging Face doesn't support custom urls!");
    }

    this.huggingface = new HfInference(getKey('HUGGINGFACE_API_KEY'));
  }

  async sendRequest(turns, systemMessage, stop_seq = '<|EOT|>', tools=null) {
    const model_name = this.model_name || 'meta-llama/Meta-Llama-3-8B';
    
    // If tools are provided, use non-streaming API for tool calling
    if (tools && Array.isArray(tools) && tools.length > 0) {
      console.log(`Using tool calling with ${tools.length} tools`);
      console.log(`Awaiting Hugging Face API response with tool calling... (model: ${model_name})`);
      
      try {
        const messages = [{ role: "system", content: systemMessage }, ...turns];
        const response = await this.huggingface.chatCompletion({
          model: model_name,
          messages: messages,
          tools: tools,
          tool_choice: 'auto',
          ...(this.params || {})
        });

        const message = response.choices[0].message;
        if (message.tool_calls && message.tool_calls.length > 0) {
          console.log(`Received ${message.tool_calls.length} tool call(s) from API`);
          return JSON.stringify({
            _native_tool_calls: true,
            tool_calls: message.tool_calls
          });
        }

        console.log('Received.');
        return message.content || '';
      } catch (err) {
        console.log(err);
        return 'My brain disconnected, try again.';
      }
    }

    // Original streaming logic for non-tool calls
    const prompt = toSinglePrompt(turns, null, stop_seq);
    const input = systemMessage + "\n" + prompt;
    const maxAttempts = 5;
    let attempt = 0;
    let finalRes = null;

    while (attempt < maxAttempts) {
      attempt++;
      console.log(`Awaiting Hugging Face API response... (model: ${model_name}, attempt: ${attempt})`);
      let res = '';
      try {
        for await (const chunk of this.huggingface.chatCompletionStream({
          model: model_name,
          messages: [{ role: "user", content: input }],
          ...(this.params || {})
        })) {
          res += (chunk.choices[0]?.delta?.content || "");
        }
      } catch (err) {
        console.log(err);
        res = 'My brain disconnected, try again.';
        break;
      }

      const hasOpenTag = res.includes("<think>");
      const hasCloseTag = res.includes("</think>");

      if ((hasOpenTag && !hasCloseTag)) {
        console.warn("Partial <think> block detected. Re-generating...");
        continue;
      }

      if (hasOpenTag && hasCloseTag) {
        res = res.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      }

      finalRes = res;
      break;
    }

    if (finalRes == null) {
      console.warn("Could not get a valid <think> block or normal response after max attempts.");
      finalRes = 'I thought too hard, sorry, try again.';
    }
    console.log('Received.');
    return finalRes;
  }

  async embed(text) {
    throw new Error('Embeddings are not supported by HuggingFace.');
  }
}
