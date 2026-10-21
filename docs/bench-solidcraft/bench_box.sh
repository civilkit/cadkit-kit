#!/bin/bash
# Run on the CI box. Cold timing, 3 reps each, under the shared timing lock.
#   flock -w 3600 ~/timing.lock bash bench_box.sh
B=$HOME/solidcraft-bench; SC=$B/src/target/release/solidcraft-cli; W=$B/work; O=$B/ours
export PATH=$HOME/.cargo/bin:$PATH
echo "host load: $(cut -d' ' -f1-3 /proc/loadavg)  nproc=$(nproc)  date=$(date -u +%FT%TZ)"
cd $W
TIMEFORMAT='real=%R user=%U sys=%S'
for part in motor_end_cap vented_louvre_case; do
  for i in 1 2 3; do
    echo -n "solidcraft $part rep$i: "; { time $SC run $part.json --out $part.rep$i.step --quiet >$part.rep$i.out 2>$part.rep$i.err; } 2>&1; echo "   rc=$? stepbytes=$(stat -c %s $part.rep$i.step)"
  done
done
cd $O
for f in bench-motor_end_cap brepjs-vented_louvre_case; do
  for i in 1 2 3; do
    echo -n "ours $f proc rep$i: "; { time node ours_run.mjs ck_wasm.wasm $f.ckpart --reps 1 >$f.rep$i.out 2>&1; } 2>&1; echo "   inner: $(head -1 $f.rep$i.out | python3 -c 'import sys,json;d=json.loads(sys.stdin.read());print("regen wall=%.3f cpu=%.3f vol=%s faces=%s valid=%s"%(d["wall"],d["cpu"],d["volume"],d["faces"],d["validOk"]))')"
  done
done
echo "load after: $(cut -d' ' -f1-3 /proc/loadavg)"
