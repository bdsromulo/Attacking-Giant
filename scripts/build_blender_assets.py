import bpy
import bmesh
import math
import os
from mathutils import Vector, Matrix

# Clear default scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# Helper: Blender Z-up -> glTF Y-up exporter maps:
#   Blender +X -> Three.js +X
#   Blender +Z -> Three.js +Y (Up)
#   Blender -Y -> Three.js +Z (Forward)
def to_blender(tx, ty, tz):
    return Vector((tx, -tz, ty))

def from_blender(bv):
    return (bv.x, bv.z, -bv.y)

def finalize_mesh(name, bm, smooth=True, subdiv=0, color_fn=None):
    if subdiv > 0:
        bmesh.ops.subdivide_edges(
            bm,
            edges=bm.edges[:],
            cuts=subdiv,
            use_grid_fill=True,
            smooth=0.65,
        )
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.normal_update()

    # Vertex colors (FloatColor / ByteColor attribute exported as COLOR_0)
    color_layer = bm.loops.layers.color.new("Col")
    for f in bm.faces:
        f.smooth = smooth
        for loop in f.loops:
            v = loop.vert
            tx, ty, tz = from_blender(v.co)
            nx, ny, nz = from_blender(v.normal)
            if color_fn is not None:
                r, g, b = color_fn(tx, ty, tz, nx, ny, nz)
            else:
                r, g, b = (1.0, 1.0, 1.0)
            loop[color_layer] = (
                max(0.0, min(1.0, r)),
                max(0.0, min(1.0, g)),
                max(0.0, min(1.0, b)),
                1.0,
            )

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj

def make_lofted_tube(rings_spec, segs=28, cap_top=True, cap_bot=True):
    """
    rings_spec: list of (ty, rx, rz, cz_off, deform_fn)
    Builds a clean quad tube in Three.js coords converted to Blender coords.
    """
    bm = bmesh.new()
    ring_verts = []
    for (ty, rx, rz, cz_off, dfn) in rings_spec:
        row = []
        for i in range(segs):
            ang = (i / segs) * math.tau
            px = math.sin(ang)
            pz = math.cos(ang)
            tx = px * rx
            tz = pz * rz + cz_off
            vy = ty
            if dfn is not None:
                tx, vy, tz = dfn(tx, vy, tz, px, pz, ang)
            row.append(bm.verts.new(to_blender(tx, vy, tz)))
        ring_verts.append(row)

    for r in range(len(ring_verts) - 1):
        r0 = ring_verts[r]
        r1 = ring_verts[r + 1]
        for i in range(segs):
            ni = (i + 1) % segs
            # Winding so outward normal points away from centerline
            bm.faces.new((r0[i], r0[ni], r1[ni], r1[i]))

    if cap_bot:
        r0 = ring_verts[0]
        c0 = Vector((0, 0, 0))
        for v in r0:
            c0 += v.co
        c0 /= len(r0)
        vc = bm.verts.new(c0)
        for i in range(segs):
            ni = (i + 1) % segs
            bm.faces.new((vc, r0[ni], r0[i]))

    if cap_top:
        rt = ring_verts[-1]
        ct = Vector((0, 0, 0))
        for v in rt:
            ct += v.co
        ct /= len(rt)
        vc = bm.verts.new(ct)
        for i in range(segs):
            ni = (i + 1) % segs
            bm.faces.new((rt[i], rt[ni], vc))

    return bm

def skin_ao(shade):
    """Warm anatomical subsurface AO tint (dark crevices lean slightly warm-crimson, highlights warm ivory)."""
    s = max(0.55, min(1.06, shade))
    r = min(1.0, s * 1.02)
    g = min(1.0, (s ** 1.16) * 0.99)
    b = min(1.0, (s ** 1.28) * 0.96)
    return (r, g, b)

