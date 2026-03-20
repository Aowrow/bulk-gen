# Bulk Gen 合并版设计与实现记录

## 目标

在 `E:\bulk-gen` 新建一个纯前端 React + Vite 项目，合并以下两类能力：

1. `storyboard` 的分镜 / JSON 组织能力
2. `banana-batch` 的浏览器端 API 配置、参考图上传、客户端调用生图 API 能力

页面结构参考 `https://www.bulk-gen.com/app`，但不实现登录、计费、用户系统。

## 信息来源

- `E:\storyboard\src\lib\prompt.ts`
- `E:\storyboard\src\types.ts`
- `E:\storyboard\src\hooks\usePersistentConfig.ts`
- `E:\banana-batch\core\generationEngine.ts`
- `E:\banana-batch\services\geminiService.ts`
- `E:\banana-batch\services\openaiService.ts`
- `E:\banana-batch\hooks\useProviderConfig.ts`
- `E:\banana-batch\components\InputArea.tsx`

## 合并策略

### 1. 模式层

- **Solo**：单提示词 -> 单图
- **Combo**：多格子多提示词 -> 多图
- **Gacha**：单提示词扩散为多格变体 -> 多图

### 2. 数据层

统一使用浏览器内状态维护：

- 模式、宫格、比例、分辨率
- 单图提示词 / 多格提示词 / Gacha 核心提示词
- 参考图列表
- Provider 配置（`provider / apiKey / baseUrl / model`）

并全部持久化到 `localStorage`。

### 3. JSON 拼装层

把当前界面参数拼成一份 `StoryboardPayload`：

- `image_generation_model`
- `mode`
- `grid_layout`
- `grid_aspect_ratio`
- `clean_mode`
- `resolution`
- `reference_image_count`
- `shots[]`

这份 JSON 既用于：

1. 页面内调试预览
2. 导出为维护 / 排错文件
3. 生成时拼接进每个格子的请求 prompt

### 4. API 调用层

- **Gemini**：使用 `generateContent` 接口，文本 + 参考图一起发送，解析返回的 inline image
- **OpenAI Compatible**：当前实现走 `/images/generations`
  - 支持单图/多图 prompt 请求
  - 当前版本不支持参考图输入，界面会直接提示改用 Gemini

### 5. 界面层

参考 bulk-gen /app 的布局：

- 左侧：模式、宫格、比例、分辨率、参考图、API 配置
- 右侧：提示词编辑画布、结果画布、JSON 调试面板

视觉方向不是像素级照抄，而是保留：

- 深色玻璃面板
- 左配置右工作区
- 模式切换 + 宫格切换 + 网格画布
- 结果区与调试区并排

## 与两个原项目的复用关系

### 来自 storyboard

- “先拼 JSON，再执行工作流”的思路
- `shots[]` 的结构化输出形式
- API Key / 工作区持久化思路

### 来自 banana-batch

- 浏览器端 API Key 管理方式
- 参考图读入与前端压缩思路
- Gemini / OpenAI 前端直连思路
- 按格子逐个生成并展示结果的执行方式

## 当前实现取舍

1. 没有把 `banana-batch` 的整套多会话聊天 UI 搬过来，因为目标是单页生成台
2. 没有引入后端，因为 target.txt 明确要求纯前端
3. OpenAI provider 暂未支持参考图，这和原项目限制保持一致方向
4. Combo 暂未额外调用 LLM 自动把中文分镜润色成英文，而是直接把当前 prompt + JSON 作为生成上下文发送

## 后续可扩展点

1. 为 Combo 增加“中文分镜 -> 英文 JSON”预处理按钮
2. 增加结果下载、批量下载 ZIP
3. 增加失败格子单独重试
4. 为 OpenAI Compatible 增加 Gemini OpenAI endpoint 的 chat completions 图像返回兼容
