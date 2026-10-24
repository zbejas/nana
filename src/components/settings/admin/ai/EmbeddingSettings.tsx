import { useState, useEffect } from 'react';
import { pb } from '../../../../lib/pocketbase';
import type { RecordModel } from 'pocketbase';
import type { AIProviderKey } from '../../../../lib/ai/types';
import { createLogger } from '../../../../lib/logger';
import { Button, Card, Field, Input, SectionHeading, Select, Spinner, Switch } from '../../../ui';

const log = createLogger('EmbedSettings');

// ── Types (mirror server-side EmbeddingConfig) ───────────────────────

type ChunkingStrategy = 'fixed' | 'paragraph' | 'sentence';

interface EmbeddingConfig {
    chunkingStrategy: ChunkingStrategy;
    chunkSize: number;
    chunkOverlap: number;
    topk: number;
    similarityThreshold: number;
    embeddingDimensions: Record<AIProviderKey, number>;
    autoEmbed: boolean;
}

interface SettingRecord extends RecordModel {
    key: string;
    value: any;
    description: string;
}

interface EmbeddingStatus {
    provider: AIProviderKey | null;
    totalVectors: number;
    embeddingModel: string | null;
    dimensions: number;
}

const DEFAULT_CONFIG: EmbeddingConfig = {
    chunkingStrategy: 'paragraph',
    chunkSize: 500,
    chunkOverlap: 50,
    topk: 10,
    similarityThreshold: 0.65,
    embeddingDimensions: { openai: 1536, google: 768, ollama: 768 },
    autoEmbed: true,
};

const PROVIDER_KEYS: AIProviderKey[] = ['openai', 'google', 'ollama'];

const STRATEGY_OPTIONS: { value: ChunkingStrategy; label: string; description: string }[] = [
    { value: 'paragraph', label: 'Paragraph', description: 'Split on double newlines, merge short paragraphs' },
    { value: 'sentence', label: 'Sentence', description: 'Split on sentence boundaries (.!?)' },
    { value: 'fixed', label: 'Fixed Size', description: 'Split at fixed character intervals with overlap' },
];

const DIMENSION_HINTS: Record<AIProviderKey, string> = {
    openai: 'text-embedding-3-small = 1536, text-embedding-3-large = 3072',
    google: 'text-embedding-004 = 768 (or custom via outputDimensionality)',
    ollama: 'nomic-embed-text = 768, mxbai-embed-large = 1024',
};

// ── Component ────────────────────────────────────────────────────────

