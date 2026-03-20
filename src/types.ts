export type Mode = 'solo' | 'combo' | 'gacha';

export type Provider = 'gemini' | 'openai';

export type Resolution = '1K' | '2K' | '4K';

export type AspectRatio = 'Auto' | '1:1' | '3:2' | '2:3' | '4:3' | '3:4' | '16:9' | '9:16' | '4:5' | '5:4' | '21:9';

export type GridCount = 2 | 4 | 6 | 8 | 9 | 12 | 16;

export interface ProviderConfig {
  provider: Provider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface UploadedImage {
  id: string;
  name: string;
  mimeType: string;
  data: string;
}

export interface GeneratedImage {
  id: string;
  prompt: string;
  data: string;
  mimeType: string;
  status: 'success' | 'error';
  errorMessage?: string;
}

export interface WorkspaceState {
  mode: Mode;
  gridCount: GridCount;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  soloPrompt: string;
  gachaPrompt: string;
  comboPrompts: string[];
}

export interface StoryboardShot {
  shot_number: string;
  prompt_text: string;
}

export interface StoryboardPayload {
  image_generation_model: string;
  mode: Mode;
  grid_layout: string;
  grid_aspect_ratio: string;
  clean_mode: boolean;
  resolution: Resolution;
  reference_image_count: number;
  shots: StoryboardShot[];
}