# ==============================================================================
# 1. TITAN TORSO (Origin at spine local (0,0,0), spans y = -0.18 .. +3.62)
# ==============================================================================
def build_titan_torso():
    rings = []
    N = 28
    for k in range(N + 1):
        u = k / N  # 0 = waist/hip junction, 1 = neck base / traps
        ty = -0.18 + u * 3.80
        # Rounded dome taper at very bottom and top
        end_cap = math.sin(max(0.03, min(0.97, u)) * math.pi) ** 0.22
        # Anatomical V-taper width curve
        if u < 0.28:
            w = 1.22 - math.sin((u / 0.28) * math.pi) * 0.11
        elif u < 0.80:
            w = 1.22 + math.sin(((u - 0.28) / 0.52) * math.pi * 0.62) * 0.42
        else:
            t = (u - 0.80) / 0.20
            w = 1.62 * (1.0 - (t ** 1.35) * 0.66)

        d = (0.80 + 0.15 * math.sin(u * math.pi * 0.85)) * end_cap
        rx = w * end_cap

        def dfn(tx, vy, tz, px, pz, ang, uu=u):
            z_add = 0.0
            x_mul = 1.0
            # Front anatomy (+Z)
            if pz > 0.10:
                fp = (pz - 0.10) / 0.90
                # Lower belly + Rectus Abdominis 6-pack + Linea Alba (u = 0.08..0.52)
                if 0.06 < uu < 0.54:
                    bu = (uu - 0.06) / 0.48
                    belly = math.sin(bu * math.pi) * 0.11
                    linea = -0.055 * max(0.0, 1.0 - abs(px) / 0.16)
                    abs_pack = math.sin(bu * math.pi * 3.0) ** 2 * 0.045 * max(0.0, 1.0 - abs(px - 0.22 * (1 if px >= 0 else -1)) / 0.22)
                    obliques = 0.04 * max(0.0, 1.0 - abs(abs(px) - 0.58) / 0.22) * math.sin(bu * math.pi)
                    z_add += (belly + linea + abs_pack + obliques) * fp
                # Ribcage / costal arch (u = 0.44..0.62)
                if 0.42 < uu < 0.62:
                    ru = (uu - 0.42) / 0.20
                    rib_arch = math.sin(ru * math.pi) * 0.06 * max(0.0, abs(px) - 0.15)
                    ribs_ripple = math.sin(ru * math.pi * 4.0) * 0.018 * max(0.0, abs(px) - 0.35)
                    z_add += (rib_arch + ribs_ripple) * fp
                # Pectoralis major slabs + deep sternal furrow (u = 0.55..0.86)
                if 0.54 < uu < 0.87:
                    pu = (uu - 0.54) / 0.33
                    sternum = min(1.0, (abs(px) / 0.18) ** 1.4)
                    pec_slab = (math.sin(pu * math.pi) ** 0.75) * sternum * 0.26 * max(0.0, 1.0 - max(0.0, abs(px) - 0.72) * 2.2)
                    pec_under = -0.075 * math.sin(min(1.0, pu / 0.22) * math.pi) * sternum if pu < 0.22 else 0.0
                    z_add += (pec_slab + pec_under) * fp
                # Clavicle ridge (u = 0.85..0.93)
                if 0.84 < uu < 0.94:
                    cu = (uu - 0.84) / 0.10
                    clav = math.sin(cu * math.pi) * 0.065 * min(1.0, abs(px) / 0.15)
                    z_add += clav * fp
            # Back anatomy (-Z): deep spinal erector groove + scapulae + lats
            elif pz < -0.12:
                bp = (-pz - 0.12) / 0.88
                spine_groove = 0.085 * max(0.0, 1.0 - abs(px) / 0.17) * math.sin(uu * math.pi)
                scapula = -0.09 * math.sin(((uu - 0.55) / 0.32) * math.pi) * max(0.0, 1.0 - abs(abs(px) - 0.48) / 0.28) if 0.55 < uu < 0.87 else 0.0
                z_add += (spine_groove + scapula) * bp
            return (tx * x_mul, vy, tz + z_add)

        rings.append((ty, rx, d, 0.02, dfn))

    bm = make_lofted_tube(rings, segs=36)

    def color_fn(tx, ty, tz, nx, ny, nz):
        u = (ty + 0.18) / 3.80
        shade = 0.94 + 0.06 * max(0.0, ny)
        # Sternum & linea alba & under-pec AO
        if tz > 0.2 and abs(tx) < 0.22 and 0.15 < u < 0.85:
            shade -= 0.14 * (1.0 - abs(tx) / 0.22)
        if tz > 0.35 and 0.52 < u < 0.62 and abs(tx) > 0.18:
            shade -= 0.12 * math.sin(((u - 0.52) / 0.10) * math.pi)
        # Spinal furrow AO
        if tz < -0.2 and abs(tx) < 0.22:
            shade -= 0.13 * (1.0 - abs(tx) / 0.22)
        # Waist / under-rib subtle shadow
        if u < 0.15:
            shade -= 0.08 * (1.0 - u / 0.15)
        return skin_ao(shade)

    return finalize_mesh("titan_torso", bm, smooth=True, color_fn=color_fn)

# ==============================================================================
# 2. TITAN PELVIS (Spans y = -0.62 .. +0.84)
# ==============================================================================
def build_titan_pelvis():
    rings = []
    N = 14
    for k in range(N + 1):
        u = k / N
        ty = -0.60 + u * 1.48
        cap = math.sin(max(0.05, min(0.96, u)) * math.pi) ** 0.28
        rx = (1.16 + 0.12 * math.sin(u * math.pi)) * cap
        rz = (0.78 + 0.08 * math.sin(u * math.pi)) * cap

        def dfn(tx, vy, tz, px, pz, ang, uu=u):
            glute = 0.0
            if pz < -0.15 and 0.15 < uu < 0.82:
                gu = (uu - 0.15) / 0.67
                cleft = min(1.0, abs(px) / 0.16)
                glute = -0.16 * math.sin(gu * math.pi) * cleft * ((-pz - 0.15) / 0.85)
            iliac = 0.05 * math.sin(uu * math.pi) if abs(px) > 0.75 and uu > 0.55 else 0.0
            return (tx + (iliac if tx > 0 else -iliac), vy, tz + glute)

        rings.append((ty, rx, rz, 0.0, dfn))

    bm = make_lofted_tube(rings, segs=28)

    def color_fn(tx, ty, tz, nx, ny, nz):
        shade = 0.92 + 0.06 * ny
        if tz < -0.2 and abs(tx) < 0.18:
            shade -= 0.16 * (1.0 - abs(tx) / 0.18)
        if ty < -0.25:
            shade -= 0.10
        return skin_ao(shade)

    return finalize_mesh("titan_pelvis", bm, smooth=True, color_fn=color_fn)