export function EmbeddingSettings() {
    const [record, setRecord] = useState<SettingRecord | null>(null);
    const [config, setConfig] = useState<EmbeddingConfig>(structuredClone(DEFAULT_CONFIG));
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [reembedding, setReembedding] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [status, setStatus] = useState<EmbeddingStatus | null>(null);

    useEffect(() => {
        loadConfig();
        loadStatus();
    }, []);

    const loadConfig = async () => {
        try {
            setLoading(true);
            setError(null);
            const rec = await pb.collection('settings').getFirstListItem<SettingRecord>('key="embedding_config"');
            setRecord(rec);
            const merged: EmbeddingConfig = {
                ...DEFAULT_CONFIG,
                ...rec.value,
                embeddingDimensions: {
                    ...DEFAULT_CONFIG.embeddingDimensions,
                    ...(rec.value?.embeddingDimensions ?? {}),
                },
            };
            setConfig(merged);
        } catch (err: any) {
            // If not found, use defaults
            if (err?.status === 404 || err?.message?.includes('404')) {
                setConfig(structuredClone(DEFAULT_CONFIG));
            } else {
                log.error('Failed to load embedding config', err);
                setError(err.message || 'Failed to load embedding configuration');
            }
        } finally {
            setLoading(false);
        }
    };

    const loadStatus = async () => {
        try {
            const token = pb.authStore.token;
            if (!token) return;
            const res = await fetch('/api/embeddings/status', {
                headers: { Authorization: token },
            });
            if (res.ok) {
                setStatus(await res.json());
            }
        } catch {
            // Non-critical
        }
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            setError(null);
            setSuccessMessage(null);

            if (record) {
                await pb.collection('settings').update(record.id, { value: config });
            } else {
                const newRecord = await pb.collection('settings').create<SettingRecord>({
                    key: 'embedding_config',
                    value: config,
                    description: 'Embedding pipeline configuration (chunking, dimensions, search settings)',
                });
                setRecord(newRecord);
            }

            setSuccessMessage('Embedding configuration saved successfully');
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err: any) {
            log.error('Failed to save embedding config', err);
            setError(err.message || 'Failed to save embedding configuration');
        } finally {
            setSaving(false);
        }
    };

    const handleReembed = async () => {
        try {
            setReembedding(true);
            setError(null);
            setSuccessMessage(null);

            const token = pb.authStore.token;
            if (!token) {
                setError('Not authenticated');
                return;
            }

            const res = await fetch('/api/embeddings/embed-all', {
                method: 'POST',
                headers: {
                    Authorization: token,
                    'Content-Type': 'application/json',
                },
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(data.error || `Failed with status ${res.status}`);
            }

            const result = await res.json();
            const errorCount = result.errors?.length || 0;
            setSuccessMessage(
                `Re-embedded ${result.totalDocuments} documents (${result.totalChunks} chunks)` +
                (errorCount > 0 ? `. ${errorCount} error(s) occurred.` : ''),
            );
            setTimeout(() => setSuccessMessage(null), 5000);
            loadStatus();
        } catch (err: any) {
            log.error('Re-embed failed', err);
            setError(err.message || 'Failed to re-embed documents');
        } finally {
            setReembedding(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-10">
                <Spinner label="Loading embedding configuration" />
            </div>
        );
    }

    const strategyHint = STRATEGY_OPTIONS.find((s) => s.value === config.chunkingStrategy)?.description;

    return (
        <Card className="p-5 sm:p-6">
            <SectionHeading
                eyebrow="Semantic search"
                title="Embedding"
                description="Configure how documents are chunked and embedded for semantic search and RAG."
                actions={
                    <Button variant="primary" loading={saving} onClick={handleSave}>
                        Save Embedding Settings
                    </Button>
                }
            />

            {error && (
                <p className="mt-4 text-sm text-danger" role="alert">
                    {error}
                </p>
            )}
            {successMessage && (
                <p className="mt-4 text-sm text-sage" role="status">
                    {successMessage}
                </p>
            )}

            {/* Status panel */}
            {status && (
                <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 rounded-control border border-line bg-surface-sunken/40 px-4 py-3.5 sm:grid-cols-4">
                    <div className="min-w-0">
                        <dt className="eyebrow">Provider</dt>
                        <dd className="mt-1.5 truncate text-sm font-medium text-ink">{status.provider ?? 'None'}</dd>
                    </div>
                    <div className="min-w-0">
                        <dt className="eyebrow">Model</dt>
                        <dd className="mt-1.5 truncate text-sm font-medium text-ink">{status.embeddingModel ?? 'None'}</dd>
                    </div>
                    <div className="min-w-0">
                        <dt className="eyebrow">Total vectors</dt>
                        <dd className="mt-1.5 truncate text-sm font-medium text-ink">{status.totalVectors.toLocaleString()}</dd>
                    </div>
                    <div className="min-w-0">
                        <dt className="eyebrow">Dimensions</dt>
                        <dd className="mt-1.5 truncate text-sm font-medium text-ink">{status.dimensions}</dd>
                    </div>
                </dl>
            )}

            {/* Auto-embed toggle */}
            <Switch
                id="embedding-auto-embed"
                className="mt-4 rounded-control border border-line bg-surface-sunken/40 px-4 py-3"
                checked={config.autoEmbed}
                onChange={(checked) => setConfig((prev) => ({ ...prev, autoEmbed: checked }))}
                label="Auto-embed on save"
                description="Automatically embed documents when they are created or updated"
            />

            {/* Chunking settings */}
            <div className="mt-6 space-y-4 border-t border-line pt-5">
                <h3 className="text-sm font-medium text-ink">Chunking</h3>

                <Field label="Strategy" htmlFor="embedding-strategy" hint={strategyHint}>
                    <Select
                        id="embedding-strategy"
                        value={config.chunkingStrategy}
                        onChange={(e) =>
                            setConfig((prev) => ({
                                ...prev,
                                chunkingStrategy: e.target.value as ChunkingStrategy,
                            }))
                        }
                    >
                        {STRATEGY_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </Select>
                </Field>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field label="Chunk Size" htmlFor="embedding-chunk-size" hint="Max characters per chunk">
                        <Input
                            id="embedding-chunk-size"
                            type="number"
                            min={100}
                            max={5000}
                            step={50}
                            value={config.chunkSize}
                            onChange={(e) =>
                                setConfig((prev) => ({
                                    ...prev,
                                    chunkSize: Math.max(100, parseInt(e.target.value) || 500),
                                }))
                            }
                        />
                    </Field>

                    <Field label="Chunk Overlap" htmlFor="embedding-chunk-overlap" hint="Overlapping characters between chunks">
                        <Input
                            id="embedding-chunk-overlap"
                            type="number"
                            min={0}
                            max={500}
                            step={10}
                            value={config.chunkOverlap}
                            onChange={(e) =>
                                setConfig((prev) => ({
                                    ...prev,
                                    chunkOverlap: Math.max(0, parseInt(e.target.value) || 50),
                                }))
                            }
                        />
                    </Field>
                </div>
            </div>

            {/* Search settings */}
            <div className="mt-6 space-y-4 border-t border-line pt-5">
                <h3 className="text-sm font-medium text-ink">Search</h3>

                <Field
                    label="Top-K Results"
                    htmlFor="embedding-topk"
                    hint="Number of most relevant chunks to retrieve per query (also used for RAG context in chat)"
                >
                    <Input
                        id="embedding-topk"
                        type="number"
                        min={1}
                        max={50}
                        value={config.topk}
                        onChange={(e) =>
                            setConfig((prev) => ({
                                ...prev,
                                topk: Math.max(1, Math.min(50, parseInt(e.target.value) || 5)),
                            }))
                        }
                    />
                </Field>

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                        <label htmlFor="embedding-similarity" className="text-[13px] font-medium text-ink">
                            Similarity Threshold
                        </label>
                        <span className="font-mono text-sm text-ink-secondary">{config.similarityThreshold.toFixed(2)}</span>
                    </div>
                    <input
                        id="embedding-similarity"
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={config.similarityThreshold}
                        onChange={(e) =>
                            setConfig((prev) => ({
                                ...prev,
                                similarityThreshold: parseFloat(e.target.value),
                            }))
                        }
                        className="w-full accent-[var(--ember)]"
                    />
                    <p className="text-xs leading-relaxed text-ink-muted">
                        Minimum cosine similarity score (0–1) for a chunk to be included. Higher = stricter matching, fewer but more relevant results. Default: 0.65
                    </p>
                </div>
            </div>

            {/* Per-provider dimensions */}
            <div className="mt-6 space-y-4 border-t border-line pt-5">
                <h3 className="text-sm font-medium text-ink">Embedding Dimensions</h3>
                <p className="text-xs leading-relaxed text-ink-muted">
                    Set the vector dimension for each provider's embedding model. Must match the model's output size.
                </p>

                <div className="space-y-4">
                    {PROVIDER_KEYS.map((key) => (
                        <Field
                            key={key}
                            label={<span className="capitalize">{key}</span>}
                            htmlFor={`embedding-dimensions-${key}`}
                            hint={DIMENSION_HINTS[key]}
                        >
                            <Input
                                id={`embedding-dimensions-${key}`}
                                type="number"
                                min={64}
                                max={8192}
                                value={config.embeddingDimensions[key]}
                                onChange={(e) =>
                                    setConfig((prev) => ({
                                        ...prev,
                                        embeddingDimensions: {
                                            ...prev.embeddingDimensions,
                                            [key]: Math.max(64, parseInt(e.target.value) || 768),
                                        },
                                    }))
                                }
                            />
                        </Field>
                    ))}
                </div>
            </div>

            {/* Re-embed action */}
            <div className="mt-6 space-y-3 border-t border-line pt-5">
                <div>
                    <h3 className="text-sm font-medium text-ink">Re-embed documents</h3>
                    <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                        Rebuild the vector index for every document. This may take a while depending on the number of documents and embedding provider.
                    </p>
                </div>
                <Button variant="secondary" loading={reembedding} onClick={handleReembed}>
                    Re-embed All Documents
                </Button>
                {reembedding && (
                    <p className="text-xs text-ink-muted" role="status">
                        Re-embedding all documents... This may take a while depending on the number of documents and embedding provider.
                    </p>
                )}
            </div>
        </Card>
    );
}
