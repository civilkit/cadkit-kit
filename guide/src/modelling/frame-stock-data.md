# Frame stock data and sources

The Australian, US and European profiles of the [Frame tool](frames.md) are built from published catalogue tables. This page lists where each figure comes from, how it was checked, what was left out, and how to rebuild the lists. Section sizes and masses are facts that manufacturers and standards bodies publish; the catalogues themselves, their text and their layout are not copied, and each profile names its source table.

## Sources

| Stock | Standard and grade | Source table | Profiles |
| --- | --- | --- | --- |
| Square, rectangular and circular hollow sections | AS/NZS 1163, grades C250L0 (small round), C350L0 and C450L0 | Australian Tube Mills, *Design Capacity Tables for Structural Steel Hollow Sections*, August 2013, Tables 3.1-1 to 3.1-6 (dimensions and properties). The C450 tables are headed as designed to grade C450L0. | 221 |
| Universal beams and columns, universal bearing piles | AS/NZS 3679.1, 300PLUS | InfraBuild, *Hot Rolled and Structural Steel Products*, 9th Edition (2019), Tables 9, 11 and 17 | 45 |
| Parallel flange channels | AS/NZS 3679.1, 300PLUS | same, Table 15 | 10 |
| Equal and unequal angles | AS/NZS 3679.1, 300PLUS | same, Tables 19 to 24 | 65 |
| Flat bar, round bar | AS/NZS 3679.1, 300PLUS (merchant bar is made in several grades: confirm with the supplier) | same, Table 5 (flats) and Table 3 (rounds) | 40 |
| W, S, C, MC shapes and angles (L) | ASTM A992 (W), ASTM A36 (S, C, MC, L) | AISC Shapes Database, version 15.0 (November 2017; Steel Construction Manual, 15th edition), sheet "Database v15.0", W, S, C, MC and L rows | 520 |
| Hollow structural sections (HSS) and pipe | ASTM A500 Gr C (HSS), ASTM A53 Gr B (pipe) | same database, HSS rows (516) and PIPE rows (51) | 567 |
| IPE, IPE A, IPE O, IPE AA, HE A, HE B, HE M, HE AA, IPN, UPN | EN 10025-2, S355 (dimensions to EN 10365) | ArcelorMittal, *Sections and Merchant Bars*, sales programme (FR/EN/DE, PDF dated 2024-03), the dimension table and the "Dimensions and properties" table of each family | 198 |
| Hot-finished and cold-formed SHS, RHS, CHS | EN 10210 and EN 10219, S355J2H | SCI P363, *Steel Building Design: Design Data* (Tata Steel, BCSA, SCI; reprinted 2015), tables for Celsius (EN 10210-2) and Hybox (EN 10219-2) sections; masses cross-checked against the Tata Steel Hybox S355J2H datasheet (TST95:0122, 2022) | 888 |

For each profile the list shows the region, standard and grade; the **Frame** panel shows the source table in a tooltip; the bill of materials prints standard, grade, material and mass.

**To review.** The AISC workbook could not be downloaded from the AISC site (the server refused automated requests, HTTP 403). The identical file, with the AISC disclaimer unchanged, was taken from a public redistribution (an MIT-licensed repository that packages it), and an independent copy of the same database matched it value for value. The terms under which the AISC data may be reused have **not been reviewed**; the profile figures are published dimensions and weights, but the question stays open until someone has read the AISC terms (see THIRD_PARTY.md).

## What the figures are