# ==============================================================================
# 3. TITAN HEAD + RECESSED TEETH (Origin at (0,0,0), spans y = 0 .. 2.08)
# ==============================================================================
def build_titan_head():
    rings = []
    N = 32
    for k in range(N + 1):
        u = k / N  # 0 = chin base, 1 = crown of skull
        ty = u * 2.08
        cap = math.sin(max(0.02, min(0.98, u)) * math.pi) ** 0.30

        # Skull & jaw silhouette
        if u < 0.20:
            w = 0.68 + (u / 0.20) * 0.18
            d = 0.74 + (u / 0.20) * 0.14
        elif u < 0.56:
            su = (u - 0.20) / 0.36
            w = 0.86 + math.sin(su * math.pi) * 0.11  # zygomatic cheekbone flare
            d = 0.88 + math.sin(su * math.pi * 0.7) * 0.08
        else:
            su = (u - 0.56) / 0.44
            w = 0.95 * (1.0 - (su ** 1.8) * 0.22)
            d = 0.96 * (1.0 - (su ** 1.8) * 0.18)

        rx = w * cap
        rz = d * cap

        def dfn(tx, vy, tz, px, pz, ang, uu=u):
            z_off = 0.0
            x_off = 0.0
            if pz > 0.15:
                fp = (pz - 0.15) / 0.85
                # Strong square chin (u = 0.04..0.17)
                if 0.03 < uu < 0.18 and abs(px) < 0.48:
                    cu = (uu - 0.03) / 0.15
                    z_off += 0.11 * math.sin(cu * math.pi) * (1.0 - (abs(px) / 0.48) ** 2) * fp
                # Recessed uncanny Titan grin mouth cavity (u = 0.17..0.34)
                if 0.16 < uu < 0.35 and abs(px) < 0.66:
                    mu = (uu - 0.16) / 0.19
                    mw = 1.0 - (abs(px) / 0.66) ** 2.2
                    z_off -= 0.26 * math.sin(mu * math.pi) * mw * fp
                # Nasolabial / gaunt cheek hollows
                if 0.22 < uu < 0.48 and 0.42 < abs(px) < 0.82:
                    z_off -= 0.065 * math.sin(((uu - 0.22) / 0.26) * math.pi) * fp
                # Sculpted nose bridge & tip (u = 0.40..0.66, |px| < 0.22)
                if 0.39 < uu < 0.67 and abs(px) < 0.23:
                    nu = (uu - 0.39) / 0.28
                    nw = math.cos((abs(px) / 0.23) * math.pi * 0.5) ** 1.5
                    nose_prof = math.sin((1.0 - nu * 0.72) * math.pi * 0.85) * (0.20 if nu < 0.45 else 0.13)
                    z_off += nose_prof * nw * fp
                # Deep sunken orbital eye sockets (u = 0.53..0.68, 0.18 < |px| < 0.68)
                if 0.52 < uu < 0.68 and 0.16 < abs(px) < 0.70:
                    eu = (uu - 0.52) / 0.16
                    ex = 1.0 - abs((abs(px) - 0.43) / 0.27) ** 2
                    z_off -= 0.20 * math.sin(eu * math.pi) * max(0.0, ex) * fp
                # Prominent overhanging brow ridge & glabella (u = 0.66..0.76)
                if 0.65 < uu < 0.77 and abs(px) < 0.74:
                    bu = (uu - 0.65) / 0.12
                    glabella = -0.04 if abs(px) < 0.10 else 0.0
                    z_off += (0.12 * math.sin(bu * math.pi) * (1.0 - (abs(px) / 0.74) ** 2.5) + glabella) * fp
            # Sculpted ears on sides (u = 0.44..0.64, |px| > 0.90)
            if 0.43 < uu < 0.64 and abs(px) > 0.88 and abs(pz) < 0.26:
                eu = (uu - 0.43) / 0.21
                ep = 1.0 - (abs(pz) / 0.26) ** 2
                ear_out = 0.13 * math.sin(eu * math.pi) * ep
                x_off += ear_out if px > 0 else -ear_out
            return (tx + x_off, vy, tz + z_off)

        rings.append((ty, rx, rz, 0.05, dfn))

    bm = make_lofted_tube(rings, segs=40)

    def color_fn(tx, ty, tz, nx, ny, nz):
        u = ty / 2.08
        shade = 0.95 + 0.05 * max(0.0, ny)
        # Dark recessed oral cavity
        if tz > 0.35 and 0.17 < u < 0.34 and abs(tx) < 0.56:
            mu = math.sin(((u - 0.17) / 0.17) * math.pi)
            mw = 1.0 - (abs(tx) / 0.56) ** 2
            dark = mu * mw
            if dark > 0.25:
                return (0.22 + 0.2 * (1 - dark), 0.10 + 0.12 * (1 - dark), 0.10 + 0.12 * (1 - dark))
        # Dark sunken eye sockets (anime Titan shadow around eyes!)
        if tz > 0.40 and 0.52 < u < 0.68 and 0.16 < abs(tx) < 0.66:
            eu = math.sin(((u - 0.52) / 0.16) * math.pi)
            ew = max(0.0, 1.0 - abs((abs(tx) - 0.42) / 0.25) ** 2)
            shade -= 0.38 * eu * ew
        # Under-nose & nasolabial shadow
        if tz > 0.55 and 0.35 < u < 0.43 and abs(tx) < 0.22:
            shade -= 0.16
        return skin_ao(shade)

    return finalize_mesh("titan_head", bm, smooth=True, color_fn=color_fn)

