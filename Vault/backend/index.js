// This App was build by i729 - Fumakill4
/**
 * WA Finance Gateway Platform
 * @copyright 2026 WA Finance App created by i729
 */
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initSession, getSessionStatus, deleteSession, resumeStoredSessions } = require('./waService');
const db = require('./db');
const { DEFAULT_AI_MODEL, normalizeAiModel } = require('./aiModels');
const { getAdminAuth, getAdminFirestore } = require('./firebaseAdmin');
const { getUserSettings, saveUserSettings } = require('./settingsStore');
const {
    addCategoryItem,
    createCategory,
    deleteCategory,
    deleteCategoryItem,
    listCategories,
    updateCategory,
} = require('./categoryRules');
const { EXCEL_MIME, createWorkbook } = require('./excelReport');
const { FieldValue } = require('firebase-admin/firestore');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 5000;
const INTERNAL_ADMIN_TOKEN = process.env.INTERNAL_ADMIN_TOKEN || '';

const { createAuthenticate, validUserId, tokenMatches, isAllowedEndpoint, fetchAppsScript } = require('./http-security');
const authenticate = createAuthenticate((token, revoked) => getAdminAuth().verifyIdToken(token, revoked));

const authenticateInternal = (req, res, next) => {
    const token = req.headers['x-internal-token'] || '';
    if (!tokenMatches(INTERNAL_ADMIN_TOKEN, token)) {
        return res.status(401).json({ error: 'Internal token tidak valid.' });
    }
    next();
};

function publicSettings(settings) {
    const hasAppsScriptUrl = Boolean(settings.apps_script_url);
    const appsScriptStatus = hasAppsScriptUrl
        ? (settings.apps_script_status && settings.apps_script_status !== 'not_configured' ? settings.apps_script_status : 'configured')
        : 'not_configured';
    const jidDisplayMappings = Object.fromEntries(
        Object.entries(settings.jid_mappings || {})
            .map(([lidJid, targetJid]) => {
                const phone = String(targetJid || '').split('@')[0].replace(/\D/g, '');
                return [String(lidJid || '').toLowerCase(), phone];
            })
            .filter(([lidJid, phone]) => lidJid.endsWith('@lid') && phone)
    );

    return {
        apps_script_url: settings.apps_script_url || '',
        groq_api_key: settings.groq_key ? '••••••••••••••••' : '',
        has_groq_api_key: Boolean(settings.groq_key),
        spreadsheet_id: settings.spreadsheet_id || '',
        ai_model: normalizeAiModel(settings.ai_model),
        system_prompt: settings.system_prompt || '',
        apps_script_status: appsScriptStatus,
        apps_script_last_tested_at: settings.apps_script_last_tested_at || null,
        apps_script_last_status: settings.apps_script_last_status || null,
        apps_script_last_preview: settings.apps_script_last_preview || '',
        monthly_budget: Number(settings.monthly_budget || 0),
        budget_alert_thresholds: Array.isArray(settings.budget_alert_thresholds) && settings.budget_alert_thresholds.length
            ? settings.budget_alert_thresholds
            : [80, 90, 95, 100],
        budget_alert_month: settings.budget_alert_month || '',
        budget_alert_levels: Array.isArray(settings.budget_alert_levels) ? settings.budget_alert_levels : [],
        active_recap_id: settings.active_recap_id || '',
        active_recap_name: settings.active_recap_name || 'Periode Aktif',
        active_recap_start_date: settings.active_recap_start_date || '',
        wallets: Array.isArray(settings.wallets) ? settings.wallets : [],
        deleted_wallets: Array.isArray(settings.deleted_wallets) ? settings.deleted_wallets : [],
        primary_wallet: settings.primary_wallet || '',
        category_budgets: Array.isArray(settings.category_budgets) ? settings.category_budgets : [],
        deleted_categories: Array.isArray(settings.deleted_categories) ? settings.deleted_categories : [],
        settings_updated_at: settings.settings_updated_at || null,
        jid_display_mappings: jidDisplayMappings,
    };
}

function sanitizeBudgetThresholds(value) {
    const raw = Array.isArray(value) ? value : [80, 90, 95, 100];
    const next = raw
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0 && item <= 200)
        .sort((a, b) => a - b);
    return [...new Set(next)].length ? [...new Set(next)] : [80, 90, 95, 100];
}


async function callAppsScript(endpoint, userId) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetchAppsScript(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session: userId, from: 'dashboard', body: 'ping', command: 'ping' }),
            signal: controller.signal,
        });
        const responseText = await response.text();
        if (!response.ok) throw new Error(`Apps Script mengembalikan HTTP ${response.status}.`);
        return { status: response.status, preview: responseText.slice(0, 240) };
    } finally {
        clearTimeout(timeout);
    }
}

