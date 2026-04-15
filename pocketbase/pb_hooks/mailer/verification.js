/// <reference path="../../pb_data/types.d.ts" />

// Deny sending verification emails by default (e.g. for custom verification flow)
onMailerRecordVerificationSend((e) => {
    return;
})