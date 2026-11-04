# STL2SAS

A minimal, offline 3D-model-to-small-angle-scattering workbench. Open **`index.html`** in a modern browser and drop an STL or OBJ file onto the page. No installation, network connection, or server is needed. All calculations stay on your device.

[GitHub repository](https://github.com/ljding94/STL2SAS) · [Cloudflare hosting guide](docs/CLOUDFLARE.md) · [Example files and attribution](examples/README.md)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fljding94%2FSTL2SAS)

For your existing repository, follow the hosting guide to connect it directly. The deploy button creates a repository copy.

## Using the app

1. Open `index.html`. The triaxial ellipsoid example runs automatically.
2. Drop a binary/ASCII `.stl` or `.obj` file, select one of four built-in solids, or select **Torus · STL** / **Angle block · STL**. These two real STL files were downloaded from Trimesh and are embedded for offline use. Use the **Download STL** buttons to save them and try drag and drop; `examples/` also contains generated STL/OBJ solids.
3. Choose the number of volume points. Imported models must be closed solids. The app checks open and non-manifold edges before uniformly filling the enclosed volume; it never substitutes surface points.
4. Set the longest span and length unit. STL does **not** encode units. On import, the native largest bounding-box side is preserved and labeled “model unit” until you assign a physical unit. The longest span is not the maximum pair distance, Dmax.
5. Drag the particle, use arrow keys, edit X/Y/Z angles, or enable auto rotation. The XY, XZ, and YZ laboratory planes update together. Scroll over the particle to zoom without changing its physical size or scattering.
6. Adjust q range, detector resolution, and color range. Hover over a detector for its numerical q and intensity. The dashed reference lines on the profile plot are analytic sphere/ellipsoid results; the horizontal 1/N line is the approximate sampling floor.
7. Export data to get `stl2sas-planes.csv`, containing raw normalized intensities, physical q coordinates, and simulation metadata for all three planes. At 512² this is a large CSV; use 128² for a quick export.

The app is a single portable file: you can copy `index.html` to another computer. Its source is kept separately in `src/` for development. Current Chrome, Edge, Firefox, or Safari is recommended; the page uses Blob Web Workers, Canvas 2D, and native HTML dialogs.

## Numerical method

For N equally weighted, uniformly distributed volume points, constant contrast, and active particle rotation R:

```text
A(q) = (1/N) Σ_j exp(i q · R r_j)
P(q) = |A(q)|²,    P(0) = 1
R = Rz * Ry * Rx
```

For a detector perpendicular to Z, qz = 0, so the amplitude is the 2D Fourier transform of the particle's density projected onto XY. The same argument gives XZ and YZ. We rotate points once, deposit each projection with cloud-in-cell weights, and FFT each grid. The FFT grid has twice the detector width, keeping displayed frequencies below its Nyquist limit. A separable sinc⁴ intensity correction compensates the cloud-in-cell window. This is an approximation to the direct amplitude sum, not an exact nonuniform Fourier transform.

If M is the displayed detector width, internal grid K = 2M, D is the selected longest span, and qD_max is the range slider value:

```text
normalized coordinates: r / D
real-space grid spacing: h/D = pi / (2 qD_max)
reciprocal pixel spacing: delta(qD) = 2 qD_max / M
displayed signed indices: -M/2 ... M/2-1
```

The upper axis label marks the positive extent; the final sampled positive pixel is one q increment short of that boundary. q uses angular spatial frequency (radians/length), not cycles/length. Maps use a common logarithmic color scale; color clipping does not change exported intensities. Positive vertical q points upward; exported q coordinates are explicit.

### Cost and optimizations

- A fixed orientation's three maps cost **O(N + M² log M)**, with **O(N + M²)** working storage. The fixed-grid dependence on N is linear; this avoids the isotropic Debye O(N²) pair sum. An exact direct amplitude calculation at P detector pixels would instead cost O(NP).
- Mesh preparation and initial sampling are separate. A triangle BVH accelerates odd–even point-in-volume tests during bounding-box rejection sampling. Performance depends on geometry, face count, and occupied bounding-box fraction. Very sparse/thin or invalid meshes can time out after about 20 seconds of sampling.
- Sampling and scattering run in background workers. During interaction, the calculation worker completes its current job and retains only the newest pending orientation, avoiding an ever-growing queue.
- Point clouds, FFT plans, twiddle factors, and working arrays are reused. No point resampling happens during rotation. The 3D preview renders at most 7,000 of the calculation points; all N points contribute to scattering.
- Physical span/unit and log-color changes reuse computed normalized intensities. The q range slider changes qD and recalculates. The uniform-density form factor shape is unchanged by a uniform rescaling when q is rescaled with it.

Initial local benchmark, Apple arm64 / Node 25.9, three 128² detectors, 7-rotation median after warmup: 5,000 points 15.3 ms; 20,000 points 15.3 ms; 100,000 points 17.1 ms; 250,000 points 19.5 ms. These timings cover the numerical calculation, excluding import, plot drawing, and worker transfer. The browser reports its own actual calculation time. Hardware, browsers, and larger grids will differ.

### Scientific scope and limits

This is a **single-particle, uniform-contrast form factor**, normalized to forward intensity 1. It does not model interparticle correlations, multiple scattering, spatially varying contrast, polydispersity, instrumental resolution, absolute intensity, or detector curvature. Planes are flat qz=0, qy=0, and qx=0 sections in the small-angle limit.

The plotted plane averages are 2D azimuthal averages. **They are not the 3D orientational average** and must not be interpreted as isotropic solution scattering for a general anisotropic particle.

Monte Carlo self terms produce an expected intensity floor of approximately 1/N. No self-term subtraction is applied. The corresponding continuum form factor becomes unreliable near/below that floor. More points lower sampling noise. At fixed q range, more detector pixels provide denser reciprocal-space sampling by increasing zero padding; the deposition spacing is set by the q range and the fixed 2× oversampling, so a larger detector does not by itself remove gridding error or Monte Carlo noise. Gridding error and finite-point noise are most visible at deep minima and high q.

Imports are limited to 50 MB / 200,000 triangles. OBJ supports vertex positions, face indices (including negatives), and simple planar polygons via ear clipping; materials, transforms, textures, lines, and points are ignored. Apply transforms before exporting. Mesh vertex positions are welded for edge checks at 10^-6 of the original largest span. Self-intersections, overlapping shells, and non-manifold vertices are not fully diagnosed. Nested shells use odd–even filling and represent cavities; overlapping solids should be unioned in a modeling tool first.

## Development and validation

No npm packages are required. Node is needed only to regenerate the portable file and run tests; Python is optional for a local HTTP preview.

```sh
npm run build       # regenerate index.html from src/
npm test            # scientific and mesh-import checks
npm run benchmark   # three-plane calculation at increasing N
npm start           # optional: http://127.0.0.1:8080
npm run preview     # build and serve Cloudflare's dist/ output
npm run deploy:check # validate the Cloudflare package without publishing
npm run deploy      # build and deploy to your signed-in Cloudflare account
```

Tests compare FFT intensities with direct complex sums on all three planes, the sphere analytic form factor, normalization, shared-axis consistency, Friedel symmetry, rotation conventions, uniform-volume moments, actual mesh imports, concave polygons, and malformed/open meshes. `node scripts/make-examples.cjs` regenerates the example files.

## References and relationship to the notes

- [Larsen et al. (2023), *Shape2SAS: a web application to simulate small-angle scattering data and pair distance distributions from user-defined shapes*, J. Appl. Cryst. 56, 1287–1294](https://journals.iucr.org/j/issues/2023/04/00/jl5064/index.html). The supplied paper calculates isotropic scattering using point-pair distances. This MVP follows the proposed alternative of orientation-dependent 2D planes.
- [cw-do/morphsld_sas](https://github.com/cw-do/morphsld_sas), inspected at commit `230a2dfad50b5ea99c7be150df3a8ab45053fcbd`. Its scattering engine transforms radial scattering-length-density profiles and includes analytic sphere validation. It is context rather than an arbitrary-mesh loader or 2D detector engine.

This project is an independent implementation; no source code was copied from either reference. Two example STL assets come from the MIT-licensed Trimesh repository; their upstream notice, pinned source links, and checksums are in `examples/` and embedded in the portable HTML.

Useful next additions: direct-sum spot checks in the UI, GPU deposition/FFT for larger grids, mesh repair and more formats, multiple SLD regions, and a converged orientational average from repeated rotated amplitudes.
