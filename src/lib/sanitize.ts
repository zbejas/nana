import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { unified } from 'unified';
import rehypeParse from 'rehype-parse';
import rehypeStringify from 'rehype-stringify';
import type { Options as SanitizeSchema } from 'rehype-sanitize';

/**
 * Extended sanitization schema based on GitHub's default.
 * Allows the custom `iso` and `docname` tags used in preview fallbacks,
 * and permits `class` attributes for syntax highlighting.
 */
export const sanitizeSchema: SanitizeSchema = {
    ...defaultSchema,
    tagNames: [
        ...(defaultSchema.tagNames || []),
        'iso',
        'docname',
    ],
    attributes: {
        ...defaultSchema.attributes,
        // Allow className on code/span for syntax highlighting
        code: [
            ...(defaultSchema.attributes?.code || []),
            ['className', /^language-./],
        ],
        span: [
            ...(defaultSchema.attributes?.span || []),
            ['className', /^(hljs|token|language-)/],
        ],
        // Allow className on div/p for GitHub-style alerts (> [!NOTE], etc.).
        // remark-github-blockquote-alert emits the older `class` property, so
        // accept both names before the normalizer turns it into className.
        div: [
            ...(defaultSchema.attributes?.div || []),
            ['className', /^markdown-alert/],
            ['class', /^markdown-alert/],
        ],
        p: [
            ...(defaultSchema.attributes?.p || []),
            ['className', /^markdown-alert/],
            ['class', /^markdown-alert/],
        ],
    },
};

interface HastNode {
    type?: string;
    properties?: Record<string, unknown>;
    children?: HastNode[];
}

/**
 * remark-github-blockquote-alert writes the HAST property `class` instead of
 * the usual `className`. Normalize it before sanitization so the alert keeps
 * its modifiers and React receives a standard className.
 */
export function rehypeNormalizeAlertClasses() {
    return (tree: unknown) => {
        const walk = (node: HastNode) => {
            const value = node.properties?.class;
            if (
                typeof value === 'string'
                && value.includes('markdown-alert')
                && node.properties
            ) {
                node.properties.className = value.split(/\s+/).filter(Boolean);
                delete node.properties.class;
            }
            node.children?.forEach(walk);
        };
        walk(tree as HastNode);
    };
}

/**
 * The rehype-sanitize plugin pre-bound with our schema, for use as a
 * rehype plugin in markdown renderers.
 *
 * Usage:
 *   rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
 *   // or simply:
 *   rehypePlugins={[rehypeSanitizePlugin]}
 */
export const rehypeSanitizePlugin: [typeof rehypeSanitize, SanitizeSchema] = [
    rehypeSanitize,
    sanitizeSchema,
];

/**
 * Sanitize an HTML string by stripping dangerous elements and attributes.
 * Used server-side before persisting content to PocketBase.
 *
 * This treats the input as an HTML fragment, sanitizes it, and returns
 * the cleaned HTML string. For pure markdown (no raw HTML), the string
 * passes through largely unchanged.
 */
export async function sanitizeHtml(html: string): Promise<string> {
    const file = await unified()
        .use(rehypeParse, { fragment: true })
        .use(rehypeSanitize, sanitizeSchema)
        .use(rehypeStringify)
        .process(html);

    return String(file);
}
