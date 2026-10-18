# Future development: a small CAD language model (LoRA on a ternary base)

Status: idea and plan, 2026-10-19. Nothing here is built. Related: `plan-agent-layer.md` (phases 5 to 7 are the evaluation harness this depends on), `plan-propellers.md` (parametric generators that double as training data).

## Goal

A small model that turns a plain-language request ("a 4-bolt flange, 6 mm thick, 60 mm across") into our feature JSON or script API, running cheaply on a laptop or in the browser. The language understanding comes from the base model; a LoRA adapter teaches the CAD vocabulary and conventions. The kernel verifies every output, so quality is measurable and trainable without human labels.

## Why this is plausible here

- The script API is close to ordinary TypeScript, which small code models already handle: the adapter teaches names and conventions, not a new skill.
- The kernel is a verifier: a script either builds or returns a structured error, and the result has volume, bounding box, validity and a render. That allows filtering (keep only verified pairs) and later reward-based training.
- We already have parametric generators (gears, library parts, the planned prop wizard) and sweeps that emit thousands of labelled cases.

## Base model: Ternary Bonsai (PrismML, open weights)

- Ternary (1.58-bit, weights -1/0/+1) family released April 2026 in 8B, 4B and 1.7B (about 1.75 GB, 0.86 GB and 0.37 GB); a 27B conversion of a Qwen model followed in September 2026 (third-party reports only, unconfirmed). The vendor's quality claims are unverified by us.
- LoRA works: a PrismML developer confirms the base weights stay frozen for a LoRA, so standard LoRA tooling applies. Train on the **unpacked** checkpoints (collection `prism-ml/bonsai-auxiliary` on Hugging Face), because the packed ones are inference-only. After training, convert and pack the adapter for llama.cpp or MLX inference. A guide had been promised and was not published as of July 2026. Reference: https://github.com/PrismML-Eng/Bonsai-demo/issues/76
- Unknowns to measure: training time and memory on the unpacked weights, how well the converted adapter runs, and how much quality an adapter recovers on a ternary base compared with a normal 4-bit or 16-bit base.
- Fallback: the same recipe on a normal 3B to 8B code model (Qwen-Coder class) if ternary underperforms.

## Plan

1. **Evaluation harness first** (agent-layer phase 7): 30 or more reference parts, each with a description, scored by numbers (volume, bounding box, validity, face counts, optional image similarity). Also a held-out set of simple prompts per feature family.
2. **Data**: (a) a frontier model writes scripts for thousands of prompts; run each through the kernel and keep the verified ones, recording prompt, script, volume and bounding box; (b) parametric generators: gear, flange, library parts, prop wizard, sweeps' templates; (c) public sets for sketch-and-extrude (DeepCAD, Text2CAD) translated to our format where it fits; (d) failure and repair pairs: script, kernel error, corrected script, so the model learns to repair.
3. **Spike (about half a day)**: 500 to 1,000 verified pairs, LoRA on Ternary-Bonsai-4B (unpacked, MLX or PEFT) and on a normal 4B as control; score both on the harness. Decide on that result.
4. **Scale up**: more data, a repair loop at inference (build, read the kernel error, retry), and reward-based tuning against the verifier (valid solid, volume and bounding box within tolerance).
5. **Deploy**: pack the adapter; run through llama.cpp or MLX locally; consider in-browser inference later.

## Expectations and limits

- Good at common parts, simple assemblies and parametric variations; fast and cheap.
- Weak at deep spatial reasoning (a multi-station hull, unusual lofts); a frontier model will beat it on novel parts. Likely best setup: the small model drafts, the kernel's error messages drive repair, and a larger model is the fallback.
- Out of scope: aerodynamic or structural performance; only geometry.

## Todo list

- [ ] Build the evaluation harness and the held-out prompt set.
- [ ] Data pipeline: prompt generation, frontier-model scripting, kernel verification, storage (prompt, script, metrics, render).
- [ ] Spike: LoRA on unpacked Ternary Bonsai 4B vs a normal 4B; compare on the harness.
- [ ] Decide: ternary or normal base, from the spike.
- [ ] Repair-pair data and an inference loop with kernel errors.
- [ ] Reward-based tuning against the kernel.
- [ ] Packaging and local or browser inference.
