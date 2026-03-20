import { DEFAULT_PROVIDER_CONFIG, DEFAULT_WORKSPACE, STORAGE_KEYS } from './constants';
import type {
  AspectRatio,
  GeneratedImage,
  GridCount,
  Mode,
  ProviderConfig,
  Resolution,
  StoryboardPayload,
  UploadedImage,
  WorkspaceState
} from './types';

export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function readProviderConfig(): ProviderConfig {
  if (typeof window === 'undefined') {
    return DEFAULT_PROVIDER_CONFIG;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.provider);
    if (!raw) {
      return DEFAULT_PROVIDER_CONFIG;
    }

    const parsed = JSON.parse(raw) as Partial<ProviderConfig>;
    return {
      ...DEFAULT_PROVIDER_CONFIG,
      ...parsed
    };
  } catch {
    return DEFAULT_PROVIDER_CONFIG;
  }
}

export function readWorkspaceState(): WorkspaceState {
  if (typeof window === 'undefined') {
    return DEFAULT_WORKSPACE;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.workspace);
    if (!raw) {
      return DEFAULT_WORKSPACE;
    }

    const parsed = JSON.parse(raw) as Partial<WorkspaceState>;
    const comboPrompts = Array.isArray(parsed.comboPrompts)
      ? Array.from({ length: 16 }, (_, index) => parsed.comboPrompts?.[index] ?? '')
      : DEFAULT_WORKSPACE.comboPrompts;

    return {
      ...DEFAULT_WORKSPACE,
      ...parsed,
      comboPrompts
    };
  } catch {
    return DEFAULT_WORKSPACE;
  }
}

export function persistProviderConfig(config: ProviderConfig): void {
  window.localStorage.setItem(STORAGE_KEYS.provider, JSON.stringify(config));
}

export function persistWorkspaceState(workspace: WorkspaceState): void {
  window.localStorage.setItem(STORAGE_KEYS.workspace, JSON.stringify(workspace));
}

export function getVisiblePromptCount(mode: Mode, gridCount: GridCount): number {
  if (mode === 'solo') {
    return 1;
  }

  return gridCount;
}

export function buildPromptList(mode: Mode, workspace: WorkspaceState): string[] {
  if (mode === 'solo') {
    return [workspace.soloPrompt.trim()].filter(Boolean);
  }

  if (mode === 'gacha') {
    const prompt = workspace.gachaPrompt.trim();
    return prompt ? Array.from({ length: workspace.gridCount }, () => prompt) : [];
  }

  return workspace.comboPrompts.slice(0, workspace.gridCount).map((item) => item.trim()).filter(Boolean);
}

export function validateWorkspace(mode: Mode, workspace: WorkspaceState, provider: ProviderConfig): string | null {
  if (!provider.apiKey.trim()) {
    return '请先配置 API Key。';
  }

  if (mode === 'solo' && !workspace.soloPrompt.trim()) {
    return 'Solo 模式需要填写提示词。';
  }

  if (mode === 'gacha' && !workspace.gachaPrompt.trim()) {
    return 'Gacha 模式需要填写核心提示词。';
  }

  if (mode === 'combo') {
    const prompts = workspace.comboPrompts.slice(0, workspace.gridCount);
    const missing = prompts.findIndex((item) => !item.trim());
    if (missing >= 0) {
      return `Combo 模式第 ${missing + 1} 个格子的提示词为空。`;
    }
  }

  return null;
}

export function gridLabel(mode: Mode, gridCount: GridCount): string {
  if (mode === 'solo') {
    return 'Solo 1x1（1 张图）';
  }

  const columns = gridCount <= 2 ? 2 : gridCount <= 6 ? 3 : 4;
  const rows = Math.ceil(gridCount / columns);
  return `${mode === 'combo' ? 'Combo' : 'Gacha'} ${rows}x${columns}（${gridCount} 张图）`;
}

export function perCellSize(aspectRatio: AspectRatio, resolution: Resolution): string {
  const base = resolution === '4K' ? 2048 : resolution === '2K' ? 1024 : 512;
  if (aspectRatio === 'Auto' || aspectRatio === '1:1') {
    return `${base}×${base}`;
  }

  return `${base}px 基准`;
}

