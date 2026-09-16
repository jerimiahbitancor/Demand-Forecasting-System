// controllers/historyController.js
/**
 * Historical Data Storage
 *
 * Backups are stored as JSON snapshots in the Supabase Storage bucket
 * named "files" under a `backups/` prefix. Every backup is downloadable
 * via the same bucket (signed, expiring URL).
 */
const { supabaseAdmin } = require('../config/supabase');
const XLSX = require('xlsx');
const { logAction } = require('../services/auditService');

const FILES_BUCKET = 'files';
const BACKUPS_FOLDER = 'backups';

const actorOf = (req) => req.user?.name || req.user?.email || null;

// Tables included in a full system snapshot.
const TABLES = [
  'business_profile',
  'ingredient_categories',
  'ingredient_units',
  'product_categories',
  'ingredients',
  'products',
  'product_ingredients',
  'daily_sales',
  'forecast_config',
  'forecast_cogs',
  'forecasts',
  'forecast_runs',
  'model_metrics',
  'inventory_transactions',
  'market_price',
  'uploads',
  'business_days',
  'product_classifications',
  'notifications',
  'audit_logs',
  'user'
];

// Flow / history tables that "Reset Historical Data" clears.
// Catalog and configuration tables are deliberately kept.
const RESET_TABLES = [
  'daily_sales',
  'forecasts',
  'forecast_runs',
  'forecast_cogs',
  'model_metrics',
  'inventory_transactions',
  'market_price'
];

const timestampName = (date = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
};

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

// Reads every tracked table into a single JSON-serializable snapshot.
// A failing table is captured (with its error) instead of killing the backup.
const dumpAllData = async () => {
  const snapshot = {};
  for (const table of TABLES) {
    try {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('*')
        .limit(100000);

      if (error) {
        snapshot[table] = { error: error.message };
      } else {
        snapshot[table] = data || [];
      }
    } catch (err) {
      snapshot[table] = { error: err.message };
    }
  }
  return snapshot;
};

const sanitizeFileName = (name) => {
  const safe = String(name || '').replace(/^.*[\\/]/, '').replace(/\.\./g, '');
  return safe || 'backup.json';
};

