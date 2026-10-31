/**
 * Global settings are shared by every user, so admin-route tests must restore
 * them before the next file runs. The suite normally starts from defaults, but
 * this also keeps `bun run test:integration` against a dev stack non-destructive.
 */

import { expectStatus, pbRequest, readJson } from "./client";

export interface SMTPView {
    enabled: boolean;
    host: string;
    port: number;
    username: string;
    authMethod: string;
    tls: boolean;
    localName: string;
    senderName: string;
    senderAddress: string;
    password: string;
}

export interface AttachmentView {
    maxAttachmentSizeBytes: number;
    maxAttachmentSizeMB: number;
    maxAttachments: number;
}

export interface OAuthProviderView {
    name: string;
    displayName?: string;
    clientId?: string;
    clientSecret?: string;
    authURL?: string;
    tokenURL?: string;
    userInfoURL?: string;
    pkce?: boolean;
}

export interface OAuthView {
    enabled: boolean;
    providers: OAuthProviderView[];
    mappedFields: Record<string, string>;
}

export interface MetaView {
    [key: string]: unknown;
}

export interface AdminSettingsSnapshot {
    smtp: SMTPView;
    attachments: AttachmentView;
    oauth: OAuthView;
    meta: MetaView;
}

async function getJson<T>(path: string, token: string): Promise<T> {
    const res = await pbRequest(path, { headers: { Authorization: token } });
    await expectStatus(res, 200, `GET ${path}`);
    return readJson<T>(res, `GET ${path}`);
}

export async function snapshotAdminSettings(
    adminToken: string,
    superuserToken: string,
): Promise<AdminSettingsSnapshot> {
    const [smtp, attachments, oauth, settings] = await Promise.all([
        getJson<{ smtp: SMTPView }>("/admin/smtp", adminToken),
        getJson<{ attachments: AttachmentView }>("/admin/attachments", adminToken),
        getJson<OAuthView>("/admin/oauth/providers", adminToken),
        getJson<{ meta: MetaView }>("/settings", superuserToken),
    ]);

    return {
        smtp: smtp.smtp,
        attachments: attachments.attachments,
        oauth,
        meta: settings.meta,
    };
}

export async function restoreAdminSettings(
    snapshot: AdminSettingsSnapshot,
    adminToken: string,
    superuserToken: string,
): Promise<void> {
    const smtpRes = await pbRequest("/admin/smtp", {
        method: "PATCH",
        headers: { Authorization: adminToken, "Content-Type": "application/json" },
        body: JSON.stringify({ smtp: snapshot.smtp }),
    });
    await expectStatus(smtpRes, 200, "restore SMTP settings");

    const attachmentsRes = await pbRequest("/admin/attachments", {
        method: "PATCH",
        headers: { Authorization: adminToken, "Content-Type": "application/json" },
        body: JSON.stringify({
            attachments: {
                maxAttachmentSizeMB: snapshot.attachments.maxAttachmentSizeMB,
                maxAttachments: snapshot.attachments.maxAttachments,
            },
        }),
    });
    await expectStatus(attachmentsRes, 200, "restore attachment settings");

    const oauthRes = await pbRequest("/admin/oauth/providers", {
        method: "PATCH",
        headers: { Authorization: adminToken, "Content-Type": "application/json" },
        body: JSON.stringify({
            enabled: snapshot.oauth.enabled,
            providers: snapshot.oauth.providers,
            mappedFields: snapshot.oauth.mappedFields,
        }),
    });
    await expectStatus(oauthRes, 200, "restore OAuth settings");

    const metaRes = await pbRequest("/settings", {
        method: "PATCH",
        headers: { Authorization: superuserToken, "Content-Type": "application/json" },
        body: JSON.stringify({ meta: snapshot.meta }),
    });
    await expectStatus(metaRes, 200, "restore meta settings");
}
