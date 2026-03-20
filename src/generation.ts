import type {
  AspectRatio,
  GeneratedImage,
  Mode,
  ProviderConfig,
  Resolution,
  StoryboardPayload,
  UploadedImage
} from './types';
import {
  composeComboSheetPrompt,
  composeGachaSheetPrompt,
  composeRequestPrompt,
  createErrorResult,
  generateId,
  mapAspectRatioToOpenAI,
  mapResolutionToOpenAIQuality,
  normalizeErrorMessage,
  sliceGridImageData
} from './utils';
import grid1x1_2x2 from '../img/grid_1x1_2x2.png';
import grid1x1_3x3 from '../img/grid_1x1_3x3.png';
import grid3x2_2x2 from '../img/grid_3x2_2x2.png';
import grid3x2_3x3 from '../img/grid_3x2_3x3.png';
import grid2x3_2x2 from '../img/grid_2x3_2x2.png';
import grid2x3_3x3 from '../img/grid_2x3_3x3.png';
import grid4x3_2x2 from '../img/grid_4x3_2x2.png';
import grid4x3_3x3 from '../img/grid_4x3_3x3.png';
import grid3x4_2x2 from '../img/grid_3x4_2x2.png';
import grid3x4_3x3 from '../img/grid_3x4__3x3.png';
import grid16x9_2x2 from '../img/grid_16x9_2x2.png';
import grid16x9_3x3 from '../img/grid_16x9_3x3.png';
import grid9x16_2x2 from '../img/grid_9x16_2x2.png';
import grid9x16_3x3 from '../img/grid_9x16_3x3.png';

interface GenerateOptions {
  mode: Mode;
  gridCount: number;
  prompts: string[];
  payload: StoryboardPayload;
  referenceImages: UploadedImage[];
  providerConfig: ProviderConfig;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  signal: AbortSignal;
  onProgress: (completed: number, total: number) => void;
}

const GRID_TEMPLATE_MAP = {
  '1:1-4': grid1x1_2x2,
  '1:1-9': grid1x1_3x3,
  '3:2-4': grid3x2_2x2,
  '3:2-9': grid3x2_3x3,
  '2:3-4': grid2x3_2x2,
  '2:3-9': grid2x3_3x3,
  '4:3-4': grid4x3_2x2,
  '4:3-9': grid4x3_3x3,
  '3:4-4': grid3x4_2x2,
  '3:4-9': grid3x4_3x3,
  '16:9-4': grid16x9_2x2,
  '16:9-9': grid16x9_3x3,
  '9:16-4': grid9x16_2x2,
  '9:16-9': grid9x16_3x3
} as const;

async function imageUrlToInlineImage(url: string): Promise<UploadedImage> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('模板图加载失败。');
  }

  const blob = await response.blob();
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('模板图读取失败。'));
    };
    reader.onerror = () => reject(new Error('模板图读取失败。'));
    reader.readAsDataURL(blob);
  });

  return {
    id: generateId(),
    name: 'grid-template',
    mimeType: blob.type || 'image/png',
    data
  };
}

async function getGridTemplateImage(aspectRatio: AspectRatio, gridCount: number): Promise<UploadedImage | null> {
  const templateKey = `${aspectRatio}-${gridCount}` as keyof typeof GRID_TEMPLATE_MAP;
  const templateUrl = GRID_TEMPLATE_MAP[templateKey];
  if (!templateUrl) {
    return null;
  }

  return imageUrlToInlineImage(templateUrl);
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
  const parts: Array<Record<string, unknown>> = [{ text: `参照网格划分生成图片\n\n${requestPrompt}` }];

  const templateImage = await getGridTemplateImage(options.aspectRatio, options.gridCount);
  const mergedReferenceImages = templateImage
    ? [templateImage, ...options.referenceImages]
    : options.referenceImages;

  for (const image of mergedReferenceImages) {
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

async function generateGachaSheet(options: GenerateOptions): Promise<GeneratedImage[]> {
  if (options.providerConfig.provider !== 'gemini') {
    throw new Error('Gacha 单次宫格生成当前仅支持 Gemini 提供商。');
  }

  const prompt = options.prompts[0];
  if (!prompt) {
    throw new Error('Gacha 模式缺少核心提示词。');
  }

  const sheetPrompt = composeGachaSheetPrompt(options.payload);
  const sheetImage = await generateSingleWithGemini(sheetPrompt, 0, options);
  options.onProgress(1, 1);

  return sliceGridImageData(sheetImage.data, sheetImage.mimeType, options.gridCount as 2 | 4 | 6 | 8 | 9 | 12 | 16, prompt);
}

async function generateComboSheet(options: GenerateOptions): Promise<GeneratedImage[]> {
  if (options.providerConfig.provider !== 'gemini') {
    throw new Error('Combo 单次宫格生成当前仅支持 Gemini 提供商。');
  }

  if (options.prompts.length === 0) {
    throw new Error('Combo 模式缺少格子提示词。');
  }

  const sheetPrompt = composeComboSheetPrompt(options.payload);
  const sheetImage = await generateSingleWithGemini(sheetPrompt, 0, options);
  options.onProgress(1, 1);

  return sliceGridImageData(
    sheetImage.data,
    sheetImage.mimeType,
    options.gridCount as 2 | 4 | 6 | 8 | 9 | 12 | 16,
    'Combo 网格图'
  ).then((images) =>
    images.map((image, index) => ({
      ...image,
      prompt: options.prompts[index] ?? image.prompt
    }))
  );
}

export async function generateImages(options: GenerateOptions): Promise<GeneratedImage[]> {
  if (options.mode === 'gacha') {
    try {
      return await generateGachaSheet(options);
    } catch (error) {
      return [createErrorResult(options.prompts[0] ?? 'Gacha', normalizeErrorMessage(error))];
    }
  }

  if (options.mode === 'combo') {
    try {
      return await generateComboSheet(options);
    } catch (error) {
      return [createErrorResult('Combo', normalizeErrorMessage(error))];
    }
  }

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