// POST /api/settings/backup
const createBackup = async (req, res) => {
  try {
    const tables = await dumpAllData();
    const payload = {
      app_version: '1.0.0',
      generated_at: new Date().toISOString(),
      generated_by: req.user?.name || req.user?.email || null,
      tables
    };

    const fileName = `backup_${timestampName()}.json`;
    const objectPath = `${BACKUPS_FOLDER}/${fileName}`;
    const body = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');

    const { error } = await supabaseAdmin.storage
      .from(FILES_BUCKET)
      .upload(objectPath, body, {
        contentType: 'application/json',
        upsert: false
      });

    if (error) {
      throw new Error(`Storage upload failed: ${error.message}`);
    }

    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(FILES_BUCKET)
      .createSignedUrl(objectPath, 60 * 60, { download: fileName });

    if (signError) {
      throw new Error(`Failed to create download URL: ${signError.message}`);
    }

    logAction(
      'backup_created',
      `Created database backup "${fileName}" (${formatBytes(body.length)})`,
      actorOf(req)
    );

    res.json({
      success: true,
      message: 'Backup stored in the files bucket successfully',
      data: {
        file: objectPath,
        size: body.length,
        sizeLabel: formatBytes(body.length),
        createdAt: new Date().toISOString(),
        url: signed?.signedUrl || null
      }
    });
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/settings/backups
const listBackups = async (req, res) => {
  try {
    const { data: files, error } = await supabaseAdmin.storage
      .from(FILES_BUCKET)
      .list(BACKUPS_FOLDER, {
        limit: 100,
        offset: 0,
        sortBy: { column: 'name', order: 'desc' }
      });

    if (error) {
      // Folder may not exist yet (no backups have been created).
      if (error.message && /not found|no such/i.test(error.message)) {
        return res.json({ success: true, data: [] });
      }
      throw error;
    }

    const items = [];
    for (const file of files || []) {
      if (file.id === null || !file.name) continue;
      const path = `${BACKUPS_FOLDER}/${file.name}`;

      const { data: signed, error: signError } = await supabaseAdmin.storage
        .from(FILES_BUCKET)
        .createSignedUrl(path, 60 * 60, { download: file.name });

      const size = file.metadata?.size || file.size || 0;

      items.push({
        name: file.name,
        path,
        size,
        sizeLabel: formatBytes(size),
        createdAt: file.created_at || file.updated_at || null,
        url: signError ? null : signed?.signedUrl || null
      });
    }

    res.json({ success: true, data: items });
  } catch (error) {
    console.error('Error listing backups:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/settings/backups/:name
const downloadBackup = async (req, res) => {
  try {
    const name = sanitizeFileName(req.params.name);
    const objectPath = `${BACKUPS_FOLDER}/${name}`;

    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from(FILES_BUCKET)
      .createSignedUrl(objectPath, 60 * 5, { download: name });

    if (signError) {
      throw new Error(`Backup not found: ${signError.message}`);
    }

    if (!signed?.signedUrl) {
      return res.status(404).json({ success: false, error: 'Backup not found' });
    }

    res.redirect(signed.signedUrl);
  } catch (error) {
    console.error('Error downloading backup:', error);
    res.status(404).json({ success: false, error: error.message });
  }
};

// DELETE /api/settings/backups/:name
const deleteBackup = async (req, res) => {
  try {
    const name = sanitizeFileName(req.params.name);
    const objectPath = `${BACKUPS_FOLDER}/${name}`;

    const { error } = await supabaseAdmin.storage
      .from(FILES_BUCKET)
      .remove([objectPath]);

    if (error) {
      throw new Error(`Failed to delete backup: ${error.message}`);
    }

    logAction(
      'backup_deleted',
      `Deleted database backup "${name}"`,
      actorOf(req)
    );

    res.json({ success: true, message: `Backup "${name}" deleted` });
  } catch (error) {
    console.error('Error deleting backup:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// GET /api/settings/export-data?format=json|csv|xlsx
const exportData = async (req, res) => {
  try {
    const format = String(req.query.format || 'json').toLowerCase();
    const tables = await dumpAllData();

    if (format === 'xlsx') {
      const workbook = XLSX.utils.book_new();
      for (const [table, rows] of Object.entries(tables)) {
        const sheet = XLSX.utils.json_to_sheet(Array.isArray(rows) ? rows : []);
        XLSX.utils.book_append_sheet(workbook, sheet, table.slice(0, 31));
      }
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="data_export_${timestampName()}.xlsx"`);
      return res.send(buffer);
    }

    if (format === 'csv') {
      let csv = '';
      for (const [table, rows] of Object.entries(tables)) {
        csv += `\n## ${table}\n`;
        csv += XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(Array.isArray(rows) ? rows : []));
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="data_export_${timestampName()}.csv"`);
      return res.send(csv);
    }

    const payload = { generated_at: new Date().toISOString(), tables };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="data_export_${timestampName()}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (error) {
    console.error('Error exporting data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// DELETE /api/settings/reset-data
const resetData = async (req, res) => {
  try {
    const results = {};
    for (const table of RESET_TABLES) {
      const { error } = await supabaseAdmin.from(table).delete().not('id', 'is', null);
      results[table] = error ? { error: error.message } : { cleared: true };
    }

    res.json({ success: true, message: 'Historical data reset successfully.', results });

    logAction(
      'data_reset',
      `Reset historical data (${RESET_TABLES.length} tables cleared)`,
      actorOf(req)
    );
  } catch (error) {
    console.error('Error resetting data:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  createBackup,
  listBackups,
  downloadBackup,
  deleteBackup,
  exportData,
  resetData
};