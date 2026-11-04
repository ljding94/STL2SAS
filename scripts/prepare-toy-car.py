"""Run with Blender: --background --factory-startup --python this.py -- input.glb output.stl.

Creates a solid, simplified STL from Khronos' CC0 ToyCar scene. The decorative
fabric base is omitted; body and glass are joined, voxel-unioned, and decimated.
This preprocessing is a geometry approximation, not a runtime app dependency.
"""
import bpy
import bmesh
import mathutils
import struct
import sys
from pathlib import Path

args = sys.argv[sys.argv.index('--') + 1:]
source, destination = map(Path, args)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))
bpy.context.view_layer.update()
objects = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name in ('ToyCar', 'Glass')]
assert len(objects) == 2, 'Expected the pinned ToyCar scene with body and glass meshes.'
for obj in bpy.context.scene.objects:
    obj.select_set(obj in objects)
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.join()
obj = bpy.context.object
coordinates = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
low = [min(v[a] for v in coordinates) for a in range(3)]
high = [max(v[a] for v in coordinates) for a in range(3)]
spans = [high[a] - low[a] for a in range(3)]
long_axis, up_axis = max(range(3), key=spans.__getitem__), min(range(3), key=spans.__getitem__)
width_axis = next(a for a in range(3) if a not in (long_axis, up_axis))
axes = [long_axis, width_axis, up_axis]
factor = 160 / max(spans)
for vertex, point in zip(obj.data.vertices, coordinates):
    vertex.co = [(point[a] - (low[a] + high[a]) / 2) * factor for a in axes]
obj.matrix_world = mathutils.Matrix.Identity(4)
# glTF display meshes can contain zero-thickness panels. Give those panels
# finite walls before voxel conversion so the car body is not discarded.
solidify = obj.modifiers.new('Finite walls for display surfaces', 'SOLIDIFY')
solidify.thickness = 1.5
solidify.offset = -1
solidify.use_even_offset = True
solidify.use_quality_normals = True
bpy.ops.object.modifier_apply(modifier=solidify.name)
remesh = obj.modifiers.new('Closed solid for volume sampling', 'REMESH')
remesh.mode = 'VOXEL'
remesh.voxel_size = 0.65
remesh.use_smooth_shade = True
bpy.ops.object.modifier_apply(modifier=remesh.name)
obj.data.calc_loop_triangles()
target = 28000
if len(obj.data.loop_triangles) > target:
    decimate = obj.modifiers.new('Interactive example mesh', 'DECIMATE')
    decimate.ratio = target / len(obj.data.loop_triangles)
    bpy.ops.object.modifier_apply(modifier=decimate.name)
final_spans = [max(v.co[a] for v in obj.data.vertices) - min(v.co[a] for v in obj.data.vertices) for a in range(3)]
final_scale = 160 / max(final_spans)
for vertex in obj.data.vertices:
    vertex.co *= final_scale
bm = bmesh.new()
bm.from_mesh(obj.data)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
assert all(edge.is_manifold for edge in bm.edges), 'Prepared model must be a closed two-manifold.'
bm.to_mesh(obj.data)
bm.free()
obj.data.calc_loop_triangles()
faces = obj.data.loop_triangles
destination.parent.mkdir(parents=True, exist_ok=True)
with destination.open('wb') as file:
    file.write(b'STL2SAS CC0 ToyCar derived from Khronos; see TOY-CAR-LICENSE.txt'.ljust(80, b' '))
    file.write(struct.pack('<I', len(faces)))
    for face in faces:
        values = [*face.normal]
        for index in face.vertices:
            values.extend(obj.data.vertices[index].co)
        file.write(struct.pack('<12fH', *values, 0))
print(f'Prepared {destination}: {len(faces)} triangles; {destination.stat().st_size} bytes')
