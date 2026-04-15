/// <reference path="../../../pb_data/types.d.ts" />

// Admin endpoint to get attachment settings
routerAdd("GET", "/api/admin/attachments", (c) => {
	const { requireAdmin } = require(`${__hooks}/utils.js`)

	try {
		requireAdmin(c)

		const collection = $app.findCollectionByNameOrId("documents")
		const attachmentsField = collection?.fields?.getByName("attachments")

		if (!collection || !attachmentsField) {
			throw new BadRequestError("Documents attachments field not found")
		}

		const maxAttachmentSizeBytes = attachmentsField.maxSize || 0
		const maxAttachmentSizeMB = maxAttachmentSizeBytes > 0
			? Number((maxAttachmentSizeBytes / (1024 * 1024)).toFixed(2))
			: 0

		return c.json(200, {
			attachments: {
				maxAttachmentSizeBytes,
				maxAttachmentSizeMB,
				maxAttachments: attachmentsField.maxSelect || 1,
			},
		})
	} catch (err) {
		console.error("Failed to load attachment settings:", err)
		return c.json(500, { error: "Failed to load attachment settings: " + String(err) })
	}
}, $apis.requireAuth())