export function buildStoryboardPayload(
  mode: Mode,
  workspace: WorkspaceState,
  referenceImages: UploadedImage[]
): StoryboardPayload {
  const prompts = buildPromptList(mode, workspace);

  return {
    image_generation_model: 'NanoBanana',
    mode,
    grid_layout: mode === 'solo' ? '1x1' : `${workspace.gridCount}-grid`,
    grid_aspect_ratio: workspace.aspectRatio === 'Auto' ? '1:1' : workspace.aspectRatio,
    clean_mode: true,
    resolution: workspace.resolution,
    reference_image_count: referenceImages.length,
    shots: prompts.map((prompt, index) => ({
      shot_number: String(index + 1).padStart(2, '0'),
      prompt_text: prompt
    }))
  };
}

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('读取图片失败。'));
    };
    reader.onerror = () => reject(new Error('读取图片失败。'));
    reader.readAsDataURL(file);
  });
}

export async function optimizeImage(file: File): Promise<UploadedImage> {
  const largeFile = file.size > 1024 * 1024;
  if (!largeFile) {
    return {
      id: generateId(),
      name: file.name,
      mimeType: file.type || 'image/png',
      data: await fileToDataUrl(file)
    };
  }

  const imageElement = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`图片 ${file.name} 载入失败。`));
    };
    image.src = objectUrl;
  });

  const maxSize = 2048;
  const ratio = Math.min(maxSize / imageElement.width, maxSize / imageElement.height, 1);
  const width = Math.round(imageElement.width * ratio);
  const height = Math.round(imageElement.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('浏览器不支持图片压缩。');
  }

  context.drawImage(imageElement, 0, 0, width, height);
  const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const data = canvas.toDataURL(mimeType, 0.85);

  return {
    id: generateId(),
    name: file.name,
    mimeType,
    data
  };
}

export function exportTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function importComboPrompts(text: string, gridCount: GridCount): string[] {
  const rows = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, gridCount);

  return Array.from({ length: 16 }, (_, index) => rows[index] ?? '');
}

export function getCanvasColumns(gridCount: number): number {
  if (gridCount <= 2) return 2;
  if (gridCount <= 6) return 3;
  return 4;
}

export function summarizePromptStatus(mode: Mode, workspace: WorkspaceState): string {
  if (mode === 'solo') {
    return `${workspace.soloPrompt.trim() ? 1 : 0}/1 条提示词已就绪`;
  }

  if (mode === 'gacha') {
    return `${workspace.gachaPrompt.trim() ? 1 : 0}/1 条提示词已就绪`;
  }

  const completed = workspace.comboPrompts.slice(0, workspace.gridCount).filter((item) => item.trim()).length;
  return `${completed}/${workspace.gridCount} 条提示词已就绪`;
}

export function composeRequestPrompt(payload: StoryboardPayload, prompt: string, index: number): string {
  return [
    '请基于以下 NanoBanana 工作流生成 1 张图片，只返回图片结果。',
    `当前格子序号：${String(index + 1).padStart(2, '0')}`,
    '工作流 JSON：',
    JSON.stringify(payload, null, 2),
    '当前格子的 prompt_text：',
    prompt
  ].join('\n\n');
}

export function mapAspectRatioToOpenAI(aspectRatio: AspectRatio): string {
  if (aspectRatio === 'Auto' || aspectRatio === '1:1') {
    return '1024x1024';
  }

  const [width, height] = aspectRatio.split(':').map(Number);
  if (!width || !height) {
    return '1024x1024';
  }

  return width > height ? '1536x1024' : '1024x1536';
}

export function mapResolutionToOpenAIQuality(resolution: Resolution): 'standard' | 'hd' {
  return resolution === '1K' ? 'standard' : 'hd';
}

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return '发生未知错误。';
}

export function createErrorResult(prompt: string, message: string): GeneratedImage {
  return {
    id: generateId(),
    prompt,
    data: '',
    mimeType: '',
    status: 'error',
    errorMessage: message
  };
}
