const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function makeSheet(){
  const rows = [];
  return {
    rows,
    appendRow(row){ rows.push(row.slice()); },
    deleteRow(rowNumber){ rows.splice(rowNumber - 1, 1); },
    insertRowBefore(rowNumber){ rows.splice(rowNumber - 1, 0, []); },
    getLastRow(){ return rows.length; },
    getDataRange(){ return { getValues: () => rows.map(r => r.slice()) }; },
    getRange(row, col, numRows, numCols){
      const nR = numRows || 1, nC = numCols || 1;
      return {
        getValues(){
          const out = [];
          for(let i = 0; i < nR; i++){ const r = rows[row - 1 + i] || []; out.push(r.slice(col - 1, col - 1 + nC)); }
          return out;
        },
        setValues(vv){
          vv.forEach((r, ri) => {
            const targetRow = row - 1 + ri;
            if(!rows[targetRow]) rows[targetRow] = [];
            r.forEach((v, ci) => { rows[targetRow][col - 1 + ci] = v; });
          });
        },
        getValue(){ const r = rows[row - 1] || []; return r[col - 1]; },
        setValue(v){ if(!rows[row - 1]) rows[row - 1] = []; rows[row - 1][col - 1] = v; }
      };
    }
  };
}

function backend(){
  const sheets = {};
  const files = {};
  let nextFileId = 1;
  const folder = {
    createFile(){
      const id = 'file' + (nextFileId++);
      files[id] = { trashed: false };
      return { getId: () => id, getUrl: () => 'https://drive.google.com/file/d/' + id + '/view' };
    }
  };
  const context = vm.createContext({
    console,
    SpreadsheetApp: { openById: () => ({
      getSheetByName: name => sheets[name] || null,
      insertSheet: name => { sheets[name] = makeSheet(); return sheets[name]; }
    })},
    LockService: { getScriptLock: () => ({ waitLock(){}, releaseLock(){}, tryLock: () => true }) },
    DriveApp: {
      getFoldersByName: () => ({ hasNext: () => false }),
      createFolder: () => folder,
      getFileById: id => { const f = files[id]; if(!f) throw new Error('no such file'); return { setTrashed(v){ f.trashed = v; } }; }
    },
    Utilities: {
      base64Decode: s => Array.from(Buffer.from(s, 'base64')),
      newBlob: (data, type, name) => ({ data, type, name }),
      formatDate: () => '20260101_000000',
      getUuid: () => 'uuid'
    },
    Session: { getScriptTimeZone: () => 'Etc/UTC' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty(){} }) }
  });
  vm.runInContext(fs.readFileSync('apps-script/Code.gs', 'utf8'), context);
  return { context, sheets, files };
}

const upload = (overrides = {}) => ({
  name: 'Jane', email: 'jane@example.com', status: 'Recent graduate', confirmed: true,
  fileName: 'resume.docx', dataBase64: Buffer.from('hello').toString('base64'),
  ...overrides
});

test('uploadResume accepts .doc/.docx and rejects every other format', () => {
  const b = backend();
  assert.equal(b.context.uploadResume('me@example.com', upload()).ok, true);
  assert.equal(b.context.uploadResume('me@example.com', upload({ fileName: 'resume.doc' })).ok, true);
  for(const fileName of ['resume.pdf', 'resume.html', 'resume.htm', 'resume.txt']){
    assert.throws(() => b.context.uploadResume('me@example.com', upload({ fileName })), /Only \.doc and \.docx resumes are accepted/);
  }
});

test('myResumes only returns resumes the caller submitted, not everyone\'s', () => {
  const b = backend();
  b.context.uploadResume('me@example.com', upload({ fileName: 'a.docx' }));
  b.context.uploadResume('other@example.com', upload({ fileName: 'b.docx', name: 'Sam', email: 'sam@example.com' }));
  const mine = b.context.myResumes('me@example.com');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].fileName, 'a.docx');
  assert.equal(b.context.myResumes('ME@EXAMPLE.COM').length, 1); // case-insensitive match
  assert.equal(b.context.myResumes('nobody@example.com').length, 0);
});

test('deleteResume only lets the submitter remove their own resume, and trashes the Drive file', () => {
  const b = backend();
  const uploaded = b.context.uploadResume('me@example.com', upload());
  assert.throws(() => b.context.deleteResume('someone-else@example.com', { driveUrl: uploaded.driveUrl }), /You can only remove resumes you submitted/);
  assert.equal(b.context.myResumes('me@example.com').length, 1); // untouched by the rejected attempt

  const result = b.context.deleteResume('me@example.com', { driveUrl: uploaded.driveUrl });
  assert.equal(result.ok, true);
  assert.equal(b.context.myResumes('me@example.com').length, 0);
  const fileId = uploaded.driveUrl.match(/\/d\/([^/]+)/)[1];
  assert.equal(b.files[fileId].trashed, true);

  assert.throws(() => b.context.deleteResume('me@example.com', { driveUrl: uploaded.driveUrl }), /not found/);
});

test('deleteResume requires a driveUrl', () => {
  const b = backend();
  assert.throws(() => b.context.deleteResume('me@example.com', {}), /Missing resume/);
});