def build_titan_teeth():
    """Recessed curved upper & lower Titan teeth arches + gum ridge inside the mouth cavity."""
    bm = bmesh.new()
    n_teeth = 10
    for row_idx, (y_base, y_dir) in enumerate([(0.58, -1.0), (0.35, 1.0)]):
        for i in range(n_teeth):
            u = (i + 0.5) / n_teeth - 0.5  # -0.5 .. +0.5
            ang = u * 1.18
            rad_x = 0.50
            rad_z = 0.72
            cx = math.sin(ang) * rad_x
            cz = math.cos(ang) * rad_z + 0.04
            tw = 0.046 * (1.08 if abs(u) < 0.22 else 0.92)
            th = 0.105
            td = 0.042

            # Create slightly tapered tooth prism rotated along jaw arch
            bmesh.ops.create_cube(bm, size=1.0)
            # Get last 8 verts
            verts = bm.verts[-8:]
            rot_y = Matrix.Rotation(-ang, 4, 'Z')  # around Blender Z = Three.js Y
            for v in verts:
                # v.co is -0.5..0.5
                lx = v.co.x * tw * 2.0
                ly = v.co.z  # -0.5..0.5 vertical
                lz = v.co.y * td * 2.0
                taper = 0.84 if (ly * y_dir > 0) else 1.0
                tx = cx + (lx * taper) * math.cos(ang) + lz * math.sin(ang)
                tz = cz - (lx * taper) * math.sin(ang) + lz * math.cos(ang)
                ty = y_base + (ly + 0.5 * y_dir) * th
                v.co = to_blender(tx, ty, tz)

    def color_fn(tx, ty, tz, nx, ny, nz):
        # Slightly stained ivory at roots, brighter enamel at tips
        root_dist = min(abs(ty - 0.58), abs(ty - 0.35)) / 0.105
        s = 0.80 + 0.18 * min(1.0, root_dist)
        return (s * 0.96, s * 0.92, s * 0.80)

    return finalize_mesh("titan_teeth", bm, smooth=False, color_fn=color_fn)

# ==============================================================================
# 4. TITAN LIMBS (Normalized length = 1.0 going from y = 0 down to y = -1.0, plus overlap cap)
# ==============================================================================
def build_titan_upper_arm():
    # Built for Left arm (+X deltoid); Right arm mirrors scale.x = -1 or works symmetrically
    rings = []
    N = 16
    for k in range(N + 1):
        u = k / N  # 0 = elbow (-2.42), 1 = shoulder (+0.14)
        ty = -2.42 + u * 2.56
        cap = math.sin(max(0.03, min(0.97, u)) * math.pi) ** 0.24
        r_base = (0.37 + 0.16 * u) * cap

        def dfn(tx, vy, tz, px, pz, ang, uu=u):
            # Biceps bulge (+Z) around u=0.48, deltoid cap (+X) around u=0.78, triceps (-Z) around u=0.58
            bicep = 0.08 * math.sin(((uu - 0.18) / 0.62) * math.pi) * max(0.0, pz) if 0.18 < uu < 0.80 else 0.0
            tricep = -0.06 * math.sin(((uu - 0.30) / 0.55) * math.pi) * max(0.0, -pz) if 0.30 < uu < 0.85 else 0.0
            delt = 0.11 * math.sin(((uu - 0.58) / 0.40) * math.pi) * max(0.0, px) if 0.58 < uu < 0.98 else 0.0
            return (tx + delt, vy, tz + bicep + tricep)

        rings.append((ty, r_base, r_base, 0.0, dfn))

    bm = make_lofted_tube(rings, segs=22)
    return finalize_mesh("titan_upper_arm", bm, smooth=True, color_fn=lambda tx, ty, tz, nx, ny, nz: skin_ao(0.92 + 0.07 * max(0.0, ny)))

def build_titan_forearm():
    rings = []
    N = 14
    for k in range(N + 1):
        u = k / N  # 0 = wrist (-2.22), 1 = elbow (+0.10)
        ty = -2.22 + u * 2.32
        cap = math.sin(max(0.03, min(0.97, u)) * math.pi) ** 0.22
        swell = math.sin(((u - 0.42) / 0.55) * math.pi) * 0.065 if 0.42 < u < 0.97 else 0.0
        rx = (0.27 + 0.14 * u + swell) * cap
        rz = (0.24 + 0.15 * u + swell * 0.8) * cap
        rings.append((ty, rx, rz, 0.0, None))

    bm = make_lofted_tube(rings, segs=20)
    return finalize_mesh("titan_forearm", bm, smooth=True, color_fn=lambda tx, ty, tz, nx, ny, nz: skin_ao(0.92 + 0.06 * max(0.0, ny)))

