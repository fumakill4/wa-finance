const fs = require('fs');
const path = require('path');
const { Storage } = require('@google-cloud/storage');

const bucketName = process.env.WHATSAPP_SESSION_BUCKET || 'wa-finance-bot-i729-whatsapp-sessions-221382634245';
let storage;

function enabled() {
    return String(process.env.SESSION_CLOUD_SYNC_ENABLED || '').toLowerCase() === 'true';
}

function bucket() {
    if (!storage) storage = new Storage();
    return storage.bucket(bucketName);
}

function prefix(userId) {
    return `whatsapp-sessions/${encodeURIComponent(userId)}/`;
}

function listLocalFiles(directory, current = directory) {
    if (!fs.existsSync(current)) return [];
    return fs.readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(current, entry.name);
        return entry.isDirectory() ? listLocalFiles(directory, fullPath) : [{ fullPath, relative: path.relative(directory, fullPath) }];
    });
}

async function restoreSession(userId, sessionPath) {
    if (!enabled()) return false;
    const [files] = await bucket().getFiles({ prefix: prefix(userId) });
    if (!files.length) return false;
    await Promise.all(files.map(async (file) => {
        const relative = file.name.slice(prefix(userId).length);
        const target = path.resolve(sessionPath, relative);
        if (!target.startsWith(path.resolve(sessionPath) + path.sep)) throw new Error('Invalid session object path');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        await file.download({ destination: target });
    }));
    console.log(`[${userId}] WhatsApp session restored from Cloud Storage`);
    return true;
}

const lastBackupMtimes = new Map();

async function backupSession(userId, sessionPath) {
    if (!enabled()) return;
    const files = listLocalFiles(sessionPath);
    if (!files.length) return;

    let userMtimeMap = lastBackupMtimes.get(userId);
    if (!userMtimeMap) {
        userMtimeMap = new Map();
        lastBackupMtimes.set(userId, userMtimeMap);
    }

    const modifiedFiles = files.filter(({ fullPath, relative }) => {
        try {
            const stat = fs.statSync(fullPath);
            const prev = userMtimeMap.get(relative);
            if (prev === stat.mtimeMs) return false;
            userMtimeMap.set(relative, stat.mtimeMs);
            return true;
        } catch (_) {
            return true;
        }
    });

    if (!modifiedFiles.length) return;

    const concurrency = 4;
    let uploadedCount = 0;
    for (let i = 0; i < modifiedFiles.length; i += concurrency) {
        const chunk = modifiedFiles.slice(i, i + concurrency);
        await Promise.all(chunk.map(async ({ fullPath, relative }) => {
            try {
                await bucket().upload(fullPath, {
                    destination: `${prefix(userId)}${relative}`,
                    resumable: false,
                });
                uploadedCount++;
            } catch (err) {
                console.warn(`[${userId}] Failed to backup session file ${relative}: ${err.message}`);
            }
        }));
    }

    if (uploadedCount > 0) {
        console.log(`[${userId}] WhatsApp session backed up (${uploadedCount} updated file(s)) to Cloud Storage`);
    }
}

async function deleteStoredSession(userId) {
    if (!enabled()) return;
    const [files] = await bucket().getFiles({ prefix: prefix(userId) });
    await Promise.all(files.map((file) => file.delete()));
}

async function listStoredSessionUserIds() {
    if (!enabled()) return [];
    const [files] = await bucket().getFiles({ prefix: 'whatsapp-sessions/' });
    const userIds = new Set();
    files.forEach((file) => {
        const [, encodedUserId] = file.name.split('/');
        if (encodedUserId) userIds.add(decodeURIComponent(encodedUserId));
    });
    return [...userIds];
}

async function listStoredPhoneSessionJids(userId) {
    if (!enabled()) return [];
    const [files] = await bucket().getFiles({ prefix: prefix(userId) });
    const phoneUsers = new Set();
    files.forEach((file) => {
        const relative = file.name.slice(prefix(userId).length);
        const match = relative.match(/^session-(\d+)\.\d+\.json$/);
        if (match?.[1] && /^62\d{8,14}$/.test(match[1])) {
            phoneUsers.add(match[1]);
        }
    });
    return [...phoneUsers].map((phone) => `${phone}@s.whatsapp.net`);
}

module.exports = { restoreSession, backupSession, deleteStoredSession, listStoredSessionUserIds, listStoredPhoneSessionJids };