- Sizes are the nominal outside dimensions and wall (or flange and web) thicknesses. Mass per metre is the catalogue figure; for US stock it is the published weight in pounds per foot converted to kilograms per metre (1 lb/ft = 1.48816 kg/m). Inches convert at exactly 25.4 mm.
- The US hollow sections and pipe are modelled with the **nominal** wall and an outside corner radius of two wall thicknesses, which reproduces the published weight to within 0.6 per cent. AISC tabulates the weight on the nominal wall but the area and section properties on the **design wall** (0.93 of nominal, ERW A500), so the catalogue weight is 5 to 11 per cent above the tabulated area times 7850 kg/m3. The bill of materials uses the catalogue weight; the design wall is not modelled.
- US W shapes use the database's flange, web and root-fillet sizes. S, C and MC shapes have tapered flanges: they are modelled with the database's mean flange thickness and no root fillet, which keeps the modelled area within 3 per cent of the weight (C3X3.5 is the exception: the database's own weight is 5.6 per cent under its area). European IPN and UPN are modelled the same way with the catalogue's mean flange thickness and root radius (IPN 80, UPN 65 and UPN 80 come out 3.1 to 3.3 per cent heavy). EN 10210 SHS 50 x 50 x 8 and 80 x 80 x 12.5 come out 3.1 and 3.2 per cent heavy because the tube corner is built with inside radius outer minus wall where the standard has 1.0 t.
- European hollow sections use the standard's corner radii: hot-finished (EN 10210) 1.5 t outside and 1.0 t inside; cold-formed (EN 10219) 2 t up to 6 mm wall, 2.5 t above 6 and up to 10 mm, 3 t above 10 mm. The two standards give different properties for the same size, so each is its own group in the Profile list.
- Australian hollow sections use an outside corner radius of 2 t up to 3 mm wall and 2.5 t above, with the inside radius 1 t and 1.5 t; the modelled area agrees with the table's gross area.
- Rolled sections include the root radius of the table (I sections and channels); angles are modelled with square corners (no root or toe radius), which keeps the modelled area within 1.3 per cent of the catalogue's.
- Strength properties (second moments of area, section moduli, capacities) are not stored or used. Check the current edition of the catalogue and the design standard for anything other than layout, cut lists and mass.

## How it was checked

- Each hollow-section row was read from the table text by a script that rejects a row when its mass differs from the area times 7850 kg/m3 by more than 1.5 per cent, or when the table's own width-to-wall ratios do not match the size read for the row. One row of the C450 square table, 35 x 35 x 3.0, could not be read reliably from the text and is not included; the same size is in the C350L0 table.
- Each rolled-section row is **verified** when the catalogue text has a line that carries both its mass and its gross area (angles, channels, I sections) or the mass in the right row and column of the size table (rounds and flats). All 28 beams, 13 columns, 10 channels, 65 angles, 34 flats and 6 rounds passed. The bearing piles were transcribed and machine-checked in a separate data set.
- Each US row was taken from the database workbook; an independent CSV copy of the same database matched all 10412 compared values. Imperial values are converted exactly (25.4 mm/in, 1.48816394 kg/m per lb/ft) and rounded to four significant figures. The AISC metric columns agree with the conversion within 1.5 per cent except six small-section weights (rounding of small integers). The database's HSS area equals the closed form with outside radius 2 t and inside radius t on the design wall within 0.4 per cent.
- The European open sections were checked against the catalogue's two tables (mass and properties agree for every section), against the second moments recomputed from the dimensions (within 0.09 per cent for the 159 parallel-flange sections) and against mass = area x 7850 kg/m3 (within 1.1 per cent). The hollow sections were checked against mass = area x 7850 (within 0.6 per cent) and against the Hybox datasheet masses: 283 of the 285 sizes found there agree within 1 per cent. Two differ and the SCI value is kept: RHS 100 x 50 x 5 (10.5 against 10.3 kg/m) and RHS 200 x 100 x 8 (33.9 against 43.2 kg/m, a misprint in the datasheet; 33.9 matches the area). SCI marks some sizes "check availability"; the profile carries that flag.
- The tests also check every profile: unique ids, positive dimensions, hardware that exists, and the mass per metre within 3 per cent of the modelled area times 7850 kg/m3.

## Left out

- **Cold-formed channels and zeds** (C and Z purlins): their lipped section needs a section kind the Frame tool does not have. A follow-up.
- **Taper flange beams** (TFB): the flanges are not parallel. A follow-up.
- **Welded beams and columns**, and rolled sizes that the catalogues do not list.
- **Hollow sections** larger than the range above (the tables go to 400 mm square and 508 mm round), and sizes that are not in the tube maker's tables.
- **US and European sections that are not frame stock in the first lists**: M, HP, WT, MT, ST and double angles; IPE 750 and the heavy HE series above 1000 mm; UPE; elliptical hollow sections; Hybox sizes outside SCI P363. The flat bar and round bar of the US and Europe have no public table of standard sizes, so none is listed.
- **Section properties** (second moments, moduli, torsion constants) are in the verified data files but not in the profile lists: the Frame tool does not use them.
- **Hardware** (gussets, plugs, feet) is offered only for hollow sections up to the size a frame is built from; larger structural sizes list none.
- The 35 x 35 x 3.0 square section in the C450 table (see above).

## Rebuilding the lists

The lists are generated and committed, so nothing is fetched while using the tool. To rebuild after a change in the data (developers):

1. `tools/extract_atm_hollow.mjs` reads the hollow-section tables from the text of the PDF (`pdftotext -layout`) into `apps/cad/src/frame/data/au-hollow-atm.json`.
2. `tools/verify_au_sources.mjs` re-checks the rolled-section rows against the catalogue text and records `verified` in `data/au-sections.json`.
3. `tools/steel_data/` holds the scripts that produced `data/us-sections.json`, `data/eu-sections.json` and `data/steel-materials.json` from the AISC workbook, the ArcelorMittal catalogue text and the SCI P363 text (they need those files, which are not in the repository, and write the verification reports beside them).
4. `tools/build_frame_profiles.mjs` writes `profiles.au.json`, `profiles.us.json` and `profiles.eu.json`; `tools/build_steel_materials.mjs` writes `apps/cad/src/materials.steel.json`. `--check` compares them with the data and the tests run both.

Each regional list is a separate file that the app loads only when its region is used (so the program itself stays small): `profiles.au.json` about 170 kB, `profiles.us.json` about 500 kB and `profiles.eu.json` about 540 kB before compression (11, 39 and 26 kB compressed).

Add your own stock the same way as described in [Frames, cut lists and connectors](frames.md#your-own-stock-and-fittings).

## Materials

The steel grades of the Material editor (`data/steel-materials.json`) come from these sources. A grade is **verified** when its headline strengths agree between at least two independent public sources, or a mill catalogue that reproduces the standard's table; the others carry an *unverified* badge.

| Grade | Source | Verified |
| --- | --- | --- |
| EN 10025-2 S235, S275, S355 | EN 10025-2:2019 mechanical table as reproduced in the ArcelorMittal catalogue (thickness bands to 140 mm); E, Poisson's ratio and density from SCI P363 | yes |
| EN 10210 and EN 10219 S355J2H | SCI P363 section 5.2 (ReH by thickness) and the Tata Steel Hybox S355J2H datasheet (Rm 470 to 630 MPa) | yes |
| ASTM A36 | Wikipedia article "A36 steel", quoting the AISC Steel Construction Manual: 36 ksi, 58 to 80 ksi | yes |
| ASTM A992 | Wikipedia article "ASTM A992" (cites A992/A992M): 50 ksi, 65 ksi, fy/fu at most 0.85 | yes |
| ASTM A572 Gr 50 | ASTM listing summary for A572/A572M and Wikipedia: 50 ksi, 65 ksi | yes |
| ASTM A53 Gr B | an AISC magazine excerpt and an engineering reference: 35 ksi, 60 ksi; a single secondary source | **no** |
| ASTM A500 Gr B (round 42 ksi, shaped 46 ksi) and Gr C shaped (50 ksi) | A500-07 SI table as in Wikipedia, a fabricator summary and the Steel Tube Institute | yes |
| ASTM A500 Gr C round | 46 ksi (315 MPa) in the A500-07 to -18 summaries; the Steel Tube Institute says the 2021 revision gives 50 ksi (345 MPa) for all shapes. The record keeps 46 ksi and stores 345 MPa as the alternate | **no** (edition conflict) |
| AS/NZS 3679.1 grade 300 and 350 | a third-party web printout of the standard's property tables (fy 280 and 330 MPa, fu 440 and 480 MPa); the InfraBuild catalogue shows thickness-dependent yields, so these are conservative lower bounds | **no** |

The elastic constants of the European grades (E 210 GPa, Poisson's ratio 0.3, G 81 GPa, expansion 12 x 10^-6/K) follow EN 1993-1-1 as summarised in design aids; the standard text itself was not read. The US constants (E 200 GPa, G 77.2 GPa, Poisson's ratio 0.3) are the AISC 360 values and were not retrieved from a source; US thermal expansion is left empty. The ASTM, EN and AS/NZS standard texts are paywalled and were not read; the figures rest on the bodies and catalogues named above.

**Defaults to confirm.** Which grade a profile is made of by default (A992 for W; A36 for S, C, MC and L; A500 Gr C for HSS; A53 Gr B for pipe; S355 for the European rolled sections; S355J2H for the hollow ones; AS/NZS 3679.1 grade 300 for Australian rolled steel) follows common practice and is not a published fact about the profile. Each such profile is flagged `material_default` in the data and the bill of materials adds "default, confirm" to its material. The Australian catalogue lists grade `300PLUS`; the material record names it `300`, so the Australian profiles use `as-nzs-3679.1-300`, whose yield is the conservative lower bound described above.