def build_titan_hand():
    """Sculpted Left Titan hand (+X side): palm + 4 curled fingers + thumb in one mesh."""
    bm = bmesh.new()
    # Palm loft from wrist (y=0.05) to knuckles (y=-0.56)
    palm_rings = [
        (0.06, 0.26, 0.17, 0.0, None),
        (-0.12, 0.34, 0.19, 0.01, None),
        (-0.36, 0.38, 0.18, 0.02, None),
        (-0.54, 0.36, 0.15, 0.02, None),
        (-0.60, 0.31, 0.10, 0.02, None),
    ]
    bm_palm = make_lofted_tube(palm_rings, segs=18)
    for v in bm_palm.verts:
        bm.verts.new(v.co)
    bm.verts.ensure_lookup_table()
    # Rebuild via temporary mesh merge for clean topology
    bm_palm.free()

    meshes_to_join = []
    # Palm
    m_palm = make_lofted_tube(palm_rings, segs=18)
    meshes_to_join.append(m_palm)

    # 4 Fingers
    finger_specs = [
        (-0.25, 0.50, 0.072),
        (-0.08, 0.56, 0.076),
        (0.09, 0.53, 0.074),
        (0.25, 0.44, 0.066),
    ]
    for fx, flen, fr in finger_specs:
        f_rings = []
        for k in range(7):
            u = k / 6
            curl = (u ** 1.6) * 0.18
            fy = -0.52 - u * flen
            fz = 0.02 + curl
            cap = math.sin(max(0.06, min(0.95, 1.0 - u * 0.85)) * math.pi * 0.5)
            r = fr * (1.0 - u * 0.25) * max(0.35, cap)
            f_rings.append((fy, r, r, fz, lambda tx, vy, tz, px, pz, ang, x0=fx: (tx + x0, vy, tz)))
        meshes_to_join.append(make_lofted_tube(f_rings, segs=10))

    # Thumb (-X inner side for Left hand)
    t_rings = []
    for k in range(6):
        u = k / 5
        tx0 = -0.28 - u * 0.18
        ty0 = -0.22 - u * 0.34
        tz0 = 0.06 + u * 0.16
        r = 0.082 * (1.0 - u * 0.25) * (0.55 if k == 5 else 1.0)
        t_rings.append((ty0, r, r, tz0, lambda tx, vy, tz, px, pz, ang, x0=tx0: (tx + x0, vy, tz)))
    meshes_to_join.append(make_lofted_tube(t_rings, segs=10))

    bm.free()
    bm = bmesh.new()
    for sub in meshes_to_join:
        sub.verts.index_update()
        vmap = {}
        for v in sub.verts:
            vmap[v.index] = bm.verts.new(v.co)
        for f in sub.faces:
            bm.faces.new([vmap[v.index] for v in f.verts])
        sub.free()

    return finalize_mesh("titan_hand", bm, smooth=True, color_fn=lambda tx, ty, tz, nx, ny, nz: skin_ao(0.86 + 0.08 * max(0.0, ny)))

def build_titan_thigh():
    rings = []
    N = 16
    for k in range(N + 1):
        u = k / N  # 0 = knee (-2.44), 1 = hip (+0.14)
        ty = -2.44 + u * 2.58
        cap = math.sin(max(0.03, min(0.97, u)) * math.pi) ** 0.24
        rx = (0.48 + 0.25 * u) * cap
        rz = (0.50 + 0.25 * u) * cap

        def dfn(tx, vy, tz, px, pz, ang, uu=u):
            quad = 0.12 * math.sin(uu * math.pi) * max(0.0, pz)
            ham = -0.07 * math.sin(uu * math.pi) * max(0.0, -pz)
            return (tx, vy, tz + quad + ham)

        rings.append((ty, rx, rz, 0.0, dfn))

    bm = make_lofted_tube(rings, segs=24)
    return finalize_mesh("titan_thigh", bm, smooth=True, color_fn=lambda tx, ty, tz, nx, ny, nz: skin_ao(0.92 + 0.06 * max(0.0, ny)))

def build_titan_calf():
    rings = []
    N = 16
    for k in range(N + 1):
        u = k / N  # 0 = ankle (-2.22), 1 = knee (+0.10)
        ty = -2.22 + u * 2.32
        cap = math.sin(max(0.03, min(0.97, u)) * math.pi) ** 0.22
        rx = (0.32 + 0.19 * u) * cap
        rz = (0.34 + 0.18 * u) * cap

        def dfn(tx, vy, tz, px, pz, ang, uu=u):
            # High gastrocnemius calf muscle at back (-Z) around u = 0.62
            calf = -0.16 * math.sin(((uu - 0.30) / 0.62) * math.pi) * max(0.0, -pz) if 0.30 < uu < 0.92 else 0.0
            shin = 0.035 * max(0.0, pz) * (1.0 - abs(px) * 0.7)
            return (tx, vy, tz + calf + shin)

        rings.append((ty, rx, rz, 0.0, dfn))

    bm = make_lofted_tube(rings, segs=22)
    return finalize_mesh("titan_calf", bm, smooth=True, color_fn=lambda tx, ty, tz, nx, ny, nz: skin_ao(0.91 + 0.06 * max(0.0, ny)))

