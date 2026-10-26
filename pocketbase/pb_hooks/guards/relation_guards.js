/// <reference path="../../pb_data/types.d.ts" />

// Relation integrity guards. PocketBase evaluates API rules against the stored
// record, so incoming relation values (folder, parent, board, document) need an
// explicit ownership check before the write is accepted.

onRecordCreateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    return e.next();
  }
  const h = require(`${__hooks}/guards/relation_helpers.js`);
  h.assertFolderRelation(e.record, "folder", e.auth.id);
  return e.next();
}, "documents");

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    return e.next();
  }
  const h = require(`${__hooks}/guards/relation_helpers.js`);
  h.assertAuthorUnchanged(e.record);
  h.assertFolderRelation(e.record, "folder", e.auth.id);
  return e.next();
}, "documents");

onRecordCreateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    return e.next();
  }
  const h = require(`${__hooks}/guards/relation_helpers.js`);
  h.assertFolderParent(e.record, e.auth.id);
  return e.next();
}, "folders");

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    return e.next();
  }
  const h = require(`${__hooks}/guards/relation_helpers.js`);
  h.assertAuthorUnchanged(e.record);
  h.assertFolderParent(e.record, e.auth.id);
  return e.next();
}, "folders");

onRecordCreateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    return e.next();
  }
  const h = require(`${__hooks}/guards/relation_helpers.js`);
  h.assertFolderRelation(e.record, "folder", e.auth.id);
  return e.next();
}, "boards");

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    return e.next();
  }
  const h = require(`${__hooks}/guards/relation_helpers.js`);
  h.assertAuthorUnchanged(e.record);
  h.assertFolderRelation(e.record, "folder", e.auth.id);
  return e.next();
}, "boards");

onRecordCreateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    return e.next();
  }
  const h = require(`${__hooks}/guards/relation_helpers.js`);
  h.assertTaskRelations(e.record, e.auth.id);
  return e.next();
}, "tasks");

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    return e.next();
  }
  const h = require(`${__hooks}/guards/relation_helpers.js`);
  h.assertTaskRelations(e.record, e.auth.id);
  return e.next();
}, "tasks");

onRecordUpdateRequest((e) => {
  if (!e.auth || e.hasSuperuserAuth()) {
    return e.next();
  }
  const h = require(`${__hooks}/guards/relation_helpers.js`);
  h.assertAuthorUnchanged(e.record);
  return e.next();
}, "conversations");
