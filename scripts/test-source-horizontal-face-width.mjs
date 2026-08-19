import assert from "node:assert/strict";
import { horizontalFaceWidth } from "./source-to-app-data.mjs";

assert.equal(horizontalFaceWidth({ length: 235, width: 176, height: 49, faceWidth: 49 }), 176);
assert.equal(horizontalFaceWidth({ length: 270, width: 220, height: 70, faceWidth: 220 }), 220);
assert.equal(horizontalFaceWidth({ length: 270, width: 220, height: 70, faceWidth: 236.7 }), 220);
console.log("source horizontal face width rule passed");