def build_titan_foot():
    """Anatomical flat-soled Titan foot: ankle at (0,0,0), sole at y = -0.22, heel z = -0.52, toes z = +1.15."""
    bm = bmesh.new()
    segs = 20
    # Loft from heel (-Z) to toes (+Z) along Z!
    z_slices = [
        (-0.52, 0.26, 0.16, -0.04),
        (-0.36, 0.36, 0.24, 0.02),
        (-0.05, 0.39, 0.26, 0.04),
        (0.32, 0.43, 0.21, -0.02),
        (0.72, 0.46, 0.15, -0.07),
        (1.02, 0.42, 0.11, -0.10),
        (1.14, 0.32, 0.07, -0.12),
    ]
    ring_verts = []
    for (tz, rx, ry, cy) in z_slices:
        row = []
        for i in range(segs):
            ang = (i / segs) * math.tau
            tx = math.cos(ang) * rx
            ty = cy + math.sin(ang) * ry
            if ty < -0.20:
                ty = -0.20  # flat plantar sole!
            row.append(bm.verts.new(to_blender(tx, ty, tz)))
        ring_verts.append(row)

    for r in range(len(ring_verts) - 1):
        r0, r1 = ring_verts[r], ring_verts[r + 1]
        for i in range(segs):
            ni = (i + 1) % segs
            bm.faces.new((r0[i], r1[i], r1[ni], r0[ni]))

    # Cap heel and toe ends
    for end_row, flip in [(ring_verts[0], False), (ring_verts[-1], True)]:
        c = sum((v.co for v in end_row), Vector((0, 0, 0))) / segs
        vc = bm.verts.new(c)
        for i in range(segs):
            ni = (i + 1) % segs
            bm.faces.new((vc, end_row[i], end_row[ni]) if flip else (vc, end_row[ni], end_row[i]))

    return finalize_mesh("titan_foot", bm, smooth=True, color_fn=lambda tx, ty, tz, nx, ny, nz: skin_ao(0.84 + 0.08 * max(0.0, ny)))

# ==============================================================================
# 5. ENVIRONMENT PROPS: WALL CANNON, STREET LAMP, SUPPLY WAGON, FOUNTAIN, TREES
# ==============================================================================
def add_box(bm, cx, cy, cz, sx, sy, sz, rot_y=0.0, color=(1, 1, 1), tag_dict=None):
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res["verts"]
    ca, sa = math.cos(rot_y), math.sin(rot_y)
    for v in verts:
        lx = v.co.x * sx
        ly = v.co.z * sy
        lz = v.co.y * sz
        rx = lx * ca + lz * sa + cx
        rz = -lx * sa + lz * ca + cz
        ry = ly + cy
        v.co = to_blender(rx, ry, rz)
        if tag_dict is not None:
            tag_dict[v] = color

def add_cyl(bm, cx, cy, cz, r1, r2, length, axis='Y', segs=14, color=(1, 1, 1), tag_dict=None):
    rings = []
    for k, u in enumerate([0.0, 1.0]):
        r = r1 if k == 0 else r2
        t = (u - 0.5) * length
        row = []
        for i in range(segs):
            ang = (i / segs) * math.tau
            a, b = math.cos(ang) * r, math.sin(ang) * r
            if axis == 'Y':
                tx, ty, tz = cx + a, cy + t, cz + b
            elif axis == 'Z':
                tx, ty, tz = cx + a, cy + b, cz + t
            else:  # 'X'
                tx, ty, tz = cx + t, cy + b, cz + a
            v = bm.verts.new(to_blender(tx, ty, tz))
            if tag_dict is not None:
                tag_dict[v] = color
            row.append(v)
        rings.append(row)
    for i in range(segs):
        ni = (i + 1) % segs
        if axis == 'Z':
            bm.faces.new((rings[0][i], rings[1][i], rings[1][ni], rings[0][ni]))
        else:
            bm.faces.new((rings[0][i], rings[0][ni], rings[1][ni], rings[1][i]))
    for idx, flip in [(0, axis == 'Z'), (1, axis != 'Z')]:
        row = rings[idx]
        c = sum((v.co for v in row), Vector((0, 0, 0))) / segs
        vc = bm.verts.new(c)
        if tag_dict is not None:
            tag_dict[vc] = color
        for i in range(segs):
            ni = (i + 1) % segs
            bm.faces.new((row[i], row[ni], vc) if flip else (vc, row[ni], row[i]))

def finalize_tagged(name, bm, tag_dict, smooth=False):
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.normal_update()
    color_layer = bm.loops.layers.color.new("Col")
    for f in bm.faces:
        f.smooth = smooth
        for loop in f.loops:
            c = tag_dict.get(loop.vert, (0.8, 0.8, 0.8))
            _, _, _, _, ny, _ = (*from_blender(loop.vert.co), *from_blender(loop.vert.normal))
            ao = 0.88 + 0.12 * max(0.0, ny)
            loop[color_layer] = (min(1.0, c[0] * ao), min(1.0, c[1] * ao), min(1.0, c[2] * ao), 1.0)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj

