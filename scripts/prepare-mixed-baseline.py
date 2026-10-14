"""Prepare immutable D-drive fixtures only. Does not launch or time a renderer."""
import json, hashlib, shutil, os, uuid, collections
from pathlib import Path
from datetime import datetime, timezone
from PIL import Image, ImageOps

ROOT=Path('D:/0/ArtEquation-Tests/2026-10-11-mixed-baseline')
ROOT.mkdir(parents=True,exist_ok=True)
stamp=datetime.now(timezone.utc).isoformat()
template=json.loads(Path('output/mixed-baseline/project-template.json').read_text())
candidates=json.loads(Path('output/mixed-baseline/image-candidates.json').read_text(encoding='utf-8-sig'))
candidates.sort(key=lambda p:hashlib.sha256(p.encode()).hexdigest())
pool=ROOT/'image-pool';pool.mkdir(exist_ok=True)
assets=[];seen=set();skipped=[]
for name in candidates:
    if len(assets)>=96: break
    source=Path(name)
    try:
        with Image.open(source) as im:
            w,h=im.size;orientation=im.getexif().get(274,1)
            if orientation in (5,6,7,8):w,h=h,w
            if max(w,h)>3000 or min(w,h)<64:
                skipped.append({'source':name,'reason':'outside fixture dimension range'});continue
            data=source.read_bytes();digest=hashlib.sha256(data).hexdigest()
            if digest in seen:continue
            filename=digest+source.suffix.lower();original=pool/filename
            if not original.exists():shutil.copy2(source,original)
            assert hashlib.sha256(original.read_bytes()).hexdigest()==digest
            poster=pool/(digest+'-overview.png')
            overview=ImageOps.exif_transpose(im).convert('RGBA');overview.thumbnail((192,192));overview.save(poster)
        assets.append({'source':name,'sha256':digest,'filename':filename,'poster':poster.name,'width':w,'height':h,'byteLength':len(data),'extension':source.suffix[1:].lower()})
        seen.add(digest)
    except Exception as e:skipped.append({'source':name,'reason':str(e)})
