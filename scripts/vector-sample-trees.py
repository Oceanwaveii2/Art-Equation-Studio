"""Read-only sample inventory. Inputs remain unchanged; trees are private test data."""
import json, hashlib, sys
from pathlib import Path
import xml.etree.ElementTree as ET
source = Path(sys.argv[1]) if len(sys.argv)>1 else Path.home()/"Downloads"
out = Path(sys.argv[2]) if len(sys.argv)>2 else Path("../evidence/vector-samples")
out.mkdir(parents=True, exist_ok=True)
def tree(e):
    return {"tag":e.tag.split('}')[-1], "attrs":{('xlink:href' if k.endswith('}href') else k):v for k,v in e.attrib.items()}, "children":[tree(c) for c in e]}
for name in ["sample-vision-by-nastka-drabot", "sample-miami-by-giordano-poloni", "BasketballMohawks"]:
    data=(source/(name+'.svg')).read_bytes()
    (out/(name+'.tree.json')).write_text(json.dumps(tree(ET.fromstring(data))),encoding='utf-8')
    print(name, hashlib.sha256(data).hexdigest(), len(data))