def build_wall_cannon():
    """AoT Wall Garrison artillery cannon on heavy timber carriage + iron wheels, pointing +Z."""
    bm = bmesh.new()
    tc = {}
    wood = (0.42, 0.28, 0.17)
    wood_dk = (0.30, 0.20, 0.12)
    iron = (0.23, 0.25, 0.27)
    bronze = (0.34, 0.32, 0.28)

    # Wooden side cheeks of carriage
    for s in (-1, 1):
        add_box(bm, s * 0.46, 0.68, -0.25, 0.18, 0.48, 2.25, color=wood, tag_dict=tc)
        add_box(bm, s * 0.46, 0.98, 0.25, 0.20, 0.28, 1.15, color=wood_dk, tag_dict=tc)
    # Cross transoms & trail
    add_box(bm, 0.0, 0.56, -1.15, 0.85, 0.26, 0.45, color=wood_dk, tag_dict=tc)
    add_box(bm, 0.0, 0.65, 0.35, 1.32, 0.22, 0.24, color=iron, tag_dict=tc)  # axle
    # Spoked wheels (left & right)
    for s in (-1, 1):
        wx = s * 0.72
        add_cyl(bm, wx, 0.68, 0.35, 0.68, 0.68, 0.14, axis='X', segs=18, color=wood_dk, tag_dict=tc)
        add_cyl(bm, wx + s * 0.02, 0.68, 0.35, 0.20, 0.20, 0.22, axis='X', segs=12, color=iron, tag_dict=tc)
    # Tapered cannon barrel + reinforcing rings + muzzle flare + cascabel
    add_cyl(bm, 0.0, 1.16, 0.55, 0.30, 0.21, 2.75, axis='Z', segs=18, color=bronze, tag_dict=tc)
    add_cyl(bm, 0.0, 1.16, 1.88, 0.25, 0.27, 0.22, axis='Z', segs=18, color=iron, tag_dict=tc)  # muzzle ring
    add_cyl(bm, 0.0, 1.16, -0.88, 0.14, 0.14, 0.24, axis='Z', segs=12, color=iron, tag_dict=tc)  # cascabel knob
    add_cyl(bm, 0.0, 1.16, 0.10, 0.33, 0.33, 0.18, axis='Z', segs=18, color=iron, tag_dict=tc)  # trunnion band
    # Stacked cannonballs beside carriage
    for bx, bz in [(-0.85, -0.6), (-0.65, -0.8), (-0.85, -0.95)]:
        add_cyl(bm, bx, 0.16, bz, 0.16, 0.15, 0.28, axis='Y', segs=10, color=iron, tag_dict=tc)
    return finalize_tagged("wall_cannon", bm, tc, smooth=True)

def build_street_lamp():
    """Victorian/Germanic wrought-iron street lamppost (height 5.2m)."""
    bm = bmesh.new()
    tc = {}
    iron = (0.18, 0.20, 0.22)
    gold = (0.98, 0.84, 0.48)
    add_cyl(bm, 0, 0.35, 0, 0.26, 0.18, 0.70, axis='Y', segs=10, color=iron, tag_dict=tc)
    add_cyl(bm, 0, 2.45, 0, 0.11, 0.075, 3.60, axis='Y', segs=10, color=iron, tag_dict=tc)
    add_box(bm, 0, 4.28, 0, 0.52, 0.08, 0.52, color=iron, tag_dict=tc)
    # Glowing warm glass lantern housing
    add_cyl(bm, 0, 4.62, 0, 0.19, 0.25, 0.58, axis='Y', segs=8, color=gold, tag_dict=tc)
    # Cap & finial
    add_cyl(bm, 0, 5.02, 0, 0.30, 0.03, 0.28, axis='Y', segs=8, color=iron, tag_dict=tc)
    return finalize_tagged("street_lamp", bm, tc, smooth=False)

def build_supply_wagon():
    """Medieval wooden supply cart with barrels/crates (origin y=0)."""
    bm = bmesh.new()
    tc = {}
    wood = (0.48, 0.34, 0.20)
    wood_lt = (0.62, 0.47, 0.30)
    iron = (0.24, 0.25, 0.27)
    steel = (0.56, 0.60, 0.64)
    # Bed + side rails
    add_box(bm, 0, 0.82, 0, 1.85, 0.16, 3.20, color=wood, tag_dict=tc)
    for s in (-1, 1):
        add_box(bm, s * 0.88, 1.22, 0, 0.10, 0.68, 3.20, color=wood_lt, tag_dict=tc)
        # Front & rear wheels
        for wz in (-0.95, 0.95):
            add_cyl(bm, s * 1.02, 0.58, wz, 0.58, 0.58, 0.12, axis='X', segs=16, color=wood, tag_dict=tc)
            add_cyl(bm, s * 1.04, 0.58, wz, 0.15, 0.15, 0.18, axis='X', segs=10, color=iron, tag_dict=tc)
    add_box(bm, 0, 1.22, -1.55, 1.85, 0.68, 0.10, color=wood_lt, tag_dict=tc)
    # Shafts in front
    for s in (-1, 1):
        add_box(bm, s * 0.45, 0.78, 2.25, 0.10, 0.10, 1.45, color=wood, tag_dict=tc)
    # ODM Gas cylinders & supply crates in the bed
    add_box(bm, -0.35, 1.26, -0.55, 0.82, 0.72, 0.82, color=wood_lt, tag_dict=tc)
    for gx, gz in [(0.42, -0.65), (0.42, 0.05), (0.42, 0.75)]:
        add_cyl(bm, gx, 1.32, gz, 0.24, 0.24, 0.88, axis='Y', segs=12, color=steel, tag_dict=tc)
    return finalize_tagged("supply_wagon", bm, tc, smooth=False)

