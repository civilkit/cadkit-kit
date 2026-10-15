# Usage: python3 -I analyse.py file.FCStd ...   Lists objects, per-Body PartDesign sequences, sketch geometry/constraints, expressions, links.
import zipfile, sys, os
import xml.etree.ElementTree as ET
from collections import Counter
CN = {1:'Coincident',2:'Horizontal',3:'Vertical',4:'Parallel',5:'Tangent',6:'Distance',7:'DistanceX',8:'DistanceY',9:'Angle',10:'Perpendicular',11:'Radius',12:'Equal',13:'PointOnObject',14:'Symmetric',15:'InternalAlignment',16:'SnellsLaw',17:'Block',18:'Diameter',19:'Weight'}
for f in sys.argv[1:]:
    z = zipfile.ZipFile(f); r = ET.fromstring(z.read('Document.xml'))
    types = {o.get('name'): o.get('type') for o in r.find('Objects').findall('Object')}
    print('=====', os.path.basename(f), 'FreeCAD', r.get('ProgramVersion'), 'zip entries', len(z.namelist()))
    c = Counter(types.values()); print(' objects:', ', '.join(f'{k.split("::")[-1]}x{v}' for k, v in c.most_common() if not k.startswith('App::') or k in ('App::Part', 'App::Link', 'App::FeaturePython')))
    gc, cc, expr, ss = Counter(), Counter(), 0, 0
    for od in r.find('ObjectData').findall('Object'):
        n = od.get('name'); t = types.get(n, '')
        props = {p.get('name'): p for p in od.findall('Properties/Property')}
        if t == 'Sketcher::SketchObject':
            for ge in props['Geometry'].iter('Geometry'): gc[ge.get('type').replace('Part::Geom', '')] += 1
            for ce in props['Constraints'].iter('Constrain'): cc[CN.get(int(ce.get('Type')), ce.get('Type'))] += 1
        if 'ExpressionEngine' in props and props['ExpressionEngine'].find('.//Expression') is not None: expr += 1
        if t.startswith('Spreadsheet'): ss += 1
        if t == 'PartDesign::Body':
            g = props.get('Group'); seq = [l.get('value') for l in g.iter('Link')] if g is not None else []
            tip = props['Tip'].find('Link').get('value') if 'Tip' in props and props['Tip'].find('Link') is not None else ''
            feats = [f'{s}:{types.get(s, "?").split("::")[-1]}' for s in seq if types.get(s, '').startswith('PartDesign::') and 'Plane' not in types.get(s)]
            print(f'  Body {n} tip={tip}: ' + (' > '.join(feats) if feats else '(no PartDesign features)'))
    print(' sketch geometry:', dict(gc), '\n sketch constraints:', dict(cc), '\n objects with expressions:', expr, 'spreadsheets:', ss)
