const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function backupCollection(name, outDir) {
  const snap = await db.collection(name).get();
  const docs = [];
  snap.forEach(doc => docs.push({ id: doc.id, data: doc.data() }));
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(outDir, `${name}-backup-${ts}.json`);
  fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), 'utf8');
  return { count: docs.length, filePath };
}

async function clearWorkerScheduleMaps() {
  const backupDir = path.join(__dirname, '..', 'backups');
  ensureDir(backupDir);
  const workersBackup = await backupCollection('workers', backupDir);

  const snap = await db.collection('workers').get();
  const bulkWriter = db.bulkWriter();

  snap.forEach(doc => {
    const ref = db.collection('workers').doc(doc.id);
    bulkWriter.update(ref, { manualOverrides: admin.firestore.FieldValue.delete() });
  });

  await bulkWriter.close();

  return { backups: { workersBackup }, updatedWorkers: snap.size };
}

clearWorkerScheduleMaps()
  .then(result => {
    console.log('✅ Cleared worker schedule maps (manualOverrides).');
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Failed to clear worker schedule maps:', err);
    process.exit(1);
  });
