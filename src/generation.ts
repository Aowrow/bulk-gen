import type {
  AspectRatio,
  GeneratedImage,
  ProviderConfig,
  Resolution,
  StoryboardPayload,
  UploadedImage
} from './types';
import {
  composeRequestPrompt,
  createErrorResult,
  generateId,
  mapAspectRatioToOpenAI,
  mapResolutionToOpenAIQuality,
  normalizeErrorMessage
} from './utils';

interface GenerateOptions {
  prompts: string[];
  payload: StoryboardPayload;
  referenceImages: UploadedImage[];
  providerConfig: ProviderConfig;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  signal: AbortSignal;
  onProgress: (completed: number, total: number) => void;
}

function buildGeminiEndpoint(baseUrl: string, modelName: string): string {
  let normalized = baseUrl.trim();
  if (!normalized) {
    normalized = 'https://generativelanguage.googleapis.com/v1beta';
  }

  normalized = normalized.replace(/\/+$/, '');

  if (normalized.includes(':generateContent')) {
    return normalized;
  }

  if (/\/models\/[^/]+$/.test(normalized)) {
    return `${normalized}:generateContent`;
  }

  if (/\/v1beta$|\/v1$/.test(normalized)) {
    return `${normalized}/models/${modelName}:generateContent`;
  }

  return `${normalized}/v1beta/models/${modelName}:generateContent`;
}

async function generateSingleWithGemini(
  prompt: string,
  index: number,
  options: Omit<GenerateOptions, 'prompts' | 'onProgress'>
): Promise<GeneratedImage> {
  const endpoint = buildGeminiEndpoint(options.providerConfig.baseUrl, options.providerConfig.model);
  const requestPrompt = composeRequestPrompt(options.payload, prompt, index);
  const parts: Array<Record<string, unknown>> = [{ text: requestPrompt }];

  for (const image of options.referenceImages) {
    const match = image.data.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      continue;
    }

    parts.push({
      inline_data: {
        mime_type: match[1],
        data: match[2]
      }
    });
  }

  const generationConfig: Record<string, unknown> = {
    imageConfig: {
      imageSize: options.resolution
    }
  };

  if (options.aspectRatio !== 'Auto') {
    (generationConfig.imageConfig as Record<string, unknown>).aspectRatio = options.aspectRatio;
  }

  const response = await fetch(`${endpoint}?key=${encodeURIComponent(options.providerConfig.apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.providerConfig.apiKey}`,
      'x-goog-api-key': options.providerConfig.apiKey
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig
    }),
    signal: options.signal
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Gemini 请求失败（${response.status}）：${errorText || response.statusText}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { mimeType?: string; data?: string };
          inline_data?: { mime_type?: string; data?: string };
          text?: string;
        }>;
      };
    }>;
  };

  const partsFromResponse = data.candidates?.[0]?.content?.parts ?? [];
  for (const part of partsFromResponse) {
    const inlineData = part.inlineData;
    const inlineDataSnake = part.inline_data;
    const imageData = inlineData?.data ?? inlineDataSnake?.data;

    if (imageData) {
      const mimeType = inlineData?.mimeType ?? inlineDataSnake?.mime_type ?? 'image/png';
      return {
        id: generateId(),
        prompt,
        data: `data:${mimeType};base64,${imageData}`,
        mimeType,
        status: 'success'
      };
    }
  }

  throw new Error('Gemini 未返回图片数据。');
}

async function generateSingleWithOpenAI(
  prompt: string,
  index: number,
  options: Omit<GenerateOptions, 'prompts' | 'onProgress'>
): Promise<GeneratedImage> {
  if (options.referenceImages.length > 0) {
    throw new Error('当前 OpenAI 模式未实现参考图输入，请改用 Gemini 提供商。');
  }

  const baseUrl = options.providerConfig.baseUrl.trim() || 'https://api.openai.com/v1';
  const requestPrompt = composeRequestPrompt(options.payload, prompt, index);
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.providerConfig.apiKey}`
    },
    body: JSON.stringify({
      model: options.providerConfig.model || 'gpt-image-1',
      prompt: requestPrompt,
      n: 1,
      size: mapAspectRatioToOpenAI(options.aspectRatio),
      quality: mapResolutionToOpenAIQuality(options.resolution),
      response_format: 'b64_json'
    }),
    signal: options.signal
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OpenAI 请求失败（${response.status}）：${errorText || response.statusText}`);
  }

  const data = (await response.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
  };
  const first = data.data?.[0];
  if (!first) {
    throw new Error('OpenAI 未返回图片结果。');
  }

  if (first.b64_json) {
    return {
      id: generateId(),
      prompt,
      data: `data:image/png;base64,${first.b64_json}`,
      mimeType: 'image/png',
      status: 'success'
    };
  }

  if (first.url) {
    return {
      id: generateId(),
      prompt,
      data: first.url,
      mimeType: 'image/png',
      status: 'success'
    };
  }

  throw new Error('OpenAI 返回的数据格式无法识别。');
}

export async function generateImages(options: GenerateOptions): Promise<GeneratedImage[]> {
  const results: GeneratedImage[] = [];

  for (const [index, prompt] of options.prompts.entries()) {
    try {
      const image =
        options.providerConfig.provider === 'gemini'
          ? await generateSingleWithGemini(prompt, index, options)
          : await generateSingleWithOpenAI(prompt, index, options);
      results.push(image);
    } catch (error) {
      results.push(createErrorResult(prompt, normalizeErrorMessage(error)));
    }

    options.onProgress(index + 1, options.prompts.length);
  }

  return results;
}
