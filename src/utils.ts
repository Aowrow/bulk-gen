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

  const { columns, rows } = getGridDimensions(gridCount);
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

export function getGridDimensions(gridCount: number): { columns: number; rows: number } {
  if (gridCount === 4) {
    return { columns: 2, rows: 2 };
  }

  if (gridCount === 9) {
    return { columns: 3, rows: 3 };
  }

  if (gridCount === 1) {
    return { columns: 1, rows: 1 };
  }

  const fallbackColumns = getCanvasColumns(gridCount);
  return {
    columns: fallbackColumns,
    rows: Math.ceil(gridCount / fallbackColumns)
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
  if (gridCount === 4) return 2;
  if (gridCount === 9) return 3;
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

export function composeGachaSheetPrompt(payload: StoryboardPayload): string {
  const count = payload.shots.length;
  const { columns, rows } = getGridDimensions(count);

  return [
    '请基于以下 NanoBanana 工作流，一次性生成一张完整的宫格大图，只返回图片结果。',
    `要求输出 ${rows} 行 × ${columns} 列 的拼图画面，总共 ${count} 个格子。`,
    '每个格子都应是同一核心主题下的不同变体。',
    '不要添加文字、水印、边框、编号、UI 元素。',
    '格子之间保留自然分隔感，方便后续前端按规则切图。',
    '工作流 JSON：',
    JSON.stringify(payload, null, 2)
  ].join('\n\n');
}

export function composeComboSheetPrompt(payload: StoryboardPayload): string {
  const count = payload.shots.length;
  const { columns, rows } = getGridDimensions(count);
  const shotLines = payload.shots.map(
    (shot, index) => `格子 ${index + 1}：${shot.prompt_text}`
  );

  return [
    '请基于以下 NanoBanana 工作流，一次性生成一张完整的宫格大图，只返回图片结果。',
    `要求输出 ${rows} 行 × ${columns} 列 的拼图画面，总共 ${count} 个格子。`,
    '每个格子都必须对应各自独立的提示词内容，严格按照网格顺序排布。',
    '不要添加文字、水印、边框、编号、UI 元素。',
    '格子之间保留自然分隔感，方便后续前端按规则切图。',
    '各格子提示词：',
    ...shotLines,
    '工作流 JSON：',
    JSON.stringify(payload, null, 2)
  ].join('\n\n');
}

export async function sliceGridImageData(
  sourceData: string,
  mimeType: string,
  gridCount: GridCount,
  prompt: string
): Promise<GeneratedImage[]> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('宫格大图加载失败，无法切图。'));
    element.src = sourceData;
  });

  const { columns, rows } = getGridDimensions(gridCount);
  const cellWidth = Math.floor(image.width / columns);
  const cellHeight = Math.floor(image.height / rows);

  if (cellWidth <= 0 || cellHeight <= 0) {
    throw new Error('宫格切图失败：计算得到的单格尺寸无效。');
  }

  return Array.from({ length: gridCount }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const canvas = document.createElement('canvas');
    canvas.width = cellWidth;
    canvas.height = cellHeight;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('浏览器不支持画布切图。');
    }

    context.drawImage(
      image,
      column * cellWidth,
      row * cellHeight,
      cellWidth,
      cellHeight,
      0,
      0,
      cellWidth,
      cellHeight
    );

    return {
      id: generateId(),
      prompt: `${prompt} · 变体 ${index + 1}`,
      data: canvas.toDataURL(mimeType || 'image/png', 1),
      mimeType: mimeType || 'image/png',
      status: 'success' as const
    };
  });
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
