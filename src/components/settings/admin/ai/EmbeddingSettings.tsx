import { useState, useEffect } from 'react';
import { pb } from '../../../../lib/pocketbase';
import type { RecordModel } from 'pocketbase';
import type { AIProviderKey } from '../../../../lib/ai/types';
import { createLogger } from '../../../../lib/logger';

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

interface EmbeddingSettingsProps {
    onSave: (config: EmbeddingConfig) => Promise<void>;
}

export function EmbeddingSettings({ onSave }: EmbeddingSettingsProps) {
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

            // Also call the parent save handler
            await onSave(config);

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

    const inputClass =
        'w-full rounded-lg border border-white/20 bg-black/30 px-4 py-2.5 text-sm text-white placeholder-gray-500 transition-colors focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/20';
    const selectClass =
        'w-full rounded-lg border border-white/20 bg-black/30 px-4 py-2.5 text-sm text-white transition-colors focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/20';

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="space-y-1">
                <h3 className="text-lg font-semibold text-white">Embedding</h3>
                <p className="text-sm text-gray-400">
                    Configure how documents are chunked and embedded for semantic search and RAG.
                </p>
            </div>

            {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                    <p className="text-sm text-red-400">{error}</p>
                </div>
            )}
            {successMessage && (
                <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3">
                    <p className="text-sm text-green-400">{successMessage}</p>
                </div>
            )}

            {/* Status card */}
            {status && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                            <span className="text-gray-400">Provider:</span>{' '}
                            <span className="text-white font-medium">{status.provider ?? 'None'}</span>
                        </div>
                        <div>
                            <span className="text-gray-400">Model:</span>{' '}
                            <span className="text-white font-medium">{status.embeddingModel ?? 'None'}</span>
                        </div>
                        <div>
                            <span className="text-gray-400">Total vectors:</span>{' '}
                            <span className="text-white font-medium">{status.totalVectors.toLocaleString()}</span>
                        </div>
                        <div>
                            <span className="text-gray-400">Dimensions:</span>{' '}
                            <span className="text-white font-medium">{status.dimensions}</span>
                        </div>
                    </div>
                </div>
            )}

            {/* Auto-embed toggle */}
            <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4">
                <div>
                    <p className="text-sm font-medium text-white">Auto-embed on save</p>
                    <p className="text-xs text-gray-400">
                        Automatically embed documents when they are created or updated
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => setConfig((prev) => ({ ...prev, autoEmbed: !prev.autoEmbed }))}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-white/20 ${config.autoEmbed ? 'bg-green-500' : 'bg-white/20'}`}
                    role="switch"
                    aria-checked={config.autoEmbed}
                >
                    <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition duration-200 ease-in-out ${config.autoEmbed ? 'translate-x-4' : 'translate-x-0'}`}
                    />
                </button>
            </div>

            {/* Chunking settings */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
                <h4 className="text-sm font-semibold text-white">Chunking</h4>

                <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-300">Strategy</label>
                    <select
                        value={config.chunkingStrategy}
                        onChange={(e) =>
                            setConfig((prev) => ({
                                ...prev,
                                chunkingStrategy: e.target.value as ChunkingStrategy,
                            }))
                        }
                        className={selectClass}
                    >
                        {STRATEGY_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    <p className="text-xs text-gray-500">
                        {STRATEGY_OPTIONS.find((s) => s.value === config.chunkingStrategy)?.description}
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <label className="block text-sm font-medium text-gray-300">Chunk Size</label>
                        <input
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
                            className={inputClass}
                        />
                        <p className="text-xs text-gray-500">Max characters per chunk</p>
                    </div>

                    <div className="space-y-1.5">
                        <label className="block text-sm font-medium text-gray-300">Chunk Overlap</label>
                        <input
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
                            className={inputClass}
                        />
                        <p className="text-xs text-gray-500">Overlapping characters between chunks</p>
                    </div>
                </div>
            </div>

            {/* Search settings */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
                <h4 className="text-sm font-semibold text-white">Search</h4>

                <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-gray-300">Top-K Results</label>
                    <input
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
                        className={inputClass}
                    />
                    <p className="text-xs text-gray-500">
                        Number of most relevant chunks to retrieve per query (also used for RAG context in chat)
                    </p>
                </div>

                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label className="block text-sm font-medium text-gray-300">Similarity Threshold</label>
                        <span className="text-sm font-mono text-white/70">{config.similarityThreshold.toFixed(2)}</span>
                    </div>
                    <input
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
                        className="w-full accent-blue-500"
                    />
                    <p className="text-xs text-gray-500">
                        Minimum cosine similarity score (0–1) for a chunk to be included. Higher = stricter matching, fewer but more relevant results. Default: 0.65
                    </p>
                </div>
            </div>

            {/* Per-provider dimensions */}
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
                <h4 className="text-sm font-semibold text-white">Embedding Dimensions</h4>
                <p className="text-xs text-gray-400">
                    Set the vector dimension for each provider's embedding model. Must match the model's output size.
                </p>

                <div className="space-y-3">
                    {PROVIDER_KEYS.map((key) => (
                        <div key={key} className="space-y-1.5">
                            <label className="block text-sm font-medium text-gray-300 capitalize">{key}</label>
                            <input
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
                                className={inputClass}
                            />
                            <p className="text-xs text-gray-500">{DIMENSION_HINTS[key]}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded-lg bg-white/10 px-5 py-2.5 text-sm font-medium text-white hover:bg-white/20 disabled:opacity-50 transition-colors"
                >
                    {saving ? 'Saving...' : 'Save Embedding Settings'}
                </button>

                <button
                    onClick={handleReembed}
                    disabled={reembedding}
                    className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-5 py-2.5 text-sm font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
                >
                    {reembedding ? 'Re-embedding...' : 'Re-embed All Documents'}
                </button>
            </div>

            {reembedding && (
                <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
                    <p className="text-sm text-blue-400">
                        Re-embedding all documents... This may take a while depending on the number of documents and embedding provider.
                    </p>
                </div>
            )}
        </div>
    );
}
