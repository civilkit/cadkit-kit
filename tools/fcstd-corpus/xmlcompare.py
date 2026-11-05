# File level comparison of two corpus runs (plain python3, not FreeCAD):
#   python3 -I tools/fcstd-corpus/xmlcompare.py DIR_A DIR_B   -> markdown on stdout
# Compares the member lists of every .FCStd and the lines of Document.xml, grouped by element kind (attribute values blanked).
import sys, os, re, glob, zipfile, difflib, collections

A, B = sys.argv[1], sys.argv[2]
names_diff, kinds, example, n = [], collections.Counter(), {}, 0
for f in sorted(glob.glob(os.path.join(A, "*.FCStd"))):
    g = os.path.join(B, os.path.basename(f))
    if not os.path.exists(g):
        continue
    n += 1
    za, zb = zipfile.ZipFile(f), zipfile.ZipFile(g)
    if sorted(za.namelist()) != sorted(zb.namelist()):
        names_diff.append(os.path.basename(f))
    xa = za.read("Document.xml").decode().splitlines()
    xb = zb.read("Document.xml").decode().splitlines()
    for l in difflib.unified_diff(xa, xb, lineterm="", n=0):
        if l.startswith(("---", "+++", "@@")) or l.startswith("+"):
            continue
        k = re.sub(r'"[^"]*"', '"..."', l[1:].strip())[:90]
        kinds[k] += 1
        example.setdefault(k, os.path.basename(f))
print("## File level (Document.xml and zip members)\n")
print("Compared %d files. Zip member lists differ in %d files%s.\n" % (n, len(names_diff), (": " + ", ".join(names_diff[:5])) if names_diff else ""))
print("Lines of Document.xml that differ (attribute values blanked; each line counted once, from the A side):\n")
print("| element | lines | first file |\n|---|---|---|")
for k, v in kinds.most_common():
    print("| `%s` | %d | %s |" % (k.replace("|", "/"), v, example[k]))