async function postAppsScript(endpoint, payload, timeoutMs = 45000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchAppsScript(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });
        const responseText = await response.text();
        if (!response.ok) throw new Error(`Apps Script mengembalikan HTTP ${response.status}.`);
        return responseText;
    } finally {
        clearTimeout(timeout);
    }
}

function safeRecapName(value) {
    const fallback = new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    return String(value || fallback).trim().replace(/\s+/g, ' ').slice(0, 80) || fallback;
}

function dateInputValue(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return dateInputValue(new Date());
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function makeRecapId() {
    const now = new Date();
    const stamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    return `recap_${stamp}_${randomSuffix}`;
}

async function archiveFirestoreCollection(userId, collectionName, recap) {
    if (String(process.env.FIRESTORE_SYNC_ENABLED || '').toLowerCase() !== 'true') {
        return 0;
    }
    const collectionRef = getAdminFirestore().collection('users').doc(userId).collection(collectionName);
    const snapshot = await collectionRef.get();
    let batch = getAdminFirestore().batch();
    let pending = 0;
    let count = 0;

    for (const docItem of snapshot.docs) {
        const data = docItem.data();
        const status = String(data.status || '').toLowerCase();
        const recapStatus = String(data.recap_status || 'active').toLowerCase();
        if (['cancelled', 'canceled', 'dibatalkan'].includes(status)) continue;
        if (recapStatus === 'archived') continue;

        if (collectionName === 'expenses') {
            const cat = String(data.category || '').toLowerCase();
            const type = String(data.type || '').toLowerCase();
            if (type === 'savings' || cat.includes('tabung') || cat.includes('invest')) {
                // Preserve Tabungan & Investasi active across period close as requested
                continue;
            }
        }

        batch.update(docItem.ref, {
            recap_id: recap.id,
            recap_name: recap.name,
            recap_status: 'archived',
            archivedAt: FieldValue.serverTimestamp(),
        });
        pending += 1;
        count += 1;

        if (pending >= 400) {
            await batch.commit();
            batch = getAdminFirestore().batch();
            pending = 0;
        }
    }

    if (pending) await batch.commit();
    return count;
}

function activeStatusWhere() {
    return `LOWER(COALESCE(status, 'saved')) NOT IN ('cancelled', 'canceled', 'dibatalkan', 'batal')`;
}

function normalizeExpenseRow(row) {
    if (!row) return row;
    const created = row.created_at || row.date || new Date().toISOString();
    return {
        ...row,
        id: String(row.id),
        amount: Number(row.amount || 0),
        createdAt: created,
        timestamp: created,
    };
}

function recapWhereClause(recapId = 'active') {
    if (recapId === 'all') return { sql: '', params: [] };
    if (recapId && recapId !== 'active') return { sql: 'AND recap_id = ?', params: [recapId] };
    return { sql: "AND COALESCE(recap_status, 'active') != 'archived'", params: [] };
}

app.get('/api/health', (req, res) => {
    const publicDir = path.join(__dirname, 'public');
    const staticAssets = fs.existsSync(publicDir)
        ? fs.readdirSync(publicDir, { recursive: true })
            .filter((item) => String(item).startsWith('assets/index-'))
            .sort()
        : [];
    res.json({
        status: 'ok',
        mode: 'multi-user',
        revision: process.env.K_REVISION || 'local',
        staticAssets,
    });
});

app.get('/api/settings', authenticate, async (req, res) => {
    try {
        res.json(publicSettings(await getUserSettings(req.userId)));
    } catch (error) {
        console.error('Settings read error:', error.message);
        res.status(500).json({ error: 'Pengaturan tidak dapat dibaca dari penyimpanan aman.' });
    }
});

app.put('/api/settings', authenticate, async (req, res) => {
    const body = req.body || {};
    const appsScriptUrl = String(body.apps_script_url || '').trim();

    if (!isAllowedEndpoint(appsScriptUrl)) {
        return res.status(400).json({ error: 'Web App Endpoint URL harus berupa URL HTTPS yang valid.' });
    }

    try {
        const incomingGroqKey = String(body.groq_api_key || '').trim();
        const current = await getUserSettings(req.userId);
        const nextSpreadsheetId = String(body.spreadsheet_id || '').trim() || undefined;
        const monthlyBudget = body.monthly_budget === undefined
            ? undefined
            : Math.max(0, Math.round(Number(body.monthly_budget || 0)));
        const budgetChanged = monthlyBudget !== undefined && Number(current.monthly_budget || 0) !== monthlyBudget;
        const connectionChanged = current.apps_script_url !== appsScriptUrl || current.spreadsheet_id !== nextSpreadsheetId;
        const passthroughSettings = {};
        ['wallets', 'deleted_wallets', 'primary_wallet', 'category_budgets', 'deleted_categories'].forEach((key) => {
            if (body[key] !== undefined) passthroughSettings[key] = body[key];
        });
        const saved = await saveUserSettings(req.userId, {
            ...passthroughSettings,
            apps_script_url: appsScriptUrl,
            groq_key: incomingGroqKey && !incomingGroqKey.includes('••••') ? incomingGroqKey : undefined,
            spreadsheet_id: nextSpreadsheetId,
            ai_model: normalizeAiModel(body.ai_model || DEFAULT_AI_MODEL),
            system_prompt: String(body.system_prompt || '').trim() || undefined,
            monthly_budget: monthlyBudget,
            budget_alert_thresholds: body.budget_alert_thresholds === undefined ? undefined : sanitizeBudgetThresholds(body.budget_alert_thresholds),
            budget_alert_month: budgetChanged ? '' : undefined,
            budget_alert_levels: budgetChanged ? [] : undefined,
            apps_script_status: appsScriptUrl ? (connectionChanged ? 'configured' : current.apps_script_status) : 'not_configured',
            apps_script_last_tested_at: connectionChanged ? null : current.apps_script_last_tested_at,
            apps_script_last_status: connectionChanged ? null : current.apps_script_last_status,
            apps_script_last_preview: connectionChanged ? '' : current.apps_script_last_preview,
        });

        // Sinkronisasi saldo dompet ke tabel balances untuk bot WhatsApp
        if (body.wallets && Array.isArray(body.wallets)) {
            for (const w of body.wallets) {
                if (w.name && (w.balance !== undefined || w.initial_balance !== undefined)) {
                    const amt = Math.max(0, Math.round(Number(w.balance ?? w.initial_balance ?? 0)));
                    db.prepare(`
                        INSERT INTO balances (user_id, payment_channel, manual_balance, last_updated)
                        VALUES (?, ?, ?, datetime('now', 'localtime'))
                    `).run(req.userId, w.name.toUpperCase(), amt);
                }
            }
        }

        res.json({ message: 'Settings saved.', settings: publicSettings(saved) });
    } catch (error) {
        console.error('Settings save error:', error.message);
        res.status(500).json({ error: 'Pengaturan tidak dapat disimpan ke penyimpanan aman.' });
    }
});

app.put('/api/settings/budget', authenticate, async (req, res) => {
    try {
        const monthlyBudget = Math.max(0, Math.round(Number(req.body?.monthly_budget || 0)));
        const current = await getUserSettings(req.userId);
        const budgetChanged = Number(current.monthly_budget || 0) !== monthlyBudget;
        const saved = await saveUserSettings(req.userId, {
            monthly_budget: monthlyBudget,
            budget_alert_thresholds: req.body?.budget_alert_thresholds === undefined
                ? undefined
                : sanitizeBudgetThresholds(req.body.budget_alert_thresholds),
            budget_alert_month: budgetChanged ? '' : undefined,
            budget_alert_levels: budgetChanged ? [] : undefined,
        });
        res.json({ message: 'Monthly budget saved.', settings: publicSettings(saved) });
    } catch (error) {
        console.error('Budget settings save error:', error.message);
        res.status(500).json({ error: 'Monthly budget tidak dapat disimpan.' });
    }
});

app.post('/api/apps-script/test', authenticate, async (req, res) => {
    const settings = await getUserSettings(req.userId);
    const endpoint = String(req.body?.apps_script_url || settings.apps_script_url || '').trim();
    if (!isAllowedEndpoint(endpoint) || !endpoint) {
        return res.status(400).json({ error: 'Masukkan Web App Endpoint URL yang valid terlebih dahulu.' });
    }

    try {
        const result = await callAppsScript(endpoint, req.userId);
        const saved = await saveUserSettings(req.userId, {
            apps_script_url: endpoint,
            apps_script_status: 'connected',
            apps_script_last_tested_at: new Date().toISOString(),
            apps_script_last_status: result.status,
            apps_script_last_preview: result.preview,
        });
        res.json({ connected: true, ...result, settings: publicSettings(saved) });
    } catch (error) {
        const message = error.name === 'AbortError' ? 'Koneksi Apps Script melebihi batas waktu 10 detik.' : error.message;
        await saveUserSettings(req.userId, {
            apps_script_url: endpoint,
            apps_script_status: 'error',
            apps_script_last_tested_at: new Date().toISOString(),
            apps_script_last_status: null,
            apps_script_last_preview: message,
        }).catch((saveError) => console.error('Failed to persist Apps Script test failure:', saveError.message));
        res.status(502).json({ connected: false, error: message });
    }
});

app.get('/api/categories', authenticate, (req, res) => {
    try {
        res.json({ categories: listCategories(req.userId) });
    } catch (error) {
        console.error('Category list error:', error.message);
        res.status(500).json({ error: 'Kategori tidak dapat dibaca.' });
    }
});

app.post('/api/categories', authenticate, (req, res) => {
    try {
        const category = createCategory(req.userId, req.body || {});
        res.status(201).json({ category });
    } catch (error) {
        console.error('Category create error:', error.message);
        res.status(400).json({ error: error.message || 'Kategori tidak dapat dibuat.' });
    }
});

app.put('/api/categories/:id', authenticate, (req, res) => {
    try {
        const category = updateCategory(req.userId, Number(req.params.id), req.body || {});
        res.json({ category });
    } catch (error) {
        console.error('Category update error:', error.message);
        res.status(400).json({ error: error.message || 'Kategori tidak dapat diperbarui.' });
    }
});

app.delete('/api/categories/:id', authenticate, (req, res) => {
    try {
        const category = deleteCategory(req.userId, Number(req.params.id));
        res.json({ category });
    } catch (error) {
        console.error('Category delete error:', error.message);
        res.status(400).json({ error: error.message || 'Kategori tidak dapat dinonaktifkan.' });
    }
});

app.post('/api/categories/:id/items', authenticate, (req, res) => {
    try {
        const category = addCategoryItem(req.userId, Number(req.params.id), req.body?.keyword);
        res.status(201).json({ category });
    } catch (error) {
        console.error('Category item create error:', error.message);
        res.status(400).json({ error: error.message || 'Item kategori tidak dapat dibuat.' });
    }
});

app.delete('/api/categories/:categoryId/items/:itemId', authenticate, (req, res) => {
    try {
        const category = deleteCategoryItem(req.userId, Number(req.params.itemId));
        res.json({ category });
    } catch (error) {
        console.error('Category item delete error:', error.message);
        res.status(400).json({ error: error.message || 'Item kategori tidak dapat dihapus.' });
    }
});

app.get('/api/reports/excel', authenticate, async (req, res) => {
    try {
        const report = await createWorkbook(req.userId, {
            recapId: String(req.query?.recapId || 'active'),
            startDate: String(req.query?.startDate || ''),
            endDate: String(req.query?.endDate || ''),
            type: String(req.query?.type || 'all'),
            category: String(req.query?.category || 'all'),
            search: String(req.query?.search || ''),
        });
        res.setHeader('Content-Type', EXCEL_MIME);
        res.setHeader('Content-Disposition', `attachment; filename="${report.fileName}"`);
        res.setHeader('Cache-Control', 'no-store');
        res.send(report.buffer);
    } catch (error) {
        console.error('Excel report export error:', error.message);
        res.status(500).json({ error: error.message || 'Laporan Excel tidak dapat dibuat.' });
    }
});

app.post('/api/whatsapp/connect', authenticate, async (req, res) => {
    try {
        await initSession(req.userId);
        res.json({ message: 'Session initialization started' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to initialize session' });
    }
});

app.get('/api/whatsapp/status', authenticate, (req, res) => {
    const status = getSessionStatus(req.userId);
    res.json(status);
});

app.delete('/api/whatsapp/disconnect', authenticate, (req, res) => {
    const result = deleteSession(req.userId);
    res.json(result);
});

app.post('/api/internal/whatsapp/connect', authenticateInternal, async (req, res) => {
    const userId = String(req.body?.userId || '').trim();
    if (!validUserId(userId)) return res.status(400).json({ error: 'userId wajib diisi.' });
    try {
        await initSession(userId);
        res.json({ message: 'Session initialization started', userId });
    } catch (error) {
        console.error('Internal WA connect error:', error.message);
        res.status(500).json({ error: error.message || 'Failed to initialize session' });
    }
});

app.get('/api/internal/whatsapp/status', authenticateInternal, (req, res) => {
    const userId = String(req.query?.userId || '').trim();
    if (!validUserId(userId)) return res.status(400).json({ error: 'userId wajib diisi.' });
    res.json(getSessionStatus(userId));
});

app.delete('/api/internal/whatsapp/session', authenticateInternal, (req, res) => {
    const userId = String(req.body?.userId || '').trim();
    if (!validUserId(userId)) return res.status(400).json({ error: 'userId wajib diisi.' });
    res.json(deleteSession(userId));
});

app.post('/api/whatsapp/send', authenticate, async (req, res) => {
    const { to, message } = req.body || {};
    if (!to || !message) return res.status(400).json({ error: 'Field "to" dan "message" wajib diisi.' });

    const { sendDirectMessage } = require('./waService');
    try {
        await sendDirectMessage(req.userId, to, message);
        res.json({ success: true, message: 'Pesan berhasil dikirim.' });
    } catch (error) {
        console.error('Send message error:', error.message);
        res.status(500).json({ error: error.message || 'Gagal mengirim pesan.' });
    }
});

app.put('/api/jid-mappings', authenticate, async (req, res) => {
    const lidJid = String(req.body?.lid_jid || '').trim();
    const phoneNumber = String(req.body?.phone_number || '').replace(/\D/g, '');

    if (!lidJid.endsWith('@lid')) {
        return res.status(400).json({ error: 'Mapping hanya diperlukan untuk chat @lid.' });
    }

    if (!/^\d{8,15}$/.test(phoneNumber)) {
        return res.status(400).json({ error: 'Nomor harus format internasional tanpa tanda +, contoh 639123456789 atau 6281234567890.' });
    }

    try {
        const current = await getUserSettings(req.userId);
        const targetJid = `${phoneNumber}@s.whatsapp.net`;
        const jidMappings = {
            ...(current.jid_mappings || {}),
            [lidJid]: targetJid,
        };
        await saveUserSettings(req.userId, { jid_mappings: jidMappings });
        res.json({
            success: true,
            lid_jid: lidJid,
            target_jid: targetJid.replace(/^(\d{2})\d+(\d{3})@/, '$1***$2@'),
        });
    } catch (error) {
        console.error('JID mapping save error:', error.message);
        res.status(500).json({ error: 'Mapping nomor pengirim gagal disimpan.' });
    }
});

app.get('/api/recaps', authenticate, (req, res) => {
    try {
        const recaps = db.prepare(`
            SELECT *
            FROM recap_periods
            WHERE user_id = ?
            ORDER BY closed_at DESC
        `).all(req.userId);
        res.json({ recaps });
    } catch (error) {
        console.error('Recap list error:', error.message);
        res.status(500).json({ error: 'Riwayat recap tidak dapat dibaca.' });
    }
});

app.post('/api/recaps/new', authenticate, async (req, res) => {
    const settings = await getUserSettings(req.userId);
    const endpoint = String(settings.apps_script_url || '').trim();
    const spreadsheetId = String(settings.spreadsheet_id || '').trim();
    const recapId = makeRecapId();
    const activeName = safeRecapName(req.body?.name || 'Periode Baru');
    const recapName = safeRecapName(req.body?.archive_name || `Arsip sebelum ${activeName}`);
    const startDate = dateInputValue(req.body?.archive_start_date || settings.active_recap_start_date || req.body?.start_date || new Date());
    const closedAt = new Date().toISOString();
    const recap = { id: recapId, name: recapName, start_date: startDate };

    let sheetReply = 'Backup native server berhasil';
    if (endpoint && spreadsheetId) {
        try {
            sheetReply = await postAppsScript(endpoint, {
                command: 'new_recap',
                session: req.userId,
                from: 'dashboard',
                body: 'new recap',
                recap_id: recapId,
                recap_name: recapName,
                active_recap_name: activeName,
                start_date: startDate,
                closed_at: closedAt,
                spreadsheet_id: spreadsheetId,
            }, 60000);
        } catch (error) {
            console.warn('Apps Script sync skipped or failed during recap:', error.message);
        }
    }

    const activeWhere = activeStatusWhere();
    const summary = db.prepare(`
        SELECT
            COUNT(*) as expense_count,
            SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
            SUM(CASE WHEN type != 'income' OR type IS NULL THEN amount ELSE 0 END) as total_expense
        FROM expenses
        WHERE user_id = ?
          AND ${activeWhere}
          AND COALESCE(recap_status, 'active') != 'archived'
    `).get(req.userId);
    const conversationSummary = db.prepare(`
        SELECT COUNT(*) as conversation_count
        FROM conversations
        WHERE user_id = ?
          AND COALESCE(recap_status, 'active') != 'archived'
    `).get(req.userId);

    try {
        const archivedExpenses = await archiveFirestoreCollection(req.userId, 'expenses', recap);
        const archivedConversations = await archiveFirestoreCollection(req.userId, 'conversations', recap);

        const tx = db.transaction(() => {
            db.prepare(`
                UPDATE expenses
                SET recap_id = ?,
                    recap_name = ?,
                    recap_status = 'archived',
                    archived_at = datetime('now', 'localtime')
                WHERE user_id = ?
                  AND LOWER(COALESCE(type, '')) != 'savings'
                  AND LOWER(COALESCE(category, '')) NOT LIKE '%tabung%'
                  AND LOWER(COALESCE(category, '')) NOT LIKE '%invest%'
                  AND COALESCE(recap_status, 'active') != 'archived'
            `).run(recapId, recapName, req.userId);

            db.prepare(`
                UPDATE conversations
                SET recap_id = ?,
                    recap_name = ?,
                    recap_status = 'archived',
                    archived_at = datetime('now', 'localtime')
                WHERE user_id = ?
                  AND COALESCE(recap_status, 'active') != 'archived'
            `).run(recapId, recapName, req.userId);

            db.prepare(`
                INSERT OR REPLACE INTO recap_periods
                    (id, user_id, name, start_date, expense_count, conversation_count, total_income, total_expense, sheet_result)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                recapId,
                req.userId,
                recapName,
                startDate,
                Number(summary?.expense_count || archivedExpenses || 0),
                Number(conversationSummary?.conversation_count || archivedConversations || 0),
                Number(summary?.total_income || 0),
                Number(summary?.total_expense || 0),
                String(sheetReply || '').slice(0, 1000)
            );
        });
        tx();

        // 1. Ambil list wallets dan input initial_balances dari client (jika ada)
        const incomingBalances = req.body?.initial_balances || {};
        const currentWallets = Array.isArray(settings.wallets) ? settings.wallets : [];
        const resetWallets = currentWallets.map((w) => {
            const rawVal = incomingBalances[w.name] ?? incomingBalances[w.id];
            const customBal = rawVal !== undefined && rawVal !== '' ? Math.max(0, Math.round(Number(rawVal) || 0)) : 0;
            return {
                ...w,
                initial_balance: customBal,
            };
        });

        // 2. Kosongkan saldo lama di tabel balances WhatsApp, dan isi saldo baru (jika ada input manual > 0)
        db.prepare('DELETE FROM balances WHERE user_id = ?').run(req.userId);
        for (const w of resetWallets) {
            if (w.name && w.initial_balance > 0) {
                db.prepare(`
                    INSERT INTO balances (user_id, payment_channel, manual_balance, last_updated)
                    VALUES (?, ?, ?, datetime('now', 'localtime'))
                `).run(req.userId, w.name.toUpperCase(), w.initial_balance);
            }
        }

        const savedSettings = await saveUserSettings(req.userId, {
            active_recap_id: '',
            active_recap_name: activeName,
            active_recap_start_date: startDate,
            monthly_budget: 0,
            budget_alert_month: '',
            budget_alert_levels: [],
            wallets: resetWallets,
        });

        res.json({
            success: true,
            recap: {
                id: recapId,
                name: recapName,
                active_name: activeName,
                start_date: startDate,
                expense_count: Number(summary?.expense_count || archivedExpenses || 0),
                conversation_count: Number(conversationSummary?.conversation_count || archivedConversations || 0),
                total_income: Number(summary?.total_income || 0),
                total_expense: Number(summary?.total_expense || 0),
            },
            settings: publicSettings(savedSettings),
            sheet_reply: sheetReply,
        });
    } catch (error) {
        console.error('New recap archive error:', error.message);
        res.status(500).json({ error: 'Sheet sudah dibackup, tapi archive webapp gagal. Jangan klik ulang sebelum dicek manual.' });
    }
});

// REST ENDPOINTS

app.get('/api/expenses', authenticate, (req, res) => {
    const recap = recapWhereClause(String(req.query?.recapId || 'active'));
    const expenses = db.prepare(`
        SELECT * FROM expenses
        WHERE user_id = ? AND ${activeStatusWhere()}
          ${recap.sql}
        ORDER BY created_at DESC
    `).all(req.userId, ...recap.params);
    res.json(expenses.map(normalizeExpenseRow));
});

app.post('/api/expenses', authenticate, async (req, res) => {
    const body = req.body || {};
    const settings = await getUserSettings(req.userId).catch(() => ({}));
    const merchant = String(body.merchant || body.description || '').trim();
    const amount = Math.round(Number(body.amount || 0));
    if (!merchant) return res.status(400).json({ error: 'Deskripsi transaksi wajib diisi.' });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Nominal transaksi tidak valid.' });

    const result = db.prepare(`
        INSERT INTO expenses (
            user_id, phone_number, merchant, category, amount, date, confidence,
            payment_channel, type, status, source, source_message_id,
            recap_id, recap_name, recap_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run(
        req.userId,
        String(body.phone_number || 'manual').trim(),
        merchant,
        String(body.category || 'Lainnya').trim() || 'Lainnya',
        amount,
        String(body.date || dateInputValue(new Date())).trim(),
        String(body.confidence || 'Manual').trim(),
        String(body.payment_channel || 'Cash').trim() || 'Cash',
        String(body.type || 'expense').toLowerCase() === 'income' ? 'income' : 'expense',
        String(body.status || 'Saved').trim() || 'Saved',
        String(body.source || 'Manual').trim() || 'Manual',
        body.source_message_id ? String(body.source_message_id).trim() : null,
        settings.active_recap_id || null,
        settings.active_recap_name || null,
        'active'
    );

    const row = db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, req.userId);
    res.status(201).json(normalizeExpenseRow(row));
});

app.put('/api/expenses/:id', authenticate, (req, res) => {
    const current = db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
    if (!current) {
        const probe = db.prepare('SELECT id, user_id FROM expenses WHERE id = ?').get(req.params.id);
        if (probe) {
            console.warn(`[SECURITY AUDIT - BOLA PROBE DETECTED] User ${req.userId} attempted to modify expense ${req.params.id} belonging to user ${probe.user_id}`);
        }
        return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
    }
    const body = req.body || {};
    const next = {
        merchant: body.merchant !== undefined ? String(body.merchant || '').trim() : current.merchant,
        category: body.category !== undefined ? String(body.category || 'Lainnya').trim() : current.category,
        amount: body.amount !== undefined ? Math.round(Number(body.amount || 0)) : Number(current.amount || 0),
        date: body.date !== undefined ? String(body.date || '').trim() : current.date,
        payment_channel: body.payment_channel !== undefined ? String(body.payment_channel || 'Cash').trim() : current.payment_channel,
        type: body.type !== undefined ? (String(body.type).toLowerCase() === 'income' ? 'income' : 'expense') : current.type,
        status: body.status !== undefined ? String(body.status || 'Saved').trim() : current.status,
    };
    if (!next.merchant) return res.status(400).json({ error: 'Deskripsi transaksi wajib diisi.' });
    if (!Number.isFinite(next.amount) || next.amount <= 0) return res.status(400).json({ error: 'Nominal transaksi tidak valid.' });
    db.prepare(`
        UPDATE expenses
        SET merchant = ?, category = ?, amount = ?, date = ?, payment_channel = ?, type = ?, status = ?
        WHERE id = ? AND user_id = ?
    `).run(
        next.merchant,
        next.category || 'Lainnya',
        next.amount,
        next.date || dateInputValue(new Date()),
        next.payment_channel || 'Cash',
        next.type,
        next.status || 'Saved',
        req.params.id,
        req.userId
    );
    const row = db.prepare('SELECT * FROM expenses WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
    res.json(normalizeExpenseRow(row));
});

app.delete('/api/expenses/:id', authenticate, (req, res) => {
    const probe = db.prepare('SELECT id, user_id FROM expenses WHERE id = ?').get(req.params.id);
    if (probe && probe.user_id !== req.userId) {
        console.warn(`[SECURITY AUDIT - BOLA PROBE DETECTED] User ${req.userId} attempted to delete expense ${req.params.id} belonging to user ${probe.user_id}`);
        return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
    }
    const result = db.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
    if (!result.changes) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });
    res.json({ success: true, id: String(req.params.id) });
});

app.get('/api/conversations', authenticate, (req, res) => {
    const recap = recapWhereClause(String(req.query?.recapId || 'active'));
    const conversations = db.prepare(`
        SELECT * FROM conversations
        WHERE user_id = ?
          ${recap.sql}
        ORDER BY timestamp DESC
    `).all(req.userId, ...recap.params);
    res.json(conversations.map((row) => ({
        ...row,
        id: String(row.id),
        timestamp: row.timestamp || row.created_at || new Date().toISOString(),
        createdAt: row.created_at || row.timestamp || new Date().toISOString(),
    })));
});

app.get('/api/analytics', authenticate, (req, res) => {
    const expenses = db.prepare(`
        SELECT * FROM expenses
        WHERE user_id = ? AND ${activeStatusWhere()}
          AND COALESCE(recap_status, 'active') != 'archived'
    `).all(req.userId);

    let totalSpend = 0;
    let totalIncome = 0;
    const categoryTotals = {};
    const catDisplayName = {};

    expenses.forEach(exp => {
        if (exp.type === 'income') {
            totalIncome += exp.amount;
        } else {
            totalSpend += exp.amount;
            const rawCat = String(exp.category || 'Lainnya').trim();
            const k = rawCat.toLowerCase();
            if (!catDisplayName[k]) catDisplayName[k] = rawCat;
            categoryTotals[k] = (categoryTotals[k] || 0) + exp.amount;
        }
    });

    const cleanCategories = {};
    Object.entries(categoryTotals).forEach(([k, amt]) => {
        cleanCategories[catDisplayName[k] || k] = amt;
    });

    res.json({
        totalSpend,
        totalIncome,
        netCashflow: totalIncome - totalSpend,
        categories: cleanCategories,
        transactionCount: expenses.length
    });
});

app.get('/api/backup/export', authenticate, async (req, res) => {
    try {
        const [settings, expenses, conversations, categories] = await Promise.all([
            getUserSettings(req.userId),
            db.prepare('SELECT * FROM expenses WHERE user_id = ? ORDER BY date DESC').all(req.userId),
            db.prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT 500').all(req.userId),
            db.prepare('SELECT * FROM categories WHERE user_id = ?').all(req.userId),
        ]);

        const backupData = {
            version: '2.0.0',
            exported_at: new Date().toISOString(),
            user_id: req.userId,
            settings: publicSettings(settings),
            stats: {
                total_expenses: expenses.length,
                total_conversations: conversations.length,
                total_categories: categories.length,
            },
            wallets: settings.wallets || [],
            category_budgets: settings.category_budgets || [],
            categories,
            expenses,
            conversations,
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="wa-finance-backup-${dateInputValue(new Date())}.json"`);
        res.json(backupData);
    } catch (error) {
        console.error('Backup export error:', error.message);
        res.status(500).json({ error: 'Gagal membuat file cadangan database.' });
    }
});

app.get('/api/backup/status', authenticate, async (req, res) => {
    try {
        const backupRoot = process.env.BACKUPS_DIR || '/app/backups';
        const backupSources = [
            { directory: 'daily', type: 'Harian Otomatis (Encrypted AES-256)', storage: 'Server Mac mini lokal' },
            { directory: 'weekly', type: 'Mingguan Otomatis (Encrypted AES-256)', storage: 'Server Mac mini lokal' },
            { directory: 'monthly', type: 'Bulanan Otomatis (Encrypted AES-256)', storage: 'Server Mac mini lokal + Firestore terenkripsi' },
        ];
        let history = [];
        let lastBackup = null;

        for (const source of backupSources) {
            const backupDir = path.join(backupRoot, source.directory);
            if (!fs.existsSync(backupDir)) continue;
            const files = fs.readdirSync(backupDir)
                .filter((filename) => filename.endsWith('.tar.gz.enc'))
                .map((filename) => {
                    const fullPath = path.join(backupDir, filename);
                    const stats = fs.statSync(fullPath);
                    const sizeKB = (stats.size / 1024).toFixed(1);
                    return {
                        filename,
                        size: `${sizeKB} KB`,
                        size_bytes: stats.size,
                        timestamp: stats.mtime.toISOString(),
                        type: source.type,
                        storage: source.storage,
                        status: 'Berhasil 🟢',
                    };
                })
            history.push(...files);
        }
        history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        history = history.slice(0, 5);
        lastBackup = history[0] || null;

        res.json({
            status: lastBackup ? 'active' : 'waiting',
            auto_backup_enabled: true,
            schedule: 'Harian 03:15 WITA di Mac mini; bulanan 04:30 WITA ke Firestore terenkripsi',
            storage_destination: 'Mac mini lokal (harian/mingguan) + Firestore (bulanan)',
            last_backup: lastBackup,
            history,
        });
    } catch (error) {
        console.error('Backup status error:', error.message);
        res.status(500).json({ error: 'Gagal membaca status backup server.' });
    }
});

const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');

if (fs.existsSync(INDEX_HTML)) {
    app.use(express.static(PUBLIC_DIR, {
        etag: true,
        maxAge: '5m',
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('index.html')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            }
        },
    }));

    app.use((req, res, next) => {
        if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
        res.sendFile(INDEX_HTML);
    });
}

app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint tidak ditemukan.' });
});

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
    if (String(process.env.DISABLE_WA_AUTO_RESUME || '').toLowerCase() === 'true') {
        console.log('WhatsApp auto-resume disabled by DISABLE_WA_AUTO_RESUME=true');
    } else {
        setTimeout(() => {
            resumeStoredSessions();
        }, 1500);
    }
});
