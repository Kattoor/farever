Place your extracted model viewer output here.

Recommended folder name:
  public/model-library/

Run the recursive GLB extractor with:
  --out-dir ./public/model-library

The viewer page at /models/ expects prefab-export-summary.json to exist at the root of this folder.

Example:
  node ./tools/prefab-to-gltf.js ../out/Character/ --asset-root ../out/ --out-dir ./public/model-library

Then open:
  /models/
