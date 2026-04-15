/// <reference path="../../../pb_data/types.d.ts" />

// Admin endpoint to update attachment settings
routerAdd("PATCH", "/api/admin/attachments", (c) => {
	const { requireAdmin, parseRequestBody } = require(`${__hooks}/utils.js`)

	try {
		requireAdmin(c)

		const requestData = parseRequestBody(c)
		const payload = requestData.attachments || requestData

		const maxAttachmentSizeMB = parseInt(payload.maxAttachmentSizeMB, 10)
		const maxAttachments = parseInt(payload.maxAttachments, 10)

		if (!Number.isFinite(maxAttachmentSizeMB) || maxAttachmentSizeMB <= 0 || !Number.isFinite(maxAttachments) || maxAttachments <= 0) {
			return c.json(400, {
				error: "maxAttachmentSizeMB and maxAttachments must be positive integers",
			})
		}

		const collection = $app.findCollectionByNameOrId("documents")
		const attachmentsField = collection?.fields?.getByName("attachments")

		if (!collection || !attachmentsField) {
			throw new BadRequestError("Documents attachments field not found")
		}

		const maxAttachmentSizeBytes = maxAttachmentSizeMB * 1024 * 1024
		attachmentsField.maxSize = maxAttachmentSizeBytes
		attachmentsField.maxSelect = maxAttachments

		$app.save(collection)

		return c.json(200, {
			success: true,
			message: "Attachment settings updated successfully",
			attachments: {
				maxAttachmentSizeBytes,
				maxAttachmentSizeMB,
				maxAttachments,
			},
		})
	} catch (err) {
		console.error("Failed to update attachment settings:", err)
		return c.json(500, { error: "Failed to save attachment settings: " + String(err) })
	}
}, $apis.requireAuth())
