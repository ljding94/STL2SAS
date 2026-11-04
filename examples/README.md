# Example model files

Every STL and OBJ in this folder is selectable in the app, including **Toy car · STL**, the downloaded torus/angle block, and all generated mesh files. Select a file, then use **Download selected model file** to save it and test dragging it back onto the upload area. All seven mesh examples are embedded in `index.html` and work offline, even when you copy just that one HTML file. The four analytic solids are listed separately.

| File | Description | Triangles | Source |
| --- | --- | ---: | --- |
| `toy-car.stl` | Detailed, hollow toy car, voxel-remeshed for closed-volume sampling | 27,998 | Derived from Khronos' CC0 ToyCar scene |
| `trimesh-torus.stl` | A closed torus with a through-hole | 8,700 | Downloaded from Trimesh |
| `trimesh-angle-block.stl` | An asymmetric mechanical angle block | 704 | Downloaded from Trimesh |
| `ellipsoid.stl` | Triaxial ellipsoid, native spans 100 × 54 × 36 | 2,208 | Generated for this project |
| `cube.stl` | Binary STL cube, native side length 2 | 12 | Generated for this project |
| `cube.obj` | The same cube, with quad OBJ faces | 12 after triangulation | Generated for this project |
| `concave-L.obj` | A concave L-shaped prism | 20 after triangulation | Generated for this project |

Both downloaded files are unmodified and pass the app's closed-edge checks and volume sampler. Native coordinates are retained; STL does not encode a physical unit. Assign your desired length unit and longest span in the app.

The car is a modified derivative. Its fabric display base and materials were removed; body and glass were combined; a 1.5-unit inward wall thickness was added to retain zero-thickness display panels during voxel conversion; and the mesh was simplified to about 28,000 triangles. Remaining cavities are sampled as empty space. The result is normalized to a longest span of 160 model units; this is a chosen display scale. It automatically selects 50,000 scattering points to make its thin features easier to see. [Toy-car credits and CC0 notice](TOY-CAR-LICENSE.txt).

Car source: [KhronosGroup/glTF-Sample-Assets, ToyCar](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/8f492390ddc7a2ae221a1369ef560589cf8c70fb/Models/ToyCar), by Guido Odendahl and Eric Chadwick, under CC0 1.0. The pinned source GLB has SHA-256 `01a60862de55cd4b9f3acfab0b0def86451800f9c42467fcd61052c16cb9838c`; the converted STL has SHA-256 `57efd4f64fa573438fe21d5b72e3b4dcd9f189ff4a64fd1fb352a021aad49030`.

To reproduce the conversion, download that commit's `Models/ToyCar/glTF-Binary/ToyCar.glb`, then run Blender 4.1 with `--background --factory-startup --python scripts/prepare-toy-car.py -- /path/to/ToyCar.glb examples/toy-car.stl`. Blender is only needed to regenerate this example, not to build, host, or use the app.

`catalog.json` is the single list used to generate the example menu and embed assets. The build fails if an STL/OBJ file is missing from the catalog, so bundled models cannot silently disappear from the selector.

## Download provenance and attribution

Source: [mikedh/trimesh](https://github.com/mikedh/trimesh), pinned commit [`6c158cce226500fc64b12acd265af0cf01d1c212`](https://github.com/mikedh/trimesh/tree/6c158cce226500fc64b12acd265af0cf01d1c212).

- Torus: [original file](https://github.com/mikedh/trimesh/blob/6c158cce226500fc64b12acd265af0cf01d1c212/models/torus.STL), [raw download](https://raw.githubusercontent.com/mikedh/trimesh/6c158cce226500fc64b12acd265af0cf01d1c212/models/torus.STL). SHA-256: `91441a7f60479bda93c59dd88134da3b4f33d1df71729fe71e1b2ae989974da3`.
- Angle block: [original file](https://github.com/mikedh/trimesh/blob/6c158cce226500fc64b12acd265af0cf01d1c212/models/angle_block.STL), [raw download](https://raw.githubusercontent.com/mikedh/trimesh/6c158cce226500fc64b12acd265af0cf01d1c212/models/angle_block.STL). SHA-256: `512bf110ef9f181e33b1006467a0637f3a0ae2c89e02bca943526a574440c4c9`.

The upstream repository is distributed under the MIT License, Copyright (c) 2023 Michael Dawson-Haggerty. Its complete notice is retained in [TRIMESH-LICENSE.txt](TRIMESH-LICENSE.txt) and inside the portable HTML's example data. No project-wide license is inferred from these third-party assets.

`node scripts/make-examples.cjs` regenerates only the project-generated examples; it does not overwrite downloaded files.
