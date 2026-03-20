import {
  Download,
  Expand,
  ImagePlus,
  KeyRound,
  LoaderCircle,
  ListOrdered,
  RefreshCw,
  Settings2,
  Sparkles,
  Wand2,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ASPECT_RATIO_OPTIONS, DEFAULT_PROVIDER_CONFIG, DEFAULT_WORKSPACE, GRID_OPTIONS, MODE_COPY } from './constants';
import { generateImages } from './generation';
import type { GeneratedImage, GenerationTask, GridCount, Mode, ProviderConfig, UploadedImage, WorkspaceState } from './types';
import {
  buildPromptList,
  buildStoryboardPayload,
  exportTextFile,
  generateId,
  getCanvasColumns,
  getVisiblePromptCount,
  gridLabel,
  importComboPrompts,
  optimizeImage,
  persistProviderConfig,
  persistWorkspaceState,
  readProviderConfig,
  readWorkspaceState,
  summarizePromptStatus,
  validateWorkspace
} from './utils';

const MAX_CONCURRENT_TASKS = 3;

function App() {
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(readProviderConfig);
  const [workspace, setWorkspace] = useState<WorkspaceState>(readWorkspaceState);
  const [referenceImages, setReferenceImages] = useState<UploadedImage[]>([]);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [payloadPreview, setPayloadPreview] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [configOpen, setConfigOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const controllerMapRef = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    persistProviderConfig(providerConfig);
  }, [providerConfig]);

  useEffect(() => {
    persistWorkspaceState(workspace);
  }, [workspace]);

  const mode = workspace.mode;
  const visiblePromptCount = getVisiblePromptCount(mode, workspace.gridCount);
  const promptStatus = summarizePromptStatus(mode, workspace);
  const storyboardPayload = useMemo(() => buildStoryboardPayload(mode, workspace, referenceImages), [mode, workspace, referenceImages]);
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );
  const runningTask = useMemo(
    () => tasks.find((task) => task.status === 'running') ?? null,
    [tasks]
  );
  const runningTasks = useMemo(
    () => tasks.filter((task) => task.status === 'running'),
    [tasks]
  );

  useEffect(() => {
    setPayloadPreview(JSON.stringify(storyboardPayload, null, 2));
  }, [storyboardPayload]);

  useEffect(() => {
    const availableSlots = MAX_CONCURRENT_TASKS - runningTasks.length;
    if (availableSlots <= 0) {
      return;
    }

    const queuedTasks = tasks.filter((task) => task.status === 'queued').slice(0, availableSlots);
    if (queuedTasks.length === 0) {
      return;
    }

    setTasks((current) =>
      current.map((task) =>
        queuedTasks.some((queuedTask) => queuedTask.id === task.id)
          ? {
              ...task,
              status: 'running',
              progress: { current: 0, total: 1 }
            }
          : task
      )
    );

    for (const nextTask of queuedTasks) {
      if (controllerMapRef.current.has(nextTask.id)) {
        continue;
      }

      const controller = new AbortController();
      controllerMapRef.current.set(nextTask.id, controller);

      void (async () => {
        try {
          const generated = await generateImages({
            mode: nextTask.mode,
            gridCount: nextTask.gridCount,
            prompts: nextTask.prompts,
            payload: nextTask.payload,
            referenceImages,
            providerConfig,
            aspectRatio: nextTask.aspectRatio,
            resolution: nextTask.resolution,
            signal: controller.signal,
            onProgress: (completed, total) => {
              setTasks((current) =>
                current.map((task) =>
                  task.id === nextTask.id
                    ? {
                        ...task,
                        progress: { current: completed, total }
                      }
                    : task
                )
              );
            }
          });

          setTasks((current) =>
            current.map((task) =>
              task.id === nextTask.id
                ? {
                    ...task,
                    status: generated.some((item) => item.status === 'error') ? 'failed' : 'completed',
                    resultImages: generated,
                    errorMessage: generated.length === 1 && generated[0].status === 'error' ? generated[0].errorMessage : undefined,
                    progress: { current: generated.length, total: generated.length || 1 }
                  }
                : task
            )
          );
        } catch (generationError) {
          const isAbort = generationError instanceof Error && generationError.name === 'AbortError';
          setTasks((current) =>
            current.map((task) =>
              task.id === nextTask.id
                ? {
                    ...task,
                    status: isAbort ? 'cancelled' : 'failed',
                    errorMessage: isAbort
                      ? '任务已取消。'
                      : generationError instanceof Error
                        ? generationError.message
                        : '生成失败。'
                  }
                : task
            )
          );
        } finally {
          controllerMapRef.current.delete(nextTask.id);
        }
      })();
    }
  }, [tasks, runningTasks.length, providerConfig, referenceImages]);

  const summaryCopy = useMemo(() => {
    const count = mode === 'solo' ? 1 : workspace.gridCount;
    const kind = mode === 'gacha' ? '变体' : '图片';
    return `${mode === 'solo' ? '1 条提示词 -> 1 张图片' : `${count} 条提示词 -> ${count} 张${kind}`} | 画布 ${workspace.aspectRatio}`;
  }, [mode, workspace]);

  const updateWorkspace = (updates: Partial<WorkspaceState>) => {
    setWorkspace((current) => ({ ...current, ...updates }));
  };

  const handleModeChange = (nextMode: Mode) => {
    updateWorkspace({ mode: nextMode });
    setError('');
  };

  const handleGridChange = (gridCount: GridCount) => {
    updateWorkspace({ gridCount });
  };

  const handleComboPromptChange = (index: number, value: string) => {
    setWorkspace((current) => {
      const nextPrompts = [...current.comboPrompts];
      nextPrompts[index] = value;
      return { ...current, comboPrompts: nextPrompts };
    });
  };

  const handleImportPrompts = () => {
    const text = window.prompt(`请粘贴最多 ${workspace.gridCount} 行提示词，每行对应一个格子。`);
    if (!text) {
      return;
    }

    setWorkspace((current) => ({
      ...current,
      comboPrompts: importComboPrompts(text, current.gridCount)
    }));
  };

  const handleUploadImages = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    const selected = Array.from(files);
    const nextTotal = referenceImages.length + selected.length;
    if (nextTotal > 14) {
      setError('参考图最多 14 张。');
      return;
    }

    try {
      const processed = await Promise.all(
        selected.map(async (file) => {
          if (!file.type.startsWith('image/')) {
            throw new Error(`${file.name} 不是图片文件。`);
          }
          if (file.size > 7 * 1024 * 1024) {
            throw new Error(`${file.name} 超过 7MB，请压缩后再上传。`);
          }
          return optimizeImage(file);
        })
      );

      setReferenceImages((current) => [...current, ...processed]);
      setError('');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '参考图上传失败。');
    }
  };

  const handleGenerate = async () => {
    const validationMessage = validateWorkspace(mode, workspace, providerConfig);
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    const prompts = buildPromptList(mode, workspace);
    if (prompts.length === 0) {
      setError('没有可执行的提示词。');
      return;
    }

    setError('');

    const task: GenerationTask = {
      id: generateId(),
      createdAt: Date.now(),
      status: runningTask ? 'queued' : 'queued',
      mode,
      gridCount: workspace.gridCount,
      aspectRatio: workspace.aspectRatio,
      resolution: workspace.resolution,
      prompts,
      payload: storyboardPayload,
      progress: { current: 0, total: 1 },
      resultImages: []
    };

    setTasks((current) => [task, ...current]);
    setSelectedTaskId(task.id);
  };

  const handleStop = () => {
    for (const controller of controllerMapRef.current.values()) {
      controller.abort();
    }
  };

  const handleCancelTask = (taskId: string) => {
    const controller = controllerMapRef.current.get(taskId);
    if (controller) {
      controller.abort();
      return;
    }

    setTasks((current) =>
      current.map((task) =>
        task.id === taskId && task.status === 'queued'
          ? {
              ...task,
              status: 'cancelled',
              errorMessage: '任务已取消。'
            }
          : task
      )
    );
  };

  const handleDeleteTask = (taskId: string) => {
    setTasks((current) => {
      const nextTasks = current.filter((task) => task.id !== taskId);
      if (selectedTaskId === taskId) {
        setSelectedTaskId(nextTasks[0]?.id ?? null);
      }
      return nextTasks;
    });
  };

  const handleReset = () => {
    setWorkspace(DEFAULT_WORKSPACE);
    setProviderConfig(DEFAULT_PROVIDER_CONFIG);
    setReferenceImages([]);
    setError('');
    setPayloadPreview(JSON.stringify(buildStoryboardPayload(DEFAULT_WORKSPACE.mode, DEFAULT_WORKSPACE, []), null, 2));
  };

  const exportPayload = () => {
    exportTextFile('bulk-gen-payload.json', payloadPreview, 'application/json;charset=utf-8');
  };

  const downloadImage = (event: React.MouseEvent, image: GeneratedImage) => {
    event.stopPropagation();
    if (!image.data) {
      return;
    }

    const link = document.createElement('a');
    link.href = image.data;
    const extension = image.mimeType.split('/')[1] || 'png';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    link.download = `bulk-gen-${timestamp}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const currentResultCount = selectedTask ? (selectedTask.mode === 'solo' ? 1 : selectedTask.gridCount) : mode === 'solo' ? 1 : workspace.gridCount;
  const canvasColumns = getCanvasColumns(currentResultCount);
  const resultImages = selectedTask?.resultImages ?? [];
  const progressText = selectedTask
    ? selectedTask.status === 'queued'
      ? '等待执行中...'
      : selectedTask.status === 'running'
        ? `正在生成：${selectedTask.progress.current}/${selectedTask.progress.total}`
        : selectedTask.status === 'completed'
          ? `生成完成：${selectedTask.resultImages.length}/${selectedTask.resultImages.length}`
          : selectedTask.status === 'cancelled'
            ? '任务已取消'
            : selectedTask.errorMessage ?? ''
    : runningTask
      ? '队列运行中'
      : '';
  const jsonPreview = selectedTask ? JSON.stringify(selectedTask.payload, null, 2) : payloadPreview;

  return (
    <div className="page-shell">
      <div className="page-noise" />
      {previewImage && (
        <div
          className="image-preview-overlay"
          onClick={() => setPreviewImage(null)}
          role="presentation"
        >
          <div
            className="image-preview-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="图片预览"
          >
            <div className="image-preview-toolbar">
              <div>
                <p className="eyebrow">图片预览</p>
                <p className="image-preview-prompt">{previewImage.prompt}</p>
              </div>
              <div className="image-preview-actions">
                <button className="ghost-button" onClick={(event) => downloadImage(event, previewImage)}>
                  <Download size={16} /> 下载
                </button>
                <button className="ghost-button" onClick={() => setPreviewImage(null)}>
                  <X size={16} /> 关闭
                </button>
              </div>
            </div>
            <div className="image-preview-frame">
              <img src={previewImage.data} alt={previewImage.prompt} />
            </div>
          </div>
        </div>
      )}

      <header className="topbar">
        <div>
          <p className="eyebrow">Bulk Gen Workspace</p>
          <h1>中文纯前端生图工作台</h1>
          <p className="hero-copy">融合 storyboard 的分镜组织能力和 banana-batch 的 API 生图能力，支持 Solo / Combo / Gacha 三种模式。</p>
        </div>

        <div className="topbar-actions">
          <div className="config-trigger-wrap">
            <button className="ghost-button" onClick={() => setConfigOpen((current) => !current)}>
              <KeyRound size={18} /> API 配置
            </button>

            {configOpen && (
              <section className="glass-panel config-dropdown">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Provider</p>
                    <h2>API 配置</h2>
                  </div>
                  <Settings2 size={18} />
                </div>

                <label className="form-field">
                  <span>提供商</span>
                  <select
                    value={providerConfig.provider}
                    onChange={(event) => {
                      const provider = event.target.value as ProviderConfig['provider'];
                      setProviderConfig((current) => ({
                        ...current,
                        provider,
                        model: provider === 'gemini' ? 'gemini-3-pro-image-preview' : 'gpt-image-1',
                        baseUrl: provider === 'gemini' ? '' : current.baseUrl || 'https://api.openai.com/v1'
                      }));
                    }}
                  >
                    <option value="gemini">Gemini</option>
                    <option value="openai">OpenAI Compatible</option>
                  </select>
                </label>

                <label className="form-field">
                  <span>API Key</span>
                  <input
                    type="password"
                    value={providerConfig.apiKey}
                    onChange={(event) => setProviderConfig((current) => ({ ...current, apiKey: event.target.value }))}
                    placeholder="请输入 API Key"
                  />
                </label>

                <label className="form-field">
                  <span>Base URL（可选）</span>
                  <input
                    type="text"
                    value={providerConfig.baseUrl}
                    onChange={(event) => setProviderConfig((current) => ({ ...current, baseUrl: event.target.value }))}
                    placeholder={providerConfig.provider === 'gemini' ? '默认使用原生 Gemini REST API' : '默认 https://api.openai.com/v1'}
                  />
                </label>

                <label className="form-field">
                  <span>模型</span>
                  <input
                    type="text"
                    value={providerConfig.model}
                    onChange={(event) => setProviderConfig((current) => ({ ...current, model: event.target.value }))}
                    placeholder="模型名称"
                  />
                </label>
              </section>
            )}
          </div>
          <button className="ghost-button" onClick={exportPayload}>
            <Download size={18} /> 导出 JSON
          </button>
          <button className="ghost-button" onClick={handleReset}>
            <RefreshCw size={18} /> 重置
          </button>
          {runningTask && (
            <button className="primary-button danger-button" onClick={handleStop}>
              <X size={18} /> 停止全部
            </button>
          )}
          <button className="primary-button" onClick={handleGenerate}>
            <Wand2 size={18} /> 开始生成
          </button>
        </div>
      </header>

      <main className="workspace-layout">
        <aside className="sidebar-panel">
          <section className="glass-panel section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">模式</p>
                <h2>生成方式</h2>
              </div>
            </div>

            <div className="mode-switcher">
              {(['solo', 'combo', 'gacha'] as Mode[]).map((item) => (
                <button
                  key={item}
                  className={`mode-pill ${mode === item ? 'mode-pill--active' : ''}`}
                  onClick={() => handleModeChange(item)}
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="muted-copy">{MODE_COPY[mode]}</p>
          </section>

          {mode !== 'solo' && (
            <section className="glass-panel section-block">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Grid</p>
                  <h2>宫格数量</h2>
                </div>
              </div>

              <div className="option-grid">
                {GRID_OPTIONS.map((count) => (
                  <button
                    key={count}
                    className={`option-chip ${workspace.gridCount === count ? 'option-chip--active' : ''}`}
                    onClick={() => handleGridChange(count)}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="glass-panel section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">画布</p>
                <h2>比例</h2>
              </div>
            </div>

            <div className="option-grid compact-grid">
              {ASPECT_RATIO_OPTIONS.map((ratio) => (
                <button
                  key={ratio}
                  className={`option-chip ${workspace.aspectRatio === ratio ? 'option-chip--active' : ''}`}
                  onClick={() => updateWorkspace({ aspectRatio: ratio })}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </section>

          <section className="glass-panel section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">质量</p>
                <h2>分辨率</h2>
              </div>
            </div>

            <div className="option-grid resolution-grid">
              {(['1K', '2K', '4K'] as const).map((item) => (
                <button
                  key={item}
                  className={`option-chip ${workspace.resolution === item ? 'option-chip--active' : ''}`}
                  onClick={() => updateWorkspace({ resolution: item })}
                >
                  {item}
                </button>
              ))}
            </div>
          </section>

          <section className="glass-panel section-block">
            <div className="section-heading">
              <div>
                <p className="eyebrow">参考图</p>
                <h2>上传素材</h2>
              </div>
              <button className="icon-button" onClick={() => fileInputRef.current?.click()}>
                <ImagePlus size={18} /> 添加图片
              </button>
            </div>
            <p className="muted-copy">最多 14 张，每张不超过 7MB。会在浏览器端压缩后上传。</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                void handleUploadImages(event.target.files);
                event.currentTarget.value = '';
              }}
            />

            {referenceImages.length === 0 ? (
              <div className="empty-card">暂无参考图</div>
            ) : (
              <div className="reference-grid">
                {referenceImages.map((image) => (
                  <div key={image.id} className="reference-card">
                    <img src={image.data} alt={image.name} />
                    <button
                      className="reference-remove"
                      onClick={() => setReferenceImages((current) => current.filter((item) => item.id !== image.id))}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

        </aside>

        <section className="content-column">
          <section className="glass-panel canvas-panel">
            <div className="canvas-summary">
              <div>
                <p className="eyebrow">当前工作台</p>
                <h2>{gridLabel(mode, workspace.gridCount)}</h2>
                <p className="muted-copy">{summaryCopy}</p>
              </div>
              <div className="status-stack">
                <span className="status-pill">
                  <Sparkles size={14} /> {promptStatus}
                </span>
                {progressText && <span className="status-note">{progressText}</span>}
              </div>
            </div>

            {mode === 'solo' && (
              <div className="solo-prompt-block">
                <textarea
                  value={workspace.soloPrompt}
                  onChange={(event) => updateWorkspace({ soloPrompt: event.target.value })}
                  placeholder="请输入单图提示词，例如：高对比黑白人像，编辑部灯光，极简布景。"
                />
              </div>
            )}

            {mode === 'gacha' && (
              <div className="solo-prompt-block">
                <textarea
                  value={workspace.gachaPrompt}
                  onChange={(event) => updateWorkspace({ gachaPrompt: event.target.value })}
                  placeholder="请输入一条核心提示词，系统会按当前宫格数量扩展为多张变体。"
                />
              </div>
            )}

            {mode === 'combo' && (
              <>
                <div className="combo-toolbar">
                  <button className="ghost-button" onClick={handleImportPrompts}>
                    <Download size={16} /> 导入提示词
                  </button>
                </div>
                <div className="prompt-grid" style={{ gridTemplateColumns: `repeat(${Math.min(canvasColumns, 4)}, minmax(0, 1fr))` }}>
                  {Array.from({ length: visiblePromptCount }, (_, index) => (
                    <label key={index} className="prompt-card">
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <textarea
                        value={workspace.comboPrompts[index]}
                        onChange={(event) => handleComboPromptChange(index, event.target.value)}
                        placeholder={`Prompt ${index + 1}...`}
                      />
                    </label>
                  ))}
                </div>
              </>
            )}

            {mode === 'gacha' && (
              <div className="gacha-preview" style={{ gridTemplateColumns: `repeat(${Math.min(canvasColumns, 4)}, minmax(0, 1fr))` }}>
                {Array.from({ length: workspace.gridCount }, (_, index) => (
                  <div key={index} className="gacha-cell">
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>gacha</strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="dual-panel-grid">
            <section className="glass-panel result-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">结果</p>
                  <h2>生成画布</h2>
                </div>
              </div>

              {resultImages.length === 0 ? (
                <div className="empty-card large-empty">选择右侧任务可查看结果；新任务会进入队列顺序执行。</div>
              ) : (
                <div className="result-grid" style={{ gridTemplateColumns: `repeat(${Math.min(canvasColumns, 4)}, minmax(0, 1fr))` }}>
                  {resultImages.map((item, index) => (
                    <article
                      key={item.id}
                      className={`result-card ${item.status === 'success' ? 'result-card--interactive' : ''}`}
                      onClick={() => {
                        if (item.status === 'success') {
                          setPreviewImage(item);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (item.status !== 'success') {
                          return;
                        }

                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setPreviewImage(item);
                        }
                      }}
                      role={item.status === 'success' ? 'button' : undefined}
                      tabIndex={item.status === 'success' ? 0 : -1}
                    >
                      <div className="result-card__header">
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <small>{item.status === 'success' ? '成功' : '失败'}</small>
                      </div>
                      {item.status === 'success' ? (
                        <div className="result-card__media">
                          <img src={item.data} alt={item.prompt} />
                          <div className="result-card__overlay">
                            <button className="result-card__icon" onClick={(event) => downloadImage(event, item)}>
                              <Download size={16} />
                            </button>
                            <div className="result-card__zoom-hint">
                              <Expand size={16} /> 点击放大
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="error-card">{item.errorMessage ?? '该格子生成失败。'}</div>
                      )}
                      <p>{item.prompt}</p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="glass-panel json-panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">调试</p>
                  <h2>拼装 JSON</h2>
                </div>
              </div>
              <pre>{jsonPreview}</pre>
            </section>
          </section>

          {error && <div className="error-banner">{error}</div>}
        </section>

        <aside className="task-panel-column">
          <section className="glass-panel task-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Queue</p>
                <h2>任务列表</h2>
              </div>
              <span className="task-count-badge">
                <ListOrdered size={14} /> {tasks.length}
              </span>
            </div>

            {tasks.length === 0 ? (
              <div className="empty-card task-empty">提交生成后，这里会显示任务进度和全部产物。</div>
            ) : (
              <div className="task-list">
                {tasks.map((task) => {
                  const successCount = task.resultImages.filter((item) => item.status === 'success').length;
                  const taskSummary = `${task.mode.toUpperCase()} · ${task.mode === 'solo' ? '1 张' : `${task.gridCount} 宫格`} · ${task.aspectRatio}`;
                  const canCancel = task.status === 'queued' || task.status === 'running';
                  const canDelete = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
                  return (
                    <button
                      key={task.id}
                      className={`task-card ${selectedTaskId === task.id ? 'task-card--active' : ''}`}
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <div className="task-card__topline">
                        <span className={`task-status task-status--${task.status}`}>{task.status}</span>
                        <div className="task-card__actions">
                          {task.status === 'running' && <LoaderCircle size={14} className="task-spin" />}
                          {canCancel && (
                            <span
                              className="task-cancel-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleCancelTask(task.id);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  handleCancelTask(task.id);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              <X size={12} /> 取消
                            </span>
                          )}
                          {canDelete && (
                            <span
                              className="task-delete-button"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleDeleteTask(task.id);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  handleDeleteTask(task.id);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              <X size={12} /> 删除
                            </span>
                          )}
                        </div>
                      </div>
                      <strong>{taskSummary}</strong>
                      <p>{task.prompts[0] ?? '无提示词'}</p>
                      <div className="task-card__meta">
                        <span>{new Date(task.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>
                          {task.status === 'running'
                            ? `${task.progress.current}/${task.progress.total}`
                            : `${successCount}/${task.resultImages.length || task.prompts.length}`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </main>
    </div>
  );
}

export default App;
