// A small turned part (a disc revolved from a profile, a shaft up on the axis, an off-axis shaft and a cross hole on the underside) and a drawing of it
// with the Left, Top and Right views at 5:1, third angle, as the tester built it: the fixture of the centre line dimension tests.
export const STEPPED_PART = {
 "format": "ck-part",
 "version": 1,
 "features": [
  {
   "type": "sketch",
   "id": "F1",
   "name": "Sketch on Front",
   "plane": {
    "kind": "std",
    "id": "front"
   },
   "points": [
    {
     "id": "O",
     "x": 0,
     "y": 0,
     "fixed": true
    },
    {
     "id": "p1",
     "x": -6,
     "y": 3
    },
    {
     "id": "p2",
     "x": 0,
     "y": 3
    },
    {
     "id": "p3",
     "x": 0,
     "y": 0
    },
    {
     "id": "p4",
     "x": -6,
     "y": 0
    }
   ],
   "entities": [
    {
     "id": "e1",
     "type": "line",
     "p1": "p1",
     "p2": "p2"
    },
    {
     "id": "e2",
     "type": "line",
     "p1": "p2",
     "p2": "p3"
    },
    {
     "id": "e3",
     "type": "line",
     "p1": "p3",
     "p2": "p4"
    },
    {
     "id": "e4",
     "type": "line",
     "p1": "p4",
     "p2": "p1"
    }
   ],
   "constraints": [
    {
     "id": "k1",
     "type": "horizontal",
     "refs": [
      "e1"
     ]
    },
    {
     "id": "k2",
     "type": "vertical",
     "refs": [
      "e2"
     ]
    },
    {
     "id": "k3",
     "type": "horizontal",
     "refs": [
      "e3"
     ]
    },
    {
     "id": "k4",
     "type": "vertical",
     "refs": [
      "e4"
     ]
    }
   ]
  },
  {
   "type": "revolve",
   "op": "add",
   "sketch": "F1",
   "axis": "e2",
   "end": "blind",
   "angle": 360,
   "id": "F2"
  },
  {
   "type": "sketch",
   "id": "F3",
   "name": "Sketch on Top",
   "plane": {
    "kind": "std",
    "id": "top"
   },
   "points": [
    {
     "id": "O",
     "x": 0,
     "y": 0,
     "fixed": true
    }
   ],
   "entities": [
    {
     "id": "e1",
     "type": "circle",
     "c": "O",
     "r": 1.5586851634735568
    }
   ],
   "constraints": []
  },
  {
   "type": "extrude",
   "op": "add",
   "sketch": "F3",
   "end": "blind",
   "depth": 10,
   "id": "F4"
  },
  {
   "type": "sketch",
   "id": "F5",
   "name": "Sketch",
   "plane": {
    "kind": "face",
    "id": "F2.S.e3"
   },
   "points": [
    {
     "id": "O",
     "x": 0,
     "y": 0,
     "fixed": true
    },
    {
     "id": "p1",
     "x": -2.7594738171696758,
     "y": 2.990832237915203
    }
   ],
   "entities": [
    {
     "id": "e1",
     "type": "circle",
     "c": "p1",
     "r": 0.9637297755303839
    }
   ],
   "constraints": []
  },
  {
   "type": "extrude",
   "op": "add",
   "sketch": "F5",
   "end": "blind",
   "depth": 10,
   "id": "F6"
  },
  {
   "type": "sketch",
   "id": "F7",
   "name": "Cylinder cut sketch",
   "plane": {
    "kind": "face",
    "id": "F2.S.e3"
   },
   "points": [
    {
     "id": "O",
     "x": 0,
     "y": 0,
     "fixed": true
    },
    {
     "id": "c",
     "x": -4.067,
     "y": -1.963
    }
   ],
   "entities": [
    {
     "id": "k1",
     "type": "circle",
     "c": "c",
     "r": 0.5
    }
   ],
   "constraints": []
  },
  {
   "type": "extrude",
   "id": "F8",
   "name": "Cylinder cut",
   "op": "cut",
   "sketch": "F7",
   "end": "blind",
   "depth": 10
  }
 ],
 "seq": 9,
 "material": "steel",
 "name": "Stepped disc"
} as const;
export const STEPPED_DRAWING = {
 "v": 1,
 "sheet": {
  "size": "A3",
  "orientation": "landscape",
  "units": "mm",
  "scale": "5:1",
  "projection": "third",
  "margin": 10
 },
 "title": {
  "title": "Stepped disc",
  "partNo": "",
  "material": "steel",
  "author": "",
  "date": "2026-11-07",
  "revision": "A",
  "mass": "3.2934 g",
  "company": ""
 },
 "views": [
  {
   "id": "V1",
   "kind": "std",
   "label": "Left",
   "x": [
    0,
    0,
    1
   ],
   "y": [
    0,
    1,
    0
   ],
   "pos": [
    100.21868829248042,
    128.69396406953223
   ],
   "scale": null,
   "hidden": true,
   "tangent": false,
   "centerlines": true,
   "showLabel": true
  },
  {
   "id": "V4",
   "kind": "std",
   "label": "Top",
   "x": [
    1,
    0,
    0
   ],
   "y": [
    0,
    0,
    -1
   ],
   "pos": [
    227.56419486713523,
    59.57968827355132
   ],
   "scale": null,
   "hidden": true,
   "tangent": false,
   "centerlines": true,
   "showLabel": true
  },
  {
   "id": "V2",
   "kind": "std",
   "label": "Right",
   "x": [
    0,
    0,
    -1
   ],
   "y": [
    0,
    1,
    0
   ],
   "pos": [
    237.06098883392065,
    171.4728375016469
   ],
   "scale": null,
   "hidden": true,
   "tangent": false,
   "centerlines": true,
   "showLabel": true
  }
 ],
 "dims": [
  {
   "id": "Dmw70rbhj0",
   "view": "V4",
   "kind": "linear",
   "a": [
    -6,
    -5.98984894962761
   ],
   "b": [
    6,
    -5.98984894962761
   ],
   "orient": "h",
   "offset": 14,
   "overall": "w"
  },
  {
   "id": "Dmw70rbhj1",
   "view": "V4",
   "kind": "linear",
   "a": [
    -6,
    -5.98984894962761
   ],
   "b": [
    -6,
    5.989848949627609
   ],
   "orient": "v",
   "offset": -14,
   "overall": "h"
  },
  {
   "id": "Dmw70rbhk2",
   "view": "V4",
   "kind": "diameter",
   "a": [
    -3.052515863592043e-16,
    -3.052515863592043e-16
   ],
   "r": 6,
   "angle": 1.7853981633974483,
   "offset": 14,
   "refs": [
    {
     "faces": [
      "F2.S.e1",
      "F2.S.e4"
     ],
     "at": [
      6,
      3,
      -7.347880794884119e-16
     ]
    }
   ]
  },
  {
   "id": "Dmw70rbhk3",
   "view": "V4",
   "kind": "diameter",
   "a": [
    0,
    -1.4149128596411195e-16
   ],
   "r": 1.5586851634735568,
   "angle": 0.7853981633974483,
   "offset": 14,
   "refs": [
    {
     "faces": [
      "F4.C1",
      "F4.S.e1"
     ],
     "at": [
      -1.5586851634735568,
      10,
      -1.9088387963263603e-16
     ]
    }
   ]
  },
  {
   "id": "Dmw70rbhk4",
   "view": "V4",
   "kind": "diameter",
   "a": [
    -4.067000000000001,
    1.9629999999999994
   ],
   "r": 0.5000000000000009,
   "angle": 1.2853981633974483,
   "offset": 14,
   "refs": [
    {
     "faces": [
      "F2.S.e3",
      "F6.S.e1"
     ],
     "at": [
      -3.7232035927000595,
      0,
      2.990832237915203
     ]
    }
   ]
  },
  {
   "id": "Dmw70rgim5",
   "view": "V2",
   "kind": "linear",
   "a": [
    -6,
    -10
   ],
   "b": [
    6,
    -10
   ],
   "orient": "h",
   "offset": 14,
   "overall": "w"
  },
  {
   "id": "Dmw70rgim6",
   "view": "V2",
   "kind": "linear",
   "a": [
    -6,
    -10
   ],
   "b": [
    -6,
    10
   ],
   "orient": "v",
   "offset": -14,
   "overall": "h"
  },
  {
   "id": "Dmw70rlpe7",
   "view": "V1",
   "kind": "linear",
   "a": [
    -6,
    -10
   ],
   "b": [
    6,
    -10
   ],
   "orient": "h",
   "offset": 14,
   "overall": "w"
  },
  {
   "id": "Dmw70rlpe8",
   "view": "V1",
   "kind": "linear",
   "a": [
    -6,
    -10
   ],
   "b": [
    -6,
    10
   ],
   "orient": "v",
   "offset": -14,
   "overall": "h"
  },
  {
   "id": "Dmw70scix9",
   "view": "V4",
   "kind": "linear",
   "a": [
    -4.067,
    1.9630000000000019
   ],
   "b": [
    -4.067,
    1.9630000000000019
   ],
   "orient": "h",
   "offset": 12,
   "refs": []
  },
  {
   "id": "Dmw70ssnea",
   "view": "V2",
   "kind": "linear",
   "a": [
    -3.9545620134455866,
    0
   ],
   "b": [
    -3.9545620134455866,
    -10
   ],
   "orient": "v",
   "offset": -10,
   "refs": [
    {
     "faces": [
      "F6.S.e1"
     ],
     "at": [
      -2.7594738171696758,
      -5,
      3.9545620134455866
     ]
    }
   ]
  },
  {
   "id": "Dmw70umjlf",
   "view": "V2",
   "kind": "linear",
   "a": [
    6,
    3
   ],
   "b": [
    6,
    0
   ],
   "orient": "v",
   "offset": 23.40892605902053,
   "refs": [
    {
     "faces": [
      "F2.S.e4"
     ],
     "at": [
      0,
      1.5,
      -6
     ]
    }
   ]
  },
  {
   "id": "Dmw70ydmkg",
   "view": "V2",
   "kind": "linear",
   "a": [
    1.5586851634735568,
    10
   ],
   "b": [
    1.5586851634735568,
    3
   ],
   "orient": "v",
   "offset": 45.227509364698506,
   "refs": [
    {
     "faces": [
      "F4.S.e1"
     ],
     "at": [
      0,
      6.5,
      -1.5586851634735568
     ]
    }
   ]
  }
 ],
 "notes": [],
 "balloons": [],
 "bom": {
  "show": true,
  "pos": null
 },
 "tables": []
} as const;
