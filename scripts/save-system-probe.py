import json,sqlite3,time,os,statistics
from pathlib import Path
root=Path('../output/playwright/save-system-research-2026-10-08').resolve();root.mkdir(parents=True,exist_ok=True)
fixture=Path('../fixtures/workspace/projects/p1-v2-studies/project.json').resolve();project=json.loads(fixture.read_text(encoding='utf8'))
db=sqlite3.connect(root/'incremental-probe.sqlite');db.execute('PRAGMA journal_mode=WAL');db.execute('PRAGMA synchronous=FULL');db.executescript('CREATE TABLE IF NOT EXISTS objects(board TEXT,id TEXT,x REAL,y REAL,payload TEXT,PRIMARY KEY(board,id)); CREATE TABLE IF NOT EXISTS operations(seq INTEGER PRIMARY KEY,board TEXT,id TEXT,x REAL,y REAL);')
# Reset only generated probe tables so repeated runs have independent histories.
db.execute('DELETE FROM operations');db.execute('DELETE FROM objects');db.commit()
for board in project['boards']:
 for node in board['nodes']:
  db.execute('INSERT OR REPLACE INTO objects VALUES(?,?,?,?,?)',(board['id'],node['id'],node.get('x',0),node.get('y',0),json.dumps(node,separators=(',',':'))))
db.commit(); board=next(b for b in project['boards'] if b['id']=='ultra-graph-test-1');node=board['nodes'][0]
results=[]
for run in range(3):
 times=[]
 for i in range(10):
  begin=time.perf_counter();node['x']=run*10+i
  payload=json.dumps(project,separators=(',',':')).encode();temporary=root/'full-project.json.tmp'
  with temporary.open('wb') as f:f.write(payload);f.flush();os.fsync(f.fileno())
  os.replace(temporary,root/'full-project.json');times.append((time.perf_counter()-begin)*1000)
 results.append({'run':run+1,'method':'whole-project JSON serialization and flushed file replacement','p95ms':sorted(times)[-1],'bytesPerCommit':len(payload)})
 times=[]
 for i in range(10):
  x=run*10+i;begin=time.perf_counter()
  with db:
   db.execute('UPDATE objects SET x=? WHERE board=? AND id=?',(x,board['id'],node['id']))
   db.execute('INSERT INTO operations(board,id,x,y) VALUES(?,?,?,?)',(board['id'],node['id'],x,node.get('y',0)))
  times.append((time.perf_counter()-begin)*1000)
 results.append({'run':run+1,'method':'SQLite WAL + FULL; position field and history operation in one transaction','p95ms':sorted(times)[-1],'logicalPayloadBytes':len(json.dumps({'board':board['id'],'id':node['id'],'x':29,'y':node.get('y',0)}))})
reopened=sqlite3.connect(root/'incremental-probe.sqlite');assert reopened.execute('SELECT x FROM objects WHERE board=? AND id=?',(board['id'],node['id'])).fetchone()[0]==29;assert reopened.execute('PRAGMA integrity_check').fetchone()[0]=='ok';assert reopened.execute('SELECT COUNT(*) FROM operations').fetchone()[0]==30
backup=sqlite3.connect(root/'backup-probe.sqlite');db.backup(backup);assert backup.execute('SELECT COUNT(*) FROM operations').fetchone()[0]==30
receipt={'scope':'Storage mechanism probe on actual eight-board fixture. Python/SQLite, not integrated Rust/WebView2 timing or release acceptance. No process-crash/power-loss certification. JSON comparator fsyncs file but is not a complete directory-durability protocol. Each p95 is maximum of only ten samples; exploration only.','sqliteVersion':sqlite3.sqlite_version,'runs':results,'reopenAndIntegrity':'PASS','consistentOnlineBackup':'PASS','recommendation':'Prototype native Rust transactional field updates and history with external asset files; retain automatic interaction UX; test migration and crash recovery before replacing production persistence.'}
(root/'probe-results.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
