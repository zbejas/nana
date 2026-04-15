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
    },
};

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