assert len(assets)>=32,'Insufficient resident source images'
fixtures=[]
for count in (500,1000,5000,10000):
    pid=f'mixed-baseline-{count}';bid=f'mixed-{count}';workspace=ROOT/f'workspace-{count}'
    assetdir=workspace/'projects'/pid/'assets'/'originals';assetdir.mkdir(parents=True,exist_ok=True)
    records=[]
    for i,a in enumerate(assets):
        for key in ('filename','poster'):
            dest=assetdir/a[key]
            if not dest.exists():os.link(pool/a[key],dest)
        records.append({'id':f'asset-{i}','relativePath':f'projects/{pid}/assets/originals/{a["filename"]}','thumbnailRelativePath':f'projects/{pid}/assets/originals/{a["poster"]}','originalName':Path(a['source']).name,'displayName':f'Baseline image {i+1}','byteLength':a['byteLength'],'extension':a['extension'],'kind':'image','status':'available','deduplicated':False,'importedAt':stamp,'sha256':a['sha256'],'imageDimensions':{'width':a['width'],'height':a['height']}})
    nodes=[];connectors=[];types=['image','text','shape','note','image','text','shape','note','image','text','shape','note','image','text','shape','image','column','group','board-link','board-link']
    columns=((int(count**.5)+19)//20)*20
    for i in range(count):
        kind=types[i%20];x=40+(i%columns)*320;y=40+(i//columns)*400
        n={'id':f'n-{i}','kind':kind,'title':f'{kind.title()} {i+1}','x':x,'y':y,'width':280,'height':220}
        if kind=='image':n.update(assetId=f'asset-{(i//20*5+i%20)%len(assets)}',imagePresentation='artwork')
        if kind=='text':n.update(body=f'<p><span style="font-family:Segoe UI;font-size:24px">Editable Type {i+1}</span></p><p>Mixed board layout, typography, selection and save/reopen baseline.</p>',textMode='area',color='transparent',textColor='#ffffff')
        if kind=='note':n.update(body='A native editable note. Preserve content while moving and testing updates.',color='#f5dfa5',textColor='#29231e')
        if kind=='shape':n.update(shapeType='path',vectorPath={'version':1,'closed':True,'points':[{'x':140,'y':0},{'x':280,'y':110},{'x':140,'y':220},{'x':0,'y':110}]},color='#3c8f96',strokeColor='#87dad3',strokeWidth=2)
        if kind=='column':n.update(height=340,columnFixedLayout=True,color='#36505b')
        if kind=='group':n.update(height=300,color='#34546c',graphColumn={'version':2,'operation':'collect','inputs':[{'id':'image-input','sourceId':f'n-{i-i%20}'},{'id':'text-input','sourceId':f'n-{i-i%20+5}'}]})
        if kind=='board-link':
            n.update(targetBoardId=f'child-{i%2}',boardLinkRole='child' if i<20 else 'shortcut',coverAssetId=f'asset-{i%len(assets)}')
            if i<20:n['boardPortal']=True
        nodes.append(n)
        if i%20==19:
            parent=nodes[i-3]
            for order,child in enumerate(nodes[i-16:i-14]):child.update(parentColumnId=parent['id'],columnOrder=order,freeWidth=child['width'],freeHeight=child['height'],x=parent['x']+12,y=parent['y']+48+order*136,width=256,height=124)
            connectors.append({'id':f'c-{i//20}','sourceId':f'n-{i-19}','targetId':f'n-{i-14}','sourcePort':'right','targetPort':'left','style':'curve','color':'#58c8c1','width':2,'dashed':False,'startArrow':False,'endArrow':True,'animated':True,'label':'Reference'})
    project=json.loads(json.dumps(template));project.update(id=pid,title=f'{count:,} mixed-object baseline',assets=records,updatedAt=stamp)
    primary={'id':bid,'title':f'{count:,} mixed objects','viewport':{'x':28,'y':28,'scale':.82},'nodes':nodes,'connectors':connectors,'gridVisible':True,'linkedFolderPath':f'projects/{pid}/boards/{bid}'}
    project['boards']=[primary]+[{'id':f'child-{i}','parentBoardId':bid,'title':f'Subboard {i+1}','coverAssetId':f'asset-{i}','viewport':{'x':28,'y':28,'scale':1},'nodes':[{'id':f'child-note-{i}','kind':'text','title':'Subboard content','body':'<p>Independent subboard edit and return baseline.</p>','textMode':'area','color':'transparent','x':40,'y':40,'width':300,'height':180}],'connectors':[]} for i in range(2)]
    file=workspace/'projects'/pid/'project.json';file.write_text(json.dumps(project,ensure_ascii=False),encoding='utf-8')
    (workspace/'workspace.json').write_text(json.dumps({'schemaVersion':1,'workspaceId':str(uuid.uuid4()),'name':f'Mixed baseline {count}','createdAtUnixMs':int(datetime.now(timezone.utc).timestamp()*1000)}))
    (workspace/'settings.json').write_text(json.dumps({'schemaVersion':5,'theme':'navy','viewMode':'canvas','activeProjectId':pid,'projectNavigation':{pid:{'activeBoardId':bid,'viewMode':'canvas'}}}))
    fixtures.append({'count':count,'primaryNodeCount':len(nodes),'connectors':len(connectors),'graphDataConnections':sum(len(n.get('graphColumn',{}).get('inputs',[])) for n in nodes),'inactiveSubboards':2,'inactiveSubboardNodes':2,'types':dict(collections.Counter(n['kind'] for n in nodes)),'workspace':str(workspace),'project':str(file),'projectSha256':hashlib.sha256(file.read_bytes()).hexdigest()})
report={'status':'PREPARED_NOT_BENCHMARKED','createdAt':stamp,'seedPolicy':'SHA256 of source path determines sample order; content duplicates removed. Originals are copied once to D, then hard-linked into independent D fixtures. C originals unchanged.','images':assets,'skipped':skipped,'fixtures':fixtures,'gpuTesting':'DEFERRED_BY_USER','optimizationOrder':'Baseline -> proposed solutions 1-9 -> identical rerun','countsInclude':'Counts refer to primary board nodes. Connectors, graph edges and two inactive subboard nodes are separately disclosed.'}
(ROOT/'fixture-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':report['status'],'images':len(assets),'counts':[f['count'] for f in fixtures],'root':str(ROOT)}))
