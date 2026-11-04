# Example model files

Select **Torus · STL** or **Angle block · STL** in the app to load a real file immediately. The **Download STL** buttons save the same files, so you can also test drag and drop. Both files are embedded in `index.html`; examples work offline even if you copy just that one HTML file.

| File | Description | Triangles | Source |
| --- | --- | ---: | --- |
| `trimesh-torus.stl` | A closed torus with a through-hole | 8,700 | Downloaded from Trimesh |
| `trimesh-angle-block.stl` | An asymmetric mechanical angle block | 704 | Downloaded from Trimesh |
| `ellipsoid.stl` | Triaxial ellipsoid, native spans 100 × 54 × 36 | 2,208 | Generated for this project |
| `cube.stl` | Binary STL cube, native side length 2 | 12 | Generated for this project |
| `cube.obj` | The same cube, with quad OBJ faces | 12 after triangulation | Generated for this project |
| `concave-L.obj` | A concave L-shaped prism | 20 after triangulation | Generated for this project |

Both downloaded files are unmodified and pass the app's closed-edge checks and volume sampler. Native coordinates are retained; STL does not encode a physical unit. Assign your desired length unit and longest span in the app.

## Download provenance and attribution

Source: [mikedh/trimesh](https://github.com/mikedh/trimesh), pinned commit [`6c158cce226500fc64b12acd265af0cf01d1c212`](https://github.com/mikedh/trimesh/tree/6c158cce226500fc64b12acd265af0cf01d1c212).

- Torus: [original file](https://github.com/mikedh/trimesh/blob/6c158cce226500fc64b12acd265af0cf01d1c212/models/torus.STL), [raw download](https://raw.githubusercontent.com/mikedh/trimesh/6c158cce226500fc64b12acd265af0cf01d1c212/models/torus.STL). SHA-256: `91441a7f60479bda93c59dd88134da3b4f33d1df71729fe71e1b2ae989974da3`.
- Angle block: [original file](https://github.com/mikedh/trimesh/blob/6c158cce226500fc64b12acd265af0cf01d1c212/models/angle_block.STL), [raw download](https://raw.githubusercontent.com/mikedh/trimesh/6c158cce226500fc64b12acd265af0cf01d1c212/models/angle_block.STL). SHA-256: `512bf110ef9f181e33b1006467a0637f3a0ae2c89e02bca943526a574440c4c9`.

The upstream repository is distributed under the MIT License, Copyright (c) 2023 Michael Dawson-Haggerty. Its complete notice is retained in [TRIMESH-LICENSE.txt](TRIMESH-LICENSE.txt) and inside the portable HTML's example data. No project-wide license is inferred from these third-party assets.

`node scripts/make-examples.cjs` regenerates only the project-generated examples; it does not overwrite downloaded files.
