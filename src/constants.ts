import type { AspectRatio, GridCount, ProviderConfig, WorkspaceState } from './types';

export const GRID_OPTIONS: GridCount[] = [2, 4, 6, 8, 9, 12, 16];

export const ASPECT_RATIO_OPTIONS: AspectRatio[] = ['Auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '4:5', '5:4', '21:9'];

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: 'gemini',
  apiKey: '',
  baseUrl: '',
  model: 'gemini-3-pro-image-preview'
};

export const DEFAULT_WORKSPACE: WorkspaceState = {
  mode: 'combo',
  gridCount: 4,
  aspectRatio: '1:1',
  resolution: '1K',
  soloPrompt: '',
  gachaPrompt: '',
  comboPrompts: Array.from({ length: 16 }, () => '')
};

export const STORAGE_KEYS = {
  provider: 'bulk_gen_provider_config',
  workspace: 'bulk_gen_workspace'
} as const;

export const MODE_COPY = {
  solo: '一条提示词，只生成一张图。适合快速单图验证。',
  combo: '每个格子都有独立提示词，适合多镜头、多分镜批量生成。',
  gacha: '一条核心提示词扩散成多张变体，适合抽卡式探索。'
} as const;