def build_fountain():
    """Octagonal stone town plaza fountain with tiered bowls and water surface."""
    bm = bmesh.new()
    tc = {}
    stone = (0.64, 0.61, 0.56)
    stone_dk = (0.50, 0.48, 0.44)
    water = (0.34, 0.62, 0.76)
    # Outer basin rim + floor + water
    add_cyl(bm, 0, 0.42, 0, 2.95, 3.10, 0.84, axis='Y', segs=8, color=stone, tag_dict=tc)
    add_cyl(bm, 0, 0.76, 0, 2.55, 2.55, 0.20, axis='Y', segs=8, color=water, tag_dict=tc)
    # Central pedestal + upper bowl + finial
    add_cyl(bm, 0, 1.45, 0, 0.48, 0.36, 1.80, axis='Y', segs=8, color=stone_dk, tag_dict=tc)
    add_cyl(bm, 0, 2.38, 0, 1.05, 1.35, 0.36, axis='Y', segs=8, color=stone, tag_dict=tc)
    add_cyl(bm, 0, 2.52, 0, 1.15, 1.15, 0.12, axis='Y', segs=8, color=water, tag_dict=tc)
    add_cyl(bm, 0, 2.95, 0, 0.24, 0.08, 0.82, axis='Y', segs=8, color=stone_dk, tag_dict=tc)
    return finalize_tagged("fountain", bm, tc, smooth=False)

def build_giant_tree_trunk():
    """Normalized (radius ~ 0.5, height = 1.0, base at y=0) fluted sequoia trunk with flared buttress roots!"""
    rings = []
    N = 14
    for k in range(N + 1):
        u = k / N
        ty = u
        # Flared root buttress at bottom (u < 0.16), gentle taper toward crown
        buttress = 1.0 + 0.68 * ((1.0 - min(1.0, u / 0.15)) ** 2.2)
        taper = 1.0 - u * 0.34
        r = 0.50 * taper * buttress

        def dfn(tx, vy, tz, px, pz, ang, uu=u):
            flute_amp = 0.14 * ((1.0 - min(1.0, uu / 0.22)) ** 1.5) + 0.03
            flute = 1.0 + math.sin(ang * 7.0 + uu * 2.5) * flute_amp
            return (tx * flute, vy, tz * flute)

        rings.append((ty, r, r, 0.0, dfn))

    bm = make_lofted_tube(rings, segs=20, cap_top=True, cap_bot=False)

    def color_fn(tx, ty, tz, nx, ny, nz):
        # Darker mossy/earthy AO near base roots, warm bark higher up
        ao = 0.62 + 0.38 * min(1.0, ty / 0.18)
        furrow = 0.90 + 0.10 * math.sin(math.atan2(tx, tz) * 14.0)
        s = ao * furrow
        return (s, s * 0.96, s * 0.92)

    return finalize_mesh("giant_tree_trunk", bm, smooth=True, color_fn=color_fn)

def build_foliage_cluster():
    """Sculpted multi-lobed anime tree canopy cluster (unit ~ 1x1x1 centered at origin) with top-sunlit AO."""
    bm = bmesh.new()
    lobes = [
        (0.0, 0.08, 0.0, 0.52, 0.42, 0.52),
        (0.24, -0.04, 0.18, 0.38, 0.32, 0.38),
        (-0.26, -0.02, 0.16, 0.36, 0.30, 0.36),
        (0.18, -0.05, -0.24, 0.37, 0.30, 0.37),
        (-0.20, 0.02, -0.22, 0.35, 0.31, 0.35),
        (0.0, 0.24, 0.02, 0.36, 0.28, 0.36),
    ]
    for (cx, cy, cz, sx, sy, sz) in lobes:
        res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        for v in res["verts"]:
            tx = cx + v.co.x * sx
            ty = cy + v.co.z * sy
            tz = cz + v.co.y * sz
            v.co = to_blender(tx, ty, tz)

    def color_fn(tx, ty, tz, nx, ny, nz):
        # Anime painterly canopy gradient: bright warm lime-emerald on sunlit top, rich deep jade underneath!
        t = max(0.0, min(1.0, (ty + 0.38) / 0.82 * 0.65 + (ny * 0.5 + 0.5) * 0.35))
        r = 0.52 + t * 0.56
        g = 0.62 + t * 0.46
        b = 0.55 + t * 0.35
        return (min(1.0, r), min(1.0, g), min(1.0, b))

    return finalize_mesh("foliage_cluster", bm, smooth=True, color_fn=color_fn)

# Build all objects
objs = [
    build_titan_torso(),
    build_titan_pelvis(),
    build_titan_head(),
    build_titan_teeth(),
    build_titan_upper_arm(),
    build_titan_forearm(),
    build_titan_hand(),
    build_titan_thigh(),
    build_titan_calf(),
    build_titan_foot(),
    build_wall_cannon(),
    build_street_lamp(),
    build_supply_wagon(),
    build_fountain(),
    build_giant_tree_trunk(),
    build_foliage_cluster(),
]

out_dir = os.path.join(os.getcwd(), "public", "models")
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, "assets.glb")

bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format='GLB',
    export_yup=True,
    export_apply=True,
    export_normals=True,
    export_attributes=True,
)

print("SUCCESS! Exported:", out_path, "Size:", os.path.getsize(out_path), "bytes")
for o in objs:
    print(f"  - {o.name:20s} verts={len(o.data.vertices):5d} tris={len(o.data.polygons):5d}")
