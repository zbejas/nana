/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const settings = app.settings()
  settings.meta = settings.meta || {}
  settings.meta.senderName = settings.meta.senderName == "Support" ? "Nana" : settings.meta.senderName
  settings.meta.senderAddress = settings.meta.senderAddress == "support@example.com" ? "nana@example.com" : settings.meta.senderAddress
  return app.save(settings)
}, (app) => {
  const settings = app.settings()
  settings.meta = settings.meta || {}
  delete settings.meta.senderName
  return app.save(settings)
})
