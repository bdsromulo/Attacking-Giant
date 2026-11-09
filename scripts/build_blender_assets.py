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

def merge_bmeshes(bmeshes):
    bm = bmesh.new()
    for sub in bmeshes:
        sub.verts.index_update()
        vmap = {}
        for v in sub.verts:
            vmap[v.index] = bm.verts.new(v.co)
        for f in sub.faces:
            try:
                bm.faces.new([vmap[v.index] for v in f.verts])
            except ValueError:
                pass
        sub.free()
    return bm

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
            bm.faces.new((r0[i], r0[ni], r1[ni], r1[i]))

    if cap_bot:
        r0 = ring_verts[0]
        c0 = sum((v.co for v in r0), Vector((0, 0, 0))) / len(r0)
        vc = bm.verts.new(c0)
        for i in range(segs):
            ni = (i + 1) % segs
            bm.faces.new((vc, r0[ni], r0[i]))

    if cap_top:
        rt = ring_verts[-1]
        ct = sum((v.co for v in rt), Vector((0, 0, 0))) / len(rt)
        vc = bm.verts.new(ct)
        for i in range(segs):
            ni = (i + 1) % segs
            bm.faces.new((rt[i], rt[ni], vc))

    return bm

def joint_cap_factor(ty, y_bot_pivot, y_bot_tip, y_top_pivot, y_top_tip):
    """
    Maintains 1.0 throughout the shaft and only tapers deep inside the hidden socket overlap
    regions [y_bot_tip, y_bot_pivot] and [y_top_pivot, y_top_tip], preventing vertical normal
    seams or sausage pinching at joints.
    """
    if ty < y_bot_pivot:
        t = max(0.0, min(1.0, (y_bot_pivot - ty) / max(1e-4, y_bot_pivot - y_bot_tip)))
        return max(0.20, 1.0 - (t ** 2.2) * 0.78)
    if ty > y_top_pivot:
        t = max(0.0, min(1.0, (ty - y_top_pivot) / max(1e-4, y_top_tip - y_top_pivot)))
        return max(0.20, 1.0 - (t ** 2.2) * 0.78)
    return 1.0

def skin_ao(shade):
    """Warm anatomical subsurface AO tint (dark crevices lean warm-crimson, highlights warm ivory)."""
    s = max(0.48, min(1.06, shade))
    r = min(1.0, s * 1.02)
    g = min(1.0, (s ** 1.18) * 0.98)
    b = min(1.0, (s ** 1.32) * 0.95)
    return (r, g, b)

def bone_ao(shade):
    """Hardened osteoderm bone-armor shading (ivory crests, warm stone midtones, dark umber crevices)."""
    s = max(0.32, min(1.06, shade))
    return (
        min(1.0, s * 0.99),
        min(1.0, (s ** 1.06) * 0.95),
        min(1.0, (s ** 1.15) * 0.87),
    )

# ==============================================================================
# 1. TITAN TORSO (Origin at spine (0,0,0) = y_body 0.44; spans ty = -0.64 .. +3.58)
#    Covers chest, ribcage, 6-pack abs, obliques, iliac crest, hips & glutes in ONE
#    continuous mesh so there is ZERO waist/pelvis seam!
# ==============================================================================
def _torso_profile(u):
    """
    u = 0.00 -> ty = -0.64 (y_body = -0.20: lower glute / hip socket level)
    u = 0.16 -> ty =  0.04 (y_body = +0.48: iliac crest / upper pelvis)
    u = 0.34 -> ty =  0.80 (y_body = +1.24: narrowest waist / external obliques)
    u = 0.80 -> ty =  2.74 (y_body = +3.18: upper chest / latissimus / shoulder breadth)
    u = 1.00 -> ty =  3.58 (y_body = +4.02: trapezius collar meeting neck base)
    """
    ty = -0.64 + u * 4.22
    cap = joint_cap_factor(ty, -0.46, -0.64, 3.44, 3.58)

    if u < 0.18:
        # Hip & iliac crest fullness (y_body = -0.20 .. +0.56)
        t = u / 0.18
        w = 1.06 + 0.08 * math.sin(t * math.pi * 0.75)
        d = 0.72 + 0.05 * math.sin(t * math.pi * 0.75)
    elif u < 0.36:
        # Natural waist & obliques (gentle athletic taper, no pinch)
        t = (u - 0.18) / 0.18
        w = 1.12 - 0.03 * math.sin(t * math.pi) + 0.08 * t
        d = 0.76 + 0.04 * t
    elif u < 0.82:
        # Ribcage, latissimus dorsi V-taper & pectoral breadth
        t = (u - 0.36) / 0.46
        w = 1.17 + 0.45 * math.sin(t * math.pi * 0.62)
        d = 0.80 + 0.14 * math.sin(t * math.pi * 0.75)
    else:
        # Acromion & trapezius slope into neck base
        t = (u - 0.82) / 0.18
        w = 1.56 * (1.0 - (t ** 1.45) * 0.58)
        d = 0.88 * (1.0 - (t ** 1.45) * 0.38)

    return ty, w * cap, d * cap

def build_titan_torso(colossus=False):
    rings = []
    N = 46
    for k in range(N + 1):
        u = k / N
        ty, rx, rz = _torso_profile(u)

        def dfn(tx, vy, tz, px, pz, ang, uu=u):
            z_add = 0.0
            x_add = 0.0
            apx = abs(px)

            # Front anatomy (+Z)
            if pz > 0.08:
                fp = (pz - 0.08) / 0.92
                # Inguinal V-line & lower abdomen (u = 0.06..0.24)
                if 0.05 < uu < 0.24:
                    iu = (uu - 0.05) / 0.19
                    z_add += 0.045 * math.sin(iu * math.pi) * max(0.0, 1.0 - apx / 0.58) * fp
                # Rectus abdominis (6-pack), linea alba & external obliques (u = 0.16..0.58)
                if 0.16 < uu < 0.58:
                    bu = (uu - 0.16) / 0.42
                    belly = math.sin(bu * math.pi) * 0.085
                    linea = -0.060 * max(0.0, 1.0 - apx / 0.14) * math.sin(bu * math.pi)
                    rectus_col = max(0.0, 1.0 - abs(apx - 0.22) / 0.20)
                    abs_pack = (math.sin(bu * math.pi * 3.0) ** 2) * 0.052 * rectus_col
                    tendon_groove = -0.024 * (math.cos(bu * math.pi * 3.0) ** 6) * rectus_col
                    obliques = 0.055 * max(0.0, 1.0 - abs(apx - 0.64) / 0.24) * math.sin(bu * math.pi)
                    z_add += (belly + linea + abs_pack + tendon_groove + obliques) * fp
                # Ribcage / costal arch & serratus anterior (u = 0.46..0.66)
                if 0.46 < uu < 0.66:
                    ru = (uu - 0.46) / 0.20
                    rib_arch = math.sin(ru * math.pi) * 0.065 * max(0.0, 1.0 - abs(apx - 0.46) / 0.32)
                    serratus = math.sin(ru * math.pi * 4.0) * 0.028 * max(0.0, 1.0 - abs(apx - 0.72) / 0.22)
                    z_add += (rib_arch + serratus) * fp
                # Colossal Titan exposed rib ridges (u = 0.38..0.80)
                if colossus and 0.38 < uu < 0.80 and 0.14 < apx < 0.82:
                    ru = (uu - 0.38) / 0.42
                    rib_wave = max(0.0, math.sin(ru * math.pi * 6.0)) ** 1.6
                    z_add += 0.055 * rib_wave * fp
                # Pectoralis major slabs + sternal cleavage (u = 0.58..0.86)
                if 0.58 < uu < 0.86:
                    pu = (uu - 0.58) / 0.28
                    sternum = min(1.0, (apx / 0.16) ** 1.5)
                    pec_lat = max(0.0, 1.0 - max(0.0, apx - 0.68) * 2.1)
                    pec_slab = (math.sin(pu * math.pi) ** 0.72) * sternum * pec_lat * 0.24
                    pec_under = -0.075 * math.sin(min(1.0, pu / 0.22) * math.pi) * sternum * pec_lat if pu < 0.22 else 0.0
                    z_add += (pec_slab + pec_under) * fp
                # Clavicle ridge (u = 0.84..0.93)
                if 0.84 < uu < 0.93 and apx < 0.78:
                    cu = (uu - 0.84) / 0.09
                    clav = math.sin(cu * math.pi) * (0.09 if colossus else 0.065) * min(1.0, apx / 0.12)
                    z_add += clav * fp

            # Iliac crest & lateral latissimus dorsi flare
            if apx > 0.70 and 0.10 < uu < 0.24:
                iu = math.sin(((uu - 0.10) / 0.14) * math.pi)
                x_add += (0.04 * iu * ((apx - 0.70) / 0.30)) * (1.0 if px > 0 else -1.0)
            if apx > 0.70 and 0.55 < uu < 0.86:
                lu = (uu - 0.55) / 0.31
                lat_flare = 0.08 * math.sin(lu * math.pi) * ((apx - 0.70) / 0.30)
                x_add += lat_flare if px > 0 else -lat_flare

            # Back anatomy (-Z): gluteus maximus at bottom + spinal erector furrow + scapulae + trapezius
            if pz < -0.08:
                bp = (-pz - 0.08) / 0.92
                # Gluteus maximus lobes & intergluteal cleft (u = 0.02..0.22)
                if 0.02 < uu < 0.22:
                    gu = (uu - 0.02) / 0.20
                    cleft = min(1.0, (apx / 0.16) ** 1.5)
                    glute = -0.15 * math.sin(gu * math.pi) * cleft
                    glute_crevice = 0.08 * (1.0 - cleft) * math.sin(gu * math.pi)
                    z_add += (glute + glute_crevice) * bp
                # Spinal furrow & erector spinae columns (u = 0.18..0.95)
                if uu > 0.16:
                    su = (uu - 0.16) / 0.84
                    spine_groove = 0.090 * max(0.0, 1.0 - apx / 0.16) * math.sin(su * math.pi)
                    erectors = -0.050 * max(0.0, 1.0 - abs(apx - 0.26) / 0.16) * math.sin(su * math.pi)
                    scapula = -0.095 * math.sin(((uu - 0.58) / 0.28) * math.pi) * max(0.0, 1.0 - abs(apx - 0.48) / 0.26) if 0.58 < uu < 0.86 else 0.0
                    traps = -0.075 * math.sin(((uu - 0.74) / 0.26) * math.pi) * max(0.0, 1.0 - apx / 0.52) if uu > 0.74 else 0.0
                    z_add += (spine_groove + erectors + scapula + traps) * bp

            return (tx + x_add, vy, tz + z_add)

        rings.append((ty, rx, rz, 0.02, dfn))

    bm = make_lofted_tube(rings, segs=44)

    if not colossus:
        def color_fn(tx, ty, tz, nx, ny, nz):
            u = (ty + 0.64) / 4.22
            shade = 0.94 + 0.05 * max(0.0, ny)
            # Sternal furrow & linea alba AO
            if tz > 0.18 and abs(tx) < 0.20 and 0.18 < u < 0.84:
                shade -= 0.14 * (1.0 - abs(tx) / 0.20)
            # Under-pectoral fold AO
            if tz > 0.32 and 0.56 < u < 0.64 and 0.16 < abs(tx) < 0.95:
                shade -= 0.14 * math.sin(((u - 0.56) / 0.08) * math.pi)
            # Abdominal 6-pack horizontal tendinous intersections AO
            if tz > 0.35 and 0.20 < u < 0.55 and 0.08 < abs(tx) < 0.52:
                bu = (u - 0.20) / 0.35
                shade -= 0.08 * (math.cos(bu * math.pi * 3.0) ** 6)
            # Serratus / oblique groove AO
            if tz > 0.05 and 0.36 < u < 0.66 and 0.58 < abs(tx) < 0.95:
                shade -= 0.07 * math.sin(((u - 0.36) / 0.30) * math.pi)
            # Spinal & intergluteal furrow AO
            if tz < -0.18 and abs(tx) < 0.20:
                shade -= 0.15 * (1.0 - abs(tx) / 0.20)
            return skin_ao(shade)

        return finalize_mesh("titan_torso", bm, smooth=True, color_fn=color_fn)
    else:
        def colossus_color_fn(tx, ty, tz, nx, ny, nz):
            u = (ty + 0.64) / 4.22
            striation = 0.90 + 0.10 * math.sin(ty * 28.0 + abs(tx) * 14.0)
            r, g, b = 0.72 * striation, 0.17 * striation, 0.14 * striation

            # Exposed white/ivory ribcage arches & sternum on front/sides
            if tz > 0.15 and 0.38 < u < 0.80 and abs(tx) < 0.98:
                ru = (u - 0.38) / 0.42
                rib_band = max(0.0, math.sin(ru * math.pi * 6.0)) ** 2.2
                sternum_band = max(0.0, 1.0 - abs(tx) / 0.14) if 0.54 < u < 0.85 else 0.0
                bone_w = max(rib_band * (0.85 if abs(tx) > 0.16 else 0.3), sternum_band)
                r = r * (1.0 - bone_w) + 0.94 * bone_w
                g = g * (1.0 - bone_w) + 0.90 * bone_w
                b = b * (1.0 - bone_w) + 0.80 * bone_w

            # Exposed white clavicles (u = 0.84..0.93)
            if tz > 0.20 and 0.84 < u < 0.93 and 0.10 < abs(tx) < 0.92:
                cu = math.sin(((u - 0.84) / 0.09) * math.pi)
                r = r * (1.0 - cu * 0.85) + 0.95 * cu * 0.85
                g = g * (1.0 - cu * 0.85) + 0.91 * cu * 0.85
                b = b * (1.0 - cu * 0.85) + 0.82 * cu * 0.85

            # Silvery-pink tendinous linea alba & abdominal aponeurosis
            if tz > 0.25 and 0.16 < u < 0.56 and abs(tx) < 0.55:
                bu = (u - 0.16) / 0.40
                linea_w = max(0.0, 1.0 - abs(tx) / 0.13)
                tendon_w = (math.cos(bu * math.pi * 3.0) ** 6) * max(0.0, 1.0 - abs(tx) / 0.48)
                tw = min(0.85, max(linea_w, tendon_w * 0.75))
                r = r * (1.0 - tw) + 0.88 * tw
                g = g * (1.0 - tw) + 0.72 * tw
                b = b * (1.0 - tw) + 0.68 * tw

            # Exposed thoracic spine ridge on back (-Z)
            if tz < -0.25 and abs(tx) < 0.14 and 0.18 < u < 0.92:
                sw = (1.0 - abs(tx) / 0.14) * 0.75
                r = r * (1.0 - sw) + 0.90 * sw
                g = g * (1.0 - sw) + 0.85 * sw
                b = b * (1.0 - sw) + 0.76 * sw

            ao = 0.84 + 0.16 * max(0.0, ny)
            return (r * ao, g * ao, b * ao)

        return finalize_mesh("titan_torso_colossus", bm, smooth=True, color_fn=colossus_color_fn)

# ==============================================================================
# 2. TITAN PELVIS (Origin at pelvis.position.y = 0.20 in body; spans ty = -0.52 .. +0.18)
#    Compact pelvic floor / sub-gluteal bridge tucked 100% INSIDE the lower torso!
#    Never pokes out of the abdomen or lower back -> ZERO swim-ring or briefs seam!
# ==============================================================================
def build_titan_pelvis():
    rings = []
    N = 14
    for k in range(N + 1):
        u = k / N  # 0 = crotch base (-0.52), 1 = inside lower torso (+0.18)
        ty = -0.52 + u * 0.70
        cap = joint_cap_factor(ty, -0.34, -0.52, 0.02, 0.18)
        rx = (0.94 + 0.06 * math.sin(u * math.pi * 0.7)) * cap
        rz = (0.64 + 0.04 * math.sin(u * math.pi * 0.7)) * cap
        rings.append((ty, rx, rz, 0.02, None))

    bm = make_lofted_tube(rings, segs=28)

    def color_fn(tx, ty, tz, nx, ny, nz):
        shade = 0.90 + 0.05 * max(0.0, ny)
        if tz < -0.20 and abs(tx) < 0.18:
            shade -= 0.14 * (1.0 - abs(tx) / 0.18)
        return skin_ao(shade)

    return finalize_mesh("titan_pelvis", bm, smooth=True, color_fn=color_fn)

# ==============================================================================
# 3. TITAN NECK & CONTOURED NAPE WEAK-POINT (Fixes "brick/backpack" nape!)
# ==============================================================================
def build_titan_neck():
    """
    Origin at neck group (0, 3.30, 0) in spine.
    Spans ty = -0.38 (flaring into upper trapezius/clavicles) to ty = +0.78 (socketed into skull base).
    """
    rings = []
    N = 22
    for k in range(N + 1):
        u = k / N
        ty = -0.38 + u * 1.16
        cap = joint_cap_factor(ty, -0.26, -0.38, 0.64, 0.78)

        flare = ((1.0 - min(1.0, u / 0.36)) ** 1.8)
        rx = (0.53 + 0.34 * flare) * cap
        rz = (0.49 + 0.20 * flare) * cap

        def dfn(tx, vy, tz, px, pz, ang, uu=u):
            z_add = 0.0
            scm_x = 0.14 + uu * 0.48
            if pz > -0.10:
                scm_d = max(0.0, 1.0 - abs(abs(px) - scm_x) / 0.18)
                z_add += 0.042 * scm_d * math.sin(uu * math.pi)
            if pz > 0.65 and abs(px) < 0.24:
                if uu < 0.25:
                    z_add -= 0.035 * (1.0 - abs(px) / 0.24) * math.sin((uu / 0.25) * math.pi)
                elif 0.28 < uu < 0.76:
                    z_add += 0.038 * (1.0 - abs(px) / 0.24) * math.sin(((uu - 0.28) / 0.48) * math.pi)
            if pz < -0.20:
                bp = (-pz - 0.20) / 0.80
                nuchal_groove = 0.045 * max(0.0, 1.0 - abs(px) / 0.16)
                trap_cord = -0.048 * max(0.0, 1.0 - abs(abs(px) - 0.38) / 0.22)
                z_add += (nuchal_groove + trap_cord) * bp * math.sin(uu * math.pi)
            return (tx, vy, tz + z_add)

        rings.append((ty, rx, rz, 0.02, dfn))

    bm = make_lofted_tube(rings, segs=32)

    def color_fn(tx, ty, tz, nx, ny, nz):
        shade = 0.92 + 0.05 * max(0.0, ny)
        if tz > 0.25 and abs(tx) < 0.16 and ty < 0.0:
            shade -= 0.10
        if tz < -0.25 and abs(tx) < 0.15:
            shade -= 0.11 * (1.0 - abs(tx) / 0.15)
        return skin_ao(shade)

    return finalize_mesh("titan_neck", bm, smooth=True, color_fn=color_fn)

def build_titan_nape():
    """
    Contoured anatomical nape hit-zone mesh centered at (0, 0, 0) in nape local space
    (placed at nape.position = (0, 0.24, -0.28) in neck).
    Bounding box is width = 0.94, height = 0.88, depth = 0.48.
    Outer back surface conforms tightly to titan_neck so there is no step or brick on the neck!
    """
    rings = []
    N = 16
    for k in range(N + 1):
        u = k / N
        ty = -0.44 + u * 0.88  # height = 0.88
        v_env = math.sin(u * math.pi)
        cap = math.sin(max(0.04, min(0.96, u)) * math.pi) ** 0.35
        rx = 0.47 * cap  # width = 0.94
        rz = 0.24 * cap  # depth = 0.48

        def dfn(tx, vy, tz, px, pz, ang, uu=u, venv=v_env):
            if pz < 0.0:
                lat_curve = (px ** 2) * 0.21
                end_tuck = ((1.0 - venv) ** 1.4) * 0.12
                groove = 0.032 * max(0.0, 1.0 - abs(px) / 0.18) * venv
                cord = -0.020 * max(0.0, 1.0 - abs(abs(px) - 0.36) / 0.22) * venv
                tz_contoured = tz + (lat_curve + end_tuck + groove + cord) * (-pz)
                return (tx, vy, tz_contoured)
            return (tx, vy, tz)

        rings.append((ty, rx, rz, 0.0, dfn))

    bm = make_lofted_tube(rings, segs=28)

    def color_fn(tx, ty, tz, nx, ny, nz):
        shade = 0.92 + 0.05 * max(0.0, ny)
        if tz < -0.05:
            if abs(tx) < 0.15:
                shade -= 0.11 * (1.0 - abs(tx) / 0.15)
            r, g, b = skin_ao(shade)
            w = max(0.0, 1.0 - (tx / 0.36) ** 2 - (ty / 0.34) ** 2) * 0.10
            return (min(1.0, r + w * 0.05), max(0.0, g - w * 0.06), max(0.0, b - w * 0.07))
        return skin_ao(shade)

    return finalize_mesh("titan_nape", bm, smooth=True, color_fn=color_fn)

# ==============================================================================
# 4. TITAN HEAD (High-detail craniofacial sculpt + Colossal skinless head + Teeth + Hair)
# ==============================================================================
def build_titan_head(colossus=False):
    rings = []
    N = 48
    for k in range(N + 1):
        u = k / N  # 0 = chin base (0.0), 1 = skull crown (2.08)
        ty = u * 2.08
        cap = math.sin(max(0.015, min(0.985, u)) * math.pi) ** 0.32

        if u < 0.16:
            t = u / 0.16
            w = 0.56 + t * 0.24
            d = 0.68 + t * 0.16
        elif u < 0.32:
            t = (u - 0.16) / 0.16
            w = 0.80 + math.sin(t * math.pi * 0.65) * 0.07
            d = 0.84 + t * 0.05
        elif u < 0.58:
            t = (u - 0.32) / 0.26
            w = 0.87 + math.sin(t * math.pi) * 0.08
            d = 0.89 + math.sin(t * math.pi * 0.7) * 0.06
        else:
            t = (u - 0.58) / 0.42
            w = 0.93 * (1.0 - (t ** 1.85) * 0.20)
            d = 0.95 * (1.0 - (t ** 1.85) * 0.16)

        rx = w * cap
        rz = d * cap

        def dfn(tx, vy, tz, px, pz, ang, uu=u):
            z_off = 0.0
            x_off = 0.0
            if pz > 0.10:
                fp = (pz - 0.10) / 0.90
                apx = abs(px)

                # 1. Strong angular chin (u = 0.03..0.16)
                if 0.02 < uu < 0.17 and apx < 0.46:
                    cu = (uu - 0.02) / 0.15
                    cleft = -0.018 * max(0.0, 1.0 - apx / 0.08)
                    z_off += (0.12 * math.sin(cu * math.pi) * (1.0 - (apx / 0.46) ** 2) + cleft) * fp

                # 2. Mandible jawline angle (gonion) (u = 0.14..0.28)
                if 0.14 < uu < 0.28 and 0.52 < apx < 0.94:
                    ju = math.sin(((uu - 0.14) / 0.14) * math.pi)
                    jw = max(0.0, 1.0 - abs(apx - 0.74) / 0.22)
                    x_off += (0.048 * ju * jw) * (1.0 if px > 0 else -1.0)

                # 3. Tight, menacing Titan grin mouth cavity & lips (u = 0.16..0.34 -> ty = 0.33..0.70)
                mouth_w = 0.72 if colossus else 0.58
                if 0.14 < uu < 0.35 and apx < mouth_w + 0.08:
                    mw = max(0.0, 1.0 - (apx / mouth_w) ** 2.2)
                    if 0.17 < uu < 0.31 and apx < mouth_w:
                        mu = (uu - 0.17) / 0.14
                        z_off -= 0.26 * math.sin(mu * math.pi) * mw * fp
                    if not colossus and 0.30 < uu < 0.36:
                        lu = math.sin(((uu - 0.30) / 0.06) * math.pi)
                        philtrum = -0.022 * max(0.0, 1.0 - apx / 0.08)
                        z_off += (0.045 * lu * mw + philtrum) * fp
                    if not colossus and 0.14 < uu < 0.19:
                        lu = math.sin(((uu - 0.14) / 0.05) * math.pi)
                        z_off += 0.042 * lu * mw * fp

                # 4. Subtle buccal cheek contour & Zygomatic cheekbones (smooth transition!)
                if 0.22 < uu < 0.45 and 0.42 < apx < 0.84:
                    bu = math.sin(((uu - 0.22) / 0.23) * math.pi)
                    cheek_hollow = -(0.12 if colossus else 0.042) * max(0.0, 1.0 - abs(apx - 0.66) / 0.20) * bu
                    z_off += cheek_hollow * fp
                if 0.44 < uu < 0.59 and 0.40 < apx < 0.90:
                    zu = math.sin(((uu - 0.44) / 0.15) * math.pi)
                    zw = max(0.0, 1.0 - abs(apx - 0.64) / 0.24)
                    z_off += 0.055 * zu * zw * fp
                    x_off += (0.038 * zu * zw) * (1.0 if px > 0 else -1.0)

                # 5. Narrow, sharply defined nose: bridge, dorsum, apex tip, nostrils (u = 0.37..0.64)
                if 0.37 < uu < 0.64 and apx < 0.22:
                    nu = (uu - 0.37) / 0.27
                    alar_w = 0.20 if nu < 0.34 else (0.12 + 0.08 * (1.0 - (nu - 0.34) / 0.66))
                    if apx < alar_w:
                        nw = math.cos((apx / alar_w) * math.pi * 0.5) ** 1.25
                        if nu < 0.26:
                            prof = math.sin((nu / 0.26) * math.pi * 0.5) * 0.24
                        else:
                            prof = (0.24 - 0.10 * ((nu - 0.26) / 0.74)) * math.sin((1.0 - (nu - 0.26) * 0.60) * math.pi * 0.5)
                        nostril_flare = 0.045 * math.sin((nu / 0.32) * math.pi) * max(0.0, 1.0 - abs(apx - 0.13) / 0.07) if nu < 0.32 else 0.0
                        z_off += (prof * nw + nostril_flare) * fp

                # 6. Deep sunken orbital sockets + eyelid rims (u = 0.52..0.67, 0.16 < |px| < 0.66)
                if 0.52 < uu < 0.67 and 0.16 < apx < 0.66:
                    eu = (uu - 0.52) / 0.15
                    ex = max(0.0, 1.0 - abs((apx - 0.40) / 0.24) ** 2)
                    socket_depth = -0.22 * math.sin(eu * math.pi) * ex
                    lid_rim = 0.035 * ex if (0.10 < eu < 0.22 or 0.78 < eu < 0.90) else 0.0
                    z_off += (socket_depth + lid_rim) * fp

                # 7. Overhanging superciliary brow ridge & glabella scowl (u = 0.64..0.75)
                if 0.64 < uu < 0.75 and apx < 0.72:
                    bu = (uu - 0.64) / 0.11
                    brow_env = math.sin(bu * math.pi) * (1.0 - (apx / 0.72) ** 2.4)
                    frown_furrow = -0.048 * max(0.0, 1.0 - abs(apx - 0.06) / 0.05) * math.sin(bu * math.pi)
                    z_off += (0.135 * brow_env + frown_furrow) * fp

            # 8. Sculpted external ears on sides
            if not colossus and 0.42 < uu < 0.63 and abs(px) > 0.86 and -0.24 < pz < 0.20:
                eu = (uu - 0.42) / 0.21
                ep = max(0.0, 1.0 - (abs(pz + 0.02) / 0.22) ** 2)
                helix_rim = 0.040 if (eu > 0.75 or pz < -0.08) else -0.020
                ear_out = (0.11 * math.sin(eu * math.pi) + helix_rim) * ep
                x_off += ear_out if px > 0 else -ear_out
                z_off -= 0.025 * ep * math.sin(eu * math.pi)

            return (tx + x_off, vy, tz + z_off)

        rings.append((ty, rx, rz, 0.05, dfn))

    bm = make_lofted_tube(rings, segs=56)

    if not colossus:
        def color_fn(tx, ty, tz, nx, ny, nz):
            u = ty / 2.08
            apx = abs(tx)
            shade = 0.95 + 0.05 * max(0.0, ny)

            # Dark oral cavity inside mouth
            if tz > 0.30 and 0.17 < u < 0.31 and apx < 0.54:
                mu = math.sin(((u - 0.17) / 0.14) * math.pi)
                mw = 1.0 - (apx / 0.54) ** 2
                dark = mu * mw
                if dark > 0.22:
                    return (0.16 + 0.18 * (1.0 - dark), 0.06 + 0.10 * (1.0 - dark), 0.06 + 0.10 * (1.0 - dark))

            # Lip vermilion border tint
            if tz > 0.52 and ((0.15 < u < 0.18) or (0.31 < u < 0.34)) and apx < 0.50:
                r, g, b = skin_ao(shade * 0.93)
                return (r * 0.98, g * 0.85, b * 0.83)

            # Deep anime Titan shadow inside orbital eye sockets
            if tz > 0.36 and 0.52 < u < 0.67 and 0.15 < apx < 0.64:
                eu = math.sin(((u - 0.52) / 0.15) * math.pi)
                ew = max(0.0, 1.0 - abs((apx - 0.39) / 0.23) ** 2)
                shade -= 0.42 * eu * ew

            # Lateral nasal bridge contour & nostril shadow (defines the nose from the front!)
            if tz > 0.55 and 0.40 < u < 0.62 and 0.08 < apx < 0.18:
                shade -= 0.11 * math.sin(((u - 0.40) / 0.22) * math.pi) * (1.0 - abs(apx - 0.13) / 0.05)
            if tz > 0.52 and 0.35 < u < 0.41 and apx < 0.20:
                shade -= 0.20 * (1.0 - apx / 0.20)

            # Ear conchal shadow
            if 0.44 < u < 0.61 and apx > 0.85 and abs(tz) < 0.18:
                shade -= 0.12

            return skin_ao(shade)

        return finalize_mesh("titan_head", bm, smooth=True, color_fn=color_fn)
    else:
        def colossus_head_color(tx, ty, tz, nx, ny, nz):
            u = ty / 2.08
            apx = abs(tx)
            if tz > 0.28 and 0.17 < u < 0.33 and apx < 0.68:
                if 0.42 < apx < 0.66:
                    sinew = math.sin(apx * 48.0)
                    if sinew > 0.25:
                        return (0.88, 0.74, 0.68)
                return (0.14, 0.04, 0.04)

            if tz > 0.36 and 0.52 < u < 0.67 and 0.15 < apx < 0.64:
                eu = math.sin(((u - 0.52) / 0.15) * math.pi)
                ew = max(0.0, 1.0 - abs((apx - 0.39) / 0.23) ** 2)
                if eu * ew > 0.30:
                    return (0.12, 0.04, 0.04)

            striation = 0.88 + 0.12 * math.sin(ty * 34.0 + apx * 22.0)
            r, g, b = 0.72 * striation, 0.16 * striation, 0.13 * striation

            bone_w = 0.0
            if tz > 0.40:
                if 0.63 < u < 0.74 and apx < 0.68:
                    bone_w = max(bone_w, math.sin(((u - 0.63) / 0.11) * math.pi) * 0.90)
                if 0.42 < u < 0.64 and apx < 0.15:
                    bone_w = max(bone_w, (1.0 - apx / 0.15) * 0.92)
                if 0.44 < u < 0.57 and 0.38 < apx < 0.84:
                    bone_w = max(bone_w, math.sin(((u - 0.44) / 0.13) * math.pi) * max(0.0, 1.0 - abs(apx - 0.60) / 0.22) * 0.88)
                if (0.03 < u < 0.18 or 0.30 < u < 0.37) and apx < 0.62:
                    bone_w = max(bone_w, 0.86 * (1.0 - (apx / 0.64) ** 2))

            r = r * (1.0 - bone_w) + 0.95 * bone_w
            g = g * (1.0 - bone_w) + 0.91 * bone_w
            b = b * (1.0 - bone_w) + 0.82 * bone_w
            ao = 0.85 + 0.15 * max(0.0, ny)
            return (r * ao, g * ao, b * ao)

        return finalize_mesh("titan_head_colossus", bm, smooth=True, color_fn=colossus_head_color)

def build_titan_teeth():
    """
    Tightly spaced, menacing AoT Titan teeth arches (14 upper + 14 lower) + alveolar gums + dark oral backdrop.
    """
    bm = bmesh.new()
    tag_type = {}

    for kind, y0, y1, rx, rz, z_off in [
        ('cavity', 0.35, 0.62, 0.43, 0.58, 0.02),
        ('gum', 0.56, 0.66, 0.49, 0.66, 0.035),
        ('gum', 0.31, 0.41, 0.48, 0.65, 0.035),
    ]:
        segs = 18
        rows = []
        for vy in (y0, y1):
            row = []
            for i in range(segs + 1):
                ang = ((i / segs) - 0.5) * 1.48
                tx = math.sin(ang) * rx
                tz = math.cos(ang) * rz + z_off
                v = bm.verts.new(to_blender(tx, vy, tz))
                tag_type[v] = kind
                row.append(v)
            rows.append(row)
        for i in range(segs):
            bm.faces.new((rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]))

    n_teeth = 14
    for y_base, y_dir, rx_arch, rz_arch in [(0.585, -1.0, 0.48, 0.67), (0.380, 1.0, 0.47, 0.66)]:
        for i in range(n_teeth):
            u = (i + 0.5) / n_teeth - 0.5
            ang = u * 1.34
            cx = math.sin(ang) * rx_arch
            cz = math.cos(ang) * rz_arch + 0.04
            au = abs(u)
            tw = 0.032 * (1.14 if au < 0.15 else (0.98 if au < 0.28 else 0.90))
            th = 0.104
            td = 0.036

            res = bmesh.ops.create_cube(bm, size=1.0)
            for v in res["verts"]:
                lx = v.co.x * tw * 2.0
                ly = v.co.z
                lz = v.co.y * td * 2.0
                is_tip = (ly * y_dir > 0)
                taper_x = 0.96 if is_tip else 1.0
                taper_z = 0.60 if is_tip else 1.0
                tx = cx + (lx * taper_x) * math.cos(ang) + (lz * taper_z) * math.sin(ang)
                tz = cz - (lx * taper_x) * math.sin(ang) + (lz * taper_z) * math.cos(ang)
                ty = y_base + (ly + 0.5 * y_dir) * th
                v.co = to_blender(tx, ty, tz)
                tag_type[v] = 'tooth'

    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.normal_update()
    color_layer = bm.loops.layers.color.new("Col")
    for f in bm.faces:
        f.smooth = False
        for loop in f.loops:
            v = loop.vert
            kind = tag_type.get(v, 'tooth')
            tx, ty, tz = from_blender(v.co)
            if kind == 'cavity':
                loop[color_layer] = (0.10, 0.03, 0.03, 1.0)
            elif kind == 'gum':
                loop[color_layer] = (0.56, 0.22, 0.22, 1.0)
            else:
                root_dist = min(abs(ty - 0.585), abs(ty - 0.380)) / 0.104
                s = 0.78 + 0.21 * min(1.0, root_dist)
                loop[color_layer] = (min(1.0, s * 0.98), min(1.0, s * 0.94), min(1.0, s * 0.83), 1.0)

    mesh = bpy.data.meshes.new("titan_teeth")
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("titan_teeth", mesh)
    bpy.context.collection.objects.link(obj)
    return obj

# ==============================================================================
# 4B. SCULPTED ANIME TITAN HAIR MESHES (tight skull contour + layered locks)
# ==============================================================================
def _hair_color_fn(tx, ty, tz, nx, ny, nz):
    strand = 0.92 + 0.08 * math.sin(math.atan2(tx, tz) * 16.0 + ty * 5.0)
    crown = 0.86 + 0.16 * max(0.0, min(1.0, (ty - 0.85) / 1.25))
    light = 0.90 + 0.12 * max(0.0, ny)
    s = max(0.68, min(1.06, strand * crown * light))
    return (s, s * 0.98, s * 0.95)

def _build_skull_hair_cap(y_bot, y_top, rx_scale, rz_scale, front_cut_u, ridge_amp, ridge_freq):
    rings = []
    N = 22
    for k in range(N + 1):
        u = k / N
        ty = y_bot + u * (y_top - y_bot)
        cap = math.sin(max(0.04, min(0.97, u)) * math.pi) ** 0.34
        # Hug skull tightly at base and crown
        taper_bot = min(1.0, (u / 0.22) ** 0.55) if u < 0.22 else 1.0
        rx = (0.93 * rx_scale * taper_bot + 0.04 * math.sin(u * math.pi)) * cap
        rz = (0.95 * rz_scale * taper_bot + 0.05 * math.sin(u * math.pi)) * cap

        def dfn(tx, vy, tz, px, pz, ang, uu=u):
            # Keep face clear on front (+Z) below forehead hairline
            if pz > 0.10 and uu < front_cut_u:
                fp = (pz - 0.10) / 0.90
                vy += (front_cut_u - uu) * (y_top - y_bot) * 0.82 * fp
                tz *= 1.0 - 0.12 * fp
            # Organic layered hair strands around the back and sides
            ridge = 1.0 + ridge_amp * math.sin(ang * ridge_freq + uu * 4.0) * math.sin(uu * math.pi)
            return (tx * ridge, vy, tz * ridge)

        rings.append((ty, rx, rz, -0.02, dfn))
    return make_lofted_tube(rings, segs=36)

def build_titan_hair_short():
    """Cropped layered anime Titan hair hugging the skull cleanly."""
    bm = _build_skull_hair_cap(0.92, 2.13, 1.00, 1.00, 0.62, 0.028, 14.0)
    return finalize_mesh("titan_hair_short", bm, smooth=True, color_fn=_hair_color_fn)

def build_titan_hair_shaggy():
    """Medium-length shaggy Titan hair extending down the nape and temples."""
    bm = _build_skull_hair_cap(0.68, 2.15, 1.03, 1.04, 0.66, 0.048, 12.0)
    return finalize_mesh("titan_hair_shaggy", bm, smooth=True, color_fn=_hair_color_fn)

def build_titan_hair_long():
    """Long flowing Titan mane draping down to the upper back/shoulders."""
    bm = _build_skull_hair_cap(0.32, 2.16, 1.05, 1.06, 0.72, 0.058, 10.0)
    return finalize_mesh("titan_hair_long", bm, smooth=True, color_fn=_hair_color_fn)

def build_titan_hair_armored():
    """Armored Titan (Reiner) sleek, angular swept-back hair hugging the skull."""
    bm = _build_skull_hair_cap(0.96, 2.14, 0.99, 1.02, 0.58, 0.045, 9.0)
    return finalize_mesh("titan_hair_armored", bm, smooth=False, color_fn=_hair_color_fn)

# ==============================================================================
# 5. TITAN LIMBS (Deep internal overlap caps — eliminates joint shadow lines!)
# ==============================================================================
def build_titan_upper_arm():
    """
    Left upper arm (+X lateral deltoid).
    Shoulder pivot at ty = 0.0 (tucks inward under trapezius up to +0.38).
    Elbow pivot at ty = -2.40 (extends to -2.68 inside forearm so cap is hidden).
    """
    rings = []
    N = 24
    for k in range(N + 1):
        u = k / N
        ty = -2.68 + u * 3.06  # -2.68 .. +0.38
        cap = joint_cap_factor(ty, -2.50, -2.68, 0.16, 0.38)
        su = max(0.0, min(1.0, (ty + 2.40) / 2.40))
        rx = (0.37 + 0.14 * su) * cap
        rz = (0.36 + 0.14 * su) * cap

        def dfn(tx, vy, tz, px, pz, ang, s_u=su, v_y=ty):
            x_add = 0.0
            z_add = 0.0
            # Deltoid cap & inward shoulder-to-clavicle slope (prevents shoulder step!)
            if s_u > 0.48:
                du = min(1.0, (s_u - 0.48) / 0.52)
                delt_env = math.sin(du * math.pi * 0.80)
                if px > 0.0:
                    x_add += 0.12 * delt_env * px
                else:
                    x_add -= 0.16 * delt_env * (-px)
                # Slope top of shoulder inward toward neck/trapezius
                if v_y > -0.15:
                    tuck = ((v_y + 0.15) / 0.53) ** 1.4
                    x_add -= 0.24 * tuck
                z_add += 0.04 * delt_env * pz
            # Biceps brachii (+Z)
            if 0.12 < s_u < 0.78 and pz > 0.0:
                bu = (s_u - 0.12) / 0.66
                z_add += 0.09 * math.sin(bu * math.pi) * (pz ** 1.2)
            # Triceps brachii (-Z)
            if 0.22 < s_u < 0.84 and pz < 0.0:
                tu = (s_u - 0.22) / 0.62
                z_add -= 0.075 * math.sin(tu * math.pi) * ((-pz) ** 1.2)
            return (tx + x_add, vy, tz + z_add)

        rings.append((ty, rx, rz, 0.0, dfn))

    bm = make_lofted_tube(rings, segs=26)
    return finalize_mesh("titan_upper_arm", bm, smooth=True, color_fn=lambda tx, ty, tz, nx, ny, nz: skin_ao(0.93 + 0.04 * max(0.0, ny)))

def build_titan_forearm():
    """
    Elbow pivot at ty = 0.0 (extends up to +0.34 inside upper arm so top cap is 100% hidden!).
    Wrist pivot at ty = -2.20 (extends down to -2.42 inside hand).
    """
    rings = []
    N = 22
    for k in range(N + 1):
        u = k / N
        ty = -2.42 + u * 2.76  # -2.42 .. +0.34
        cap = joint_cap_factor(ty, -2.28, -2.42, 0.18, 0.34)
        su = max(0.0, min(1.0, (ty + 2.20) / 2.20))
        belly = 0.055 * math.sin(((su - 0.25) / 0.75) * math.pi) if 0.25 < su < 1.0 else 0.0
        # Slight inward taper above ty = 0.0 so top of forearm stays inside upper arm
        inside_taper = max(0.75, 1.0 - max(0.0, ty) * 0.45)
        rx = (0.26 + 0.11 * su + belly) * inside_taper * cap
        rz = (0.20 + 0.15 * su + belly * 0.85) * inside_taper * cap

        def dfn(tx, vy, tz, px, pz, ang, s_u=su):
            olec = -0.045 * math.sin(((s_u - 0.75) / 0.25) * math.pi) * max(0.0, -pz) if s_u > 0.75 else 0.0
            return (tx, vy, tz + olec)

        rings.append((ty, rx, rz, 0.0, dfn))

    bm = make_lofted_tube(rings, segs=24)
    return finalize_mesh("titan_forearm", bm, smooth=True, color_fn=lambda tx, ty, tz, nx, ny, nz: skin_ao(0.93 + 0.04 * max(0.0, ny)))

def build_titan_hand():
    """Sculpted Left Titan hand (+X side): deep wrist overlap (y = +0.22), palm, knuckles, 4 fingers + thumb."""
    meshes_to_join = []

    palm_rings = [
        (0.22, 0.20, 0.14, 0.0, None),
        (0.04, 0.25, 0.18, 0.0, None),
        (-0.14, 0.33, 0.19, 0.01, lambda tx, vy, tz, px, pz, ang: (tx, vy, tz + (0.040 if (px < -0.2 and pz > 0.2) else 0.0))),
        (-0.36, 0.37, 0.18, 0.02, None),
        (-0.52, 0.36, 0.15, 0.02, None),
        (-0.58, 0.31, 0.10, 0.02, None),
    ]
    meshes_to_join.append(make_lofted_tube(palm_rings, segs=22))

    # 4 Fingers touching naturally across the knuckles
    finger_specs = [
        (-0.23, 0.50, 0.078),
        (-0.08, 0.56, 0.082),
        (0.08,  0.53, 0.078),
        (0.23,  0.44, 0.070),
    ]
    for fx, flen, fr in finger_specs:
        f_rings = []
        for k in range(9):
            u = k / 8
            curl = (u ** 1.55) * 0.18
            fy = -0.48 - u * flen
            fz = 0.02 + curl
            knuckle = 1.0 + 0.06 * math.exp(-((u - 0.38) / 0.10) ** 2)
            cap = math.sin(max(0.10, min(0.96, 1.0 - u * 0.80)) * math.pi * 0.5)
            r = fr * (1.0 - u * 0.20) * knuckle * max(0.42, cap)
            f_rings.append((fy, r, r * 0.95, fz, lambda tx, vy, tz, px, pz, ang, x0=fx: (tx + x0, vy, tz)))
        meshes_to_join.append(make_lofted_tube(f_rings, segs=12))

    # Thumb
    t_rings = []
    for k in range(7):
        u = k / 6
        tx0 = -0.25 - u * 0.18
        ty0 = -0.18 - u * 0.36
        tz0 = 0.05 + u * 0.16
        r = 0.086 * (1.0 - u * 0.20) * (0.55 if k == 6 else 1.0)
        t_rings.append((ty0, r, r, tz0, lambda tx, vy, tz, px, pz, ang, x0=tx0: (tx + x0, vy, tz)))
    meshes_to_join.append(make_lofted_tube(t_rings, segs=12))

    bm = merge_bmeshes(meshes_to_join)
    return finalize_mesh("titan_hand", bm, smooth=True, color_fn=lambda tx, ty, tz, nx, ny, nz: skin_ao(0.88 + 0.05 * max(0.0, ny)))

def build_titan_thigh():
    """
    Left Thigh (+X lateral vastus lateralis).
    Hip pivot at ty = 0.0 (extends up to +0.52 deep inside lower torso/pelvis!).
    Knee pivot at ty = -2.40 (extends down to -2.68 inside calf!).
    """
    rings = []
    N = 24
    for k in range(N + 1):
        u = k / N
        ty = -2.68 + u * 3.20  # -2.68 .. +0.52
        cap = joint_cap_factor(ty, -2.50, -2.68, 0.24, 0.52)
        su = max(0.0, min(1.0, (ty + 2.40) / 2.40))
        rx = (0.43 + 0.19 * su) * cap
        rz = (0.44 + 0.20 * su) * cap

        def dfn(tx, vy, tz, px, pz, ang, s_u=su):
            x_add = 0.0
            z_add = 0.0
            if pz > 0.0 and 0.10 < s_u < 0.92:
                qu = (s_u - 0.10) / 0.82
                z_add += 0.12 * math.sin(qu * math.pi) * (pz ** 1.1)
            if px > 0.15 and 0.18 < s_u < 0.88:
                lu = (s_u - 0.18) / 0.70
                x_add += 0.08 * math.sin(lu * math.pi) * px
            if px < -0.10 and pz > 0.10 and 0.06 < s_u < 0.46:
                mu = (s_u - 0.06) / 0.40
                vm = math.sin(mu * math.pi) * (-px) * pz
                x_add -= 0.07 * vm
                z_add += 0.06 * vm
            if px < -0.15 and s_u > 0.45:
                au = (s_u - 0.45) / 0.55
                x_add -= 0.08 * math.sin(au * math.pi * 0.8) * (-px)
            if pz < 0.0 and 0.15 < s_u < 0.90:
                hu = (s_u - 0.15) / 0.75
                z_add -= 0.08 * math.sin(hu * math.pi) * (-pz)
            return (tx + x_add, vy, tz + z_add)

        rings.append((ty, rx, rz, 0.0, dfn))

    bm = make_lofted_tube(rings, segs=28)
    return finalize_mesh("titan_thigh", bm, smooth=True, color_fn=lambda tx, ty, tz, nx, ny, nz: skin_ao(0.92 + 0.05 * max(0.0, ny)))

def build_titan_calf():
    """
    Knee pivot at ty = 0.0 (extends up to +0.34 inside thigh).
    Ankle pivot at ty = -2.20 (extends down to -2.40 inside foot).
    """
    rings = []
    N = 22
    for k in range(N + 1):
        u = k / N
        ty = -2.40 + u * 2.74  # -2.40 .. +0.34
        cap = joint_cap_factor(ty, -2.26, -2.40, 0.18, 0.34)
        su = max(0.0, min(1.0, (ty + 2.20) / 2.20))
        inside_taper = max(0.76, 1.0 - max(0.0, ty) * 0.42)
        rx = (0.28 + 0.14 * su) * inside_taper * cap
        rz = (0.30 + 0.13 * su) * inside_taper * cap

        def dfn(tx, vy, tz, px, pz, ang, s_u=su):
            z_add = 0.0
            x_add = 0.0
            if s_u > 0.82 and pz > 0.25 and abs(px) < 0.55:
                pu = math.sin(min(1.0, (s_u - 0.82) / 0.18) * math.pi)
                z_add += 0.055 * pu * pz * (1.0 - (abs(px) / 0.55) ** 2)
            if 0.32 < s_u < 0.90 and pz < 0.15:
                cu = (s_u - 0.32) / 0.58
                gastroc = math.sin(cu * math.pi)
                if pz < 0.0:
                    z_add -= 0.16 * gastroc * (-pz)
                x_add += 0.05 * gastroc * px
            if pz > 0.20 and 0.12 < s_u < 0.82:
                z_add += 0.035 * pz * (1.0 - abs(px) * 0.65)
            return (tx + x_add, vy, tz + z_add)

        rings.append((ty, rx, rz, 0.0, dfn))

    bm = make_lofted_tube(rings, segs=26)
    return finalize_mesh("titan_calf", bm, smooth=True, color_fn=lambda tx, ty, tz, nx, ny, nz: skin_ao(0.91 + 0.05 * max(0.0, ny)))

def build_titan_foot():
    """
    Anatomical Left Titan foot with overlapping ankle collar, heel, arch, flat plantar sole (y = -0.22),
    and 5 sculpted toes.
    """
    meshes_to_join = []

    ankle_rings = [
        (-0.08, 0.31, 0.34, -0.08, None),
        (0.06, 0.28, 0.30, -0.04, None),
        (0.22, 0.23, 0.25, -0.02, None),
    ]
    meshes_to_join.append(make_lofted_tube(ankle_rings, segs=18))

    bm_foot = bmesh.new()
    segs = 22
    z_slices = [
        (-0.54, 0.25, 0.16, -0.05),
        (-0.38, 0.34, 0.24, 0.01),
        (-0.06, 0.37, 0.27, 0.04),
        (0.28, 0.41, 0.21, -0.01),
        (0.62, 0.45, 0.15, -0.06),
        (0.84, 0.43, 0.11, -0.10),
        (0.92, 0.38, 0.08, -0.13),
    ]
    ring_verts = []
    for (tz, rx, ry, cy) in z_slices:
        row = []
        for i in range(segs):
            ang = (i / segs) * math.tau
            tx = math.cos(ang) * rx
            ty = cy + math.sin(ang) * ry
            if ty < -0.20:
                ty = -0.20
            row.append(bm_foot.verts.new(to_blender(tx, ty, tz)))
        ring_verts.append(row)

    for r in range(len(ring_verts) - 1):
        r0, r1 = ring_verts[r], ring_verts[r + 1]
        for i in range(segs):
            ni = (i + 1) % segs
            bm_foot.faces.new((r0[i], r1[i], r1[ni], r0[ni]))

    for end_row, flip in [(ring_verts[0], False), (ring_verts[-1], True)]:
        c = sum((v.co for v in end_row), Vector((0, 0, 0))) / segs
        vc = bm_foot.verts.new(c)
        for i in range(segs):
            ni = (i + 1) % segs
            bm_foot.faces.new((vc, end_row[i], end_row[ni]) if flip else (vc, end_row[ni], end_row[i]))
    meshes_to_join.append(bm_foot)

    toe_specs = [
        (-0.27, 0.84, 0.34, 0.095, 0.078),
        (-0.10, 0.86, 0.31, 0.068, 0.065),
        (0.04,  0.85, 0.28, 0.064, 0.062),
        (0.17,  0.82, 0.25, 0.060, 0.058),
        (0.30,  0.78, 0.21, 0.056, 0.054),
    ]
    for (tx0, tz0, tlen, rx0, ry0) in toe_specs:
        bm_toe = bmesh.new()
        t_segs = 10
        t_rows = []
        for k in range(6):
            u = k / 5
            tz = tz0 + u * tlen
            cap = math.sin(max(0.12, 1.0 - u * 0.82) * math.pi * 0.5)
            knuckle = 1.0 + 0.10 * math.sin(u * math.pi)
            rx = rx0 * cap * knuckle
            ry = ry0 * cap * knuckle
            cy = -0.14 - u * 0.02
            row = []
            for i in range(t_segs):
                ang = (i / t_segs) * math.tau
                vx = tx0 + math.cos(ang) * rx
                vy = max(-0.20, cy + math.sin(ang) * ry)
                row.append(bm_toe.verts.new(to_blender(vx, vy, tz)))
            t_rows.append(row)
        for r in range(len(t_rows) - 1):
            r0, r1 = t_rows[r], t_rows[r + 1]
            for i in range(t_segs):
                ni = (i + 1) % t_segs
                bm_toe.faces.new((r0[i], r1[i], r1[ni], r0[ni]))
        for end_row, flip in [(t_rows[0], False), (t_rows[-1], True)]:
            c = sum((v.co for v in end_row), Vector((0, 0, 0))) / t_segs
            vc = bm_toe.verts.new(c)
            for i in range(t_segs):
                ni = (i + 1) % t_segs
                bm_toe.faces.new((vc, end_row[i], end_row[ni]) if flip else (vc, end_row[ni], end_row[i]))
        meshes_to_join.append(bm_toe)

    bm = merge_bmeshes(meshes_to_join)
    return finalize_mesh("titan_foot", bm, smooth=True, color_fn=lambda tx, ty, tz, nx, ny, nz: skin_ao(0.84 + 0.06 * max(0.0, ny)))

# ==============================================================================
# 6. ARMORED TITAN ANGULAR OSTEODERM BONE-ARMOR PLATES
# ==============================================================================
def Euler_to_Matrix(rx, ry, rz):
    mx = Matrix.Rotation(rx, 3, 'X')
    my = Matrix.Rotation(ry, 3, 'Y')
    mz = Matrix.Rotation(rz, 3, 'Z')
    return mz @ my @ mx

def _make_beveled_plate(bm, cx, cy, cz, sx, sy, sz, curve_x=0.0, curve_y=0.0, taper_top=1.0, taper_bot=1.0, keel=0.0, rot_x=0.0, rot_y=0.0, rot_z=0.0):
    nx, ny = 6, 4
    verts_front = []
    verts_back = []
    rot = Euler_to_Matrix(rot_x, rot_y, rot_z)
    for j in range(ny + 1):
        v = j / ny - 0.5
        taper = taper_bot * (0.5 - v) + taper_top * (0.5 + v)
        row_f = []
        row_b = []
        for i in range(nx + 1):
            u = i / nx - 0.5
            edge_u = max(0.0, (abs(u) - 0.30) / 0.20)
            edge_v = max(0.0, (abs(v) - 0.30) / 0.20)
            bevel = 1.0 - 0.65 * max(edge_u, edge_v)
            ridge = keel * (1.0 - abs(u) * 2.0) * bevel

            lx = u * sx * taper
            ly = v * sy
            bend = -(u * u) * curve_x - (v * v) * curve_y
            lz_f = bend + (sz * 0.5) * bevel + ridge
            lz_b = bend - sz * 0.35

            pf = rot @ Vector((lx, ly, lz_f)) + Vector((cx, cy, cz))
            pb = rot @ Vector((lx * 0.94, ly * 0.94, lz_b)) + Vector((cx, cy, cz))
            row_f.append(bm.verts.new(to_blender(pf.x, pf.y, pf.z)))
            row_b.append(bm.verts.new(to_blender(pb.x, pb.y, pb.z)))
        verts_front.append(row_f)
        verts_back.append(row_b)

    for j in range(ny):
        for i in range(nx):
            bm.faces.new((verts_front[j][i], verts_front[j][i + 1], verts_front[j + 1][i + 1], verts_front[j + 1][i]))
            bm.faces.new((verts_back[j][i], verts_back[j + 1][i], verts_back[j + 1][i + 1], verts_back[j][i + 1]))

    for i in range(nx):
        bm.faces.new((verts_front[0][i], verts_back[0][i], verts_back[0][i + 1], verts_front[0][i + 1]))
        bm.faces.new((verts_front[ny][i + 1], verts_back[ny][i + 1], verts_back[ny][i], verts_front[ny][i]))
    for j in range(ny):
        bm.faces.new((verts_front[j + 1][0], verts_back[j + 1][0], verts_back[j][0], verts_front[j][0]))
        bm.faces.new((verts_front[j][nx], verts_back[j][nx], verts_back[j + 1][nx], verts_front[j + 1][nx]))

def build_armor_nape():
    bm = bmesh.new()
    _make_beveled_plate(bm, 0.0, 0.0, 0.0, 1.12, 0.92, 0.24, curve_x=-0.22, curve_y=-0.06, taper_top=0.84, taper_bot=1.06, keel=-0.05)
    return finalize_mesh("armor_nape", bm, smooth=False, color_fn=lambda tx, ty, tz, nx, ny, nz: bone_ao(0.84 + 0.16 * max(0.0, ny - nz * 0.4)))

def build_armor_chest():
    bm = bmesh.new()
    for s in (-1, 1):
        _make_beveled_plate(bm, s * 0.64, 2.52, 0.84, 1.18, 0.92, 0.22, curve_x=0.18, curve_y=0.06, taper_top=1.08, taper_bot=0.86, keel=0.04, rot_y=s * 0.24, rot_x=-0.06)
        _make_beveled_plate(bm, s * 0.56, 3.16, 0.58, 0.96, 0.36, 0.18, curve_x=0.12, taper_top=0.78, taper_bot=1.05, keel=0.03, rot_x=0.42, rot_y=s * 0.18)
        _make_beveled_plate(bm, s * 0.60, 2.58, -0.78, 1.10, 1.12, 0.20, curve_x=-0.16, curve_y=-0.06, taper_top=1.06, taper_bot=0.82, keel=-0.04, rot_y=-s * 0.22)
    return finalize_mesh("armor_chest", bm, smooth=False, color_fn=lambda tx, ty, tz, nx, ny, nz: bone_ao(0.84 + 0.16 * max(0.0, ny + abs(nz) * 0.3)))

def build_armor_abdomen():
    bm = bmesh.new()
    for (cy, sx, sy, cz) in [
        (1.82, 0.48, 0.38, 0.86),
        (1.36, 0.45, 0.38, 0.85),
        (0.90, 0.42, 0.36, 0.82),
    ]:
        for s in (-1, 1):
            _make_beveled_plate(bm, s * 0.28, cy, cz, sx, sy, 0.16, curve_x=0.06, keel=0.03, rot_y=s * 0.10)
            _make_beveled_plate(bm, s * 0.88, cy + 0.04, cz - 0.24, 0.58, sy * 0.95, 0.15, curve_x=0.12, keel=0.02, rot_y=s * 0.58)
            _make_beveled_plate(bm, s * 0.46, cy + 0.06, -0.74, 0.76, sy * 1.02, 0.15, curve_x=-0.10, keel=-0.03, rot_y=-s * 0.18)
    return finalize_mesh("armor_abdomen", bm, smooth=False, color_fn=lambda tx, ty, tz, nx, ny, nz: bone_ao(0.78 + 0.16 * max(0.0, ny + abs(nz) * 0.25)))

def build_armor_shoulder():
    bm = bmesh.new()
    _make_beveled_plate(bm, 0.42, -0.38, 0.0, 0.82, 0.92, 0.18, curve_x=0.18, taper_top=0.82, taper_bot=1.04, keel=0.05, rot_y=math.pi * 0.5, rot_z=-0.12)
    _make_beveled_plate(bm, 0.36, -1.38, 0.04, 0.74, 0.96, 0.16, curve_x=0.16, taper_top=1.04, taper_bot=0.82, keel=0.04, rot_y=math.pi * 0.46)
    return finalize_mesh("armor_shoulder", bm, smooth=False, color_fn=lambda tx, ty, tz, nx, ny, nz: bone_ao(0.84 + 0.16 * max(0.0, ny + abs(nx) * 0.3)))

def build_armor_forearm():
    bm = bmesh.new()
    _make_beveled_plate(bm, 0.26, -1.05, 0.08, 0.68, 1.56, 0.16, curve_x=0.16, taper_top=1.08, taper_bot=0.74, keel=0.04, rot_y=math.pi * 0.38)
    _make_beveled_plate(bm, 0.0, -1.08, -0.26, 0.56, 1.52, 0.15, curve_x=-0.12, taper_top=1.06, taper_bot=0.72, keel=-0.04)
    return finalize_mesh("armor_forearm", bm, smooth=False, color_fn=lambda tx, ty, tz, nx, ny, nz: bone_ao(0.80 + 0.16 * max(0.0, ny)))

def build_armor_thigh():
    bm = bmesh.new()
    _make_beveled_plate(bm, 0.04, -1.16, 0.52, 0.86, 1.68, 0.20, curve_x=0.18, taper_top=1.10, taper_bot=0.82, keel=0.05)
    _make_beveled_plate(bm, 0.48, -1.12, 0.04, 0.78, 1.62, 0.18, curve_x=0.16, taper_top=1.08, taper_bot=0.82, keel=0.04, rot_y=math.pi * 0.44)
    return finalize_mesh("armor_thigh", bm, smooth=False, color_fn=lambda tx, ty, tz, nx, ny, nz: bone_ao(0.84 + 0.16 * max(0.0, ny + nz * 0.25)))

def build_armor_shin():
    bm = bmesh.new()
    _make_beveled_plate(bm, 0.0, -0.04, 0.44, 0.62, 0.48, 0.18, curve_x=0.12, taper_top=0.76, taper_bot=0.76, keel=0.06)
    _make_beveled_plate(bm, 0.02, -1.10, 0.36, 0.68, 1.48, 0.18, curve_x=0.16, taper_top=1.08, taper_bot=0.74, keel=0.06)
    return finalize_mesh("armor_shin", bm, smooth=False, color_fn=lambda tx, ty, tz, nx, ny, nz: bone_ao(0.84 + 0.16 * max(0.0, ny + nz * 0.25)))

def build_armor_face():
    bm = bmesh.new()
    _make_beveled_plate(bm, 0.0, 1.56, 0.86, 1.32, 0.46, 0.16, curve_x=0.28, taper_top=1.06, taper_bot=0.86, keel=0.05, rot_x=0.14)
    _make_beveled_plate(bm, 0.0, 1.10, 0.94, 0.24, 0.44, 0.14, curve_x=0.04, taper_top=0.75, taper_bot=1.05, keel=0.05, rot_x=-0.12)
    for s in (-1, 1):
        _make_beveled_plate(bm, s * 0.58, 1.02, 0.72, 0.56, 0.44, 0.14, curve_x=0.10, keel=0.04, rot_y=s * 0.52)
        _make_beveled_plate(bm, s * 0.56, 0.46, 0.64, 0.52, 0.52, 0.14, curve_x=0.10, keel=0.04, rot_y=s * 0.58)
    _make_beveled_plate(bm, 0.0, 0.18, 0.78, 0.84, 0.28, 0.16, curve_x=0.18, taper_top=1.06, taper_bot=0.78, keel=0.05, rot_x=-0.15)
    return finalize_mesh("armor_face", bm, smooth=False, color_fn=lambda tx, ty, tz, nx, ny, nz: bone_ao(0.86 + 0.14 * max(0.0, ny + nz * 0.3)))

# ==============================================================================
# 7. ENVIRONMENT PROPS: WALL CANNON, STREET LAMP, SUPPLY WAGON, FOUNTAIN, TREES
# ==============================================================================
def add_box(bm, cx, cy, cz, sx, sy, sz, rot_x=0.0, rot_y=0.0, rot_z=0.0, color=(1, 1, 1), tag_dict=None):
    res = bmesh.ops.create_cube(bm, size=1.0)
    verts = res["verts"]
    rot = Euler_to_Matrix(rot_x, rot_y, rot_z)
    for v in verts:
        p = rot @ Vector((v.co.x * sx, v.co.z * sy, v.co.y * sz)) + Vector((cx, cy, cz))
        v.co = to_blender(p.x, p.y, p.z)
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
            else:
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

def add_spoked_wheel(bm, wx, wy, wz, radius, width, n_spokes, wood_col, iron_col, tc):
    segs = 20
    r_outer = radius
    r_inner = radius * 0.82
    r_tire = radius * 1.04
    for (r_a, r_b, w_len, col) in [
        (r_inner, r_outer, width, wood_col),
        (r_outer * 0.98, r_tire, width * 1.06, iron_col),
    ]:
        ring_verts = []
        for x_off in (-w_len * 0.5, w_len * 0.5):
            for r_cur in (r_a, r_b):
                row = []
                for i in range(segs):
                    ang = (i / segs) * math.tau
                    ty = wy + math.sin(ang) * r_cur
                    tz = wz + math.cos(ang) * r_cur
                    v = bm.verts.new(to_blender(wx + x_off, ty, tz))
                    tc[v] = col
                    row.append(v)
                ring_verts.append(row)
        for i in range(segs):
            ni = (i + 1) % segs
            bm.faces.new((ring_verts[1][i], ring_verts[3][i], ring_verts[3][ni], ring_verts[1][ni]))
            bm.faces.new((ring_verts[0][i], ring_verts[0][ni], ring_verts[2][ni], ring_verts[2][i]))
            bm.faces.new((ring_verts[0][i], ring_verts[1][i], ring_verts[1][ni], ring_verts[0][ni]))
            bm.faces.new((ring_verts[2][i], ring_verts[2][ni], ring_verts[3][ni], ring_verts[3][i]))

    spoke_len = r_inner - radius * 0.18
    spoke_r = radius * 0.18 + spoke_len * 0.5
    for s_idx in range(n_spokes):
        ang = (s_idx / n_spokes) * math.tau
        sy = wy + math.sin(ang) * spoke_r
        sz = wz + math.cos(ang) * spoke_r
        add_box(bm, wx, sy, sz, width * 0.52, spoke_len, width * 0.45, rot_x=math.pi * 0.5 - ang, color=wood_col, tag_dict=tc)

    add_cyl(bm, wx, wy, wz, radius * 0.22, radius * 0.22, width * 1.45, axis='X', segs=12, color=wood_col, tag_dict=tc)
    add_cyl(bm, wx, wy, wz, radius * 0.14, radius * 0.14, width * 1.75, axis='X', segs=10, color=iron_col, tag_dict=tc)

def finalize_tagged(name, bm, tag_dict, smooth=False):
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.normal_update()
    color_layer = bm.loops.layers.color.new("Col")
    for f in bm.faces:
        f.smooth = smooth
        for loop in f.loops:
            c = tag_dict.get(loop.vert, (0.8, 0.8, 0.8))
            _, _, _, _, ny, _ = (*from_blender(loop.vert.co), *from_blender(loop.vert.normal))
            ao = 0.86 + 0.14 * max(0.0, ny)
            loop[color_layer] = (min(1.0, c[0] * ao), min(1.0, c[1] * ao), min(1.0, c[2] * ao), 1.0)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj

def build_wall_cannon():
    bm = bmesh.new()
    tc = {}
    wood = (0.43, 0.29, 0.17)
    wood_dk = (0.31, 0.20, 0.12)
    iron = (0.22, 0.24, 0.27)
    bronze = (0.36, 0.33, 0.28)
    bore_dk = (0.06, 0.06, 0.07)

    for s in (-1, 1):
        add_box(bm, s * 0.46, 0.62, -0.28, 0.18, 0.44, 2.35, color=wood, tag_dict=tc)
        add_box(bm, s * 0.46, 0.94, 0.26, 0.20, 0.28, 1.22, color=wood_dk, tag_dict=tc)
        add_box(bm, s * 0.46, 1.12, 0.10, 0.22, 0.14, 0.42, color=iron, tag_dict=tc)
    add_box(bm, 0.0, 0.52, -1.24, 0.88, 0.26, 0.48, color=wood_dk, tag_dict=tc)
    add_cyl(bm, 0.0, 0.52, -1.55, 0.12, 0.12, 0.20, axis='Z', segs=10, color=iron, tag_dict=tc)
    add_box(bm, 0.0, 0.68, 0.35, 1.46, 0.22, 0.24, color=iron, tag_dict=tc)

    add_cyl(bm, 0.0, 0.82, -0.48, 0.05, 0.05, 0.58, axis='Y', segs=10, color=iron, tag_dict=tc)
    add_cyl(bm, 0.0, 0.92, -0.48, 0.20, 0.20, 0.04, axis='Y', segs=12, color=bronze, tag_dict=tc)

    for s in (-1, 1):
        add_spoked_wheel(bm, s * 0.72, 0.68, 0.35, 0.66, 0.14, 8, wood_dk, iron, tc)

    add_cyl(bm, 0.0, 1.16, 0.10, 0.13, 0.13, 1.18, axis='X', segs=12, color=iron, tag_dict=tc)
    add_cyl(bm, 0.0, 1.16, 0.55, 0.31, 0.21, 2.75, axis='Z', segs=20, color=bronze, tag_dict=tc)
    add_cyl(bm, 0.0, 1.16, -0.45, 0.33, 0.32, 0.22, axis='Z', segs=20, color=iron, tag_dict=tc)
    add_cyl(bm, 0.0, 1.16, 0.10, 0.33, 0.33, 0.20, axis='Z', segs=20, color=iron, tag_dict=tc)
    add_cyl(bm, 0.0, 1.16, 1.10, 0.27, 0.26, 0.16, axis='Z', segs=20, color=iron, tag_dict=tc)
    add_cyl(bm, 0.0, 1.16, 1.88, 0.25, 0.28, 0.22, axis='Z', segs=20, color=iron, tag_dict=tc)
    add_cyl(bm, 0.0, 1.16, 1.96, 0.15, 0.15, 0.08, axis='Z', segs=16, color=bore_dk, tag_dict=tc)
    add_cyl(bm, 0.0, 1.16, -0.90, 0.14, 0.10, 0.26, axis='Z', segs=12, color=iron, tag_dict=tc)

    for bx, by, bz in [(-0.85, 0.15, -0.62), (-0.56, 0.15, -0.62), (-0.70, 0.15, -0.88), (-0.70, 0.38, -0.72)]:
        add_cyl(bm, bx, by, bz, 0.15, 0.14, 0.26, axis='Y', segs=10, color=iron, tag_dict=tc)

    return finalize_tagged("wall_cannon", bm, tc, smooth=True)

def build_street_lamp():
    bm = bmesh.new()
    tc = {}
    iron = (0.17, 0.19, 0.22)
    brass = (0.48, 0.40, 0.24)
    gold = (0.99, 0.86, 0.50)

    add_cyl(bm, 0, 0.12, 0, 0.34, 0.30, 0.24, axis='Y', segs=8, color=iron, tag_dict=tc)
    add_cyl(bm, 0, 0.48, 0, 0.24, 0.16, 0.52, axis='Y', segs=8, color=iron, tag_dict=tc)
    add_cyl(bm, 0, 0.78, 0, 0.19, 0.19, 0.10, axis='Y', segs=10, color=brass, tag_dict=tc)
    add_cyl(bm, 0, 2.52, 0, 0.11, 0.075, 3.45, axis='Y', segs=12, color=iron, tag_dict=tc)
    add_cyl(bm, 0, 2.35, 0, 0.14, 0.14, 0.12, axis='Y', segs=10, color=brass, tag_dict=tc)
    add_box(bm, 0, 3.98, 0, 0.72, 0.06, 0.08, color=iron, tag_dict=tc)
    for s in (-1, 1):
        add_box(bm, s * 0.16, 4.10, 0, 0.28, 0.05, 0.05, rot_z=s * 0.55, color=iron, tag_dict=tc)
        add_box(bm, 0, 4.10, s * 0.16, 0.05, 0.05, 0.28, rot_x=-s * 0.55, color=iron, tag_dict=tc)
    add_box(bm, 0, 4.26, 0, 0.52, 0.08, 0.52, color=iron, tag_dict=tc)
    add_cyl(bm, 0, 4.62, 0, 0.18, 0.25, 0.62, axis='Y', segs=8, color=gold, tag_dict=tc)
    for sx in (-1, 1):
        for sz in (-1, 1):
            add_box(bm, sx * 0.18, 4.62, sz * 0.18, 0.035, 0.64, 0.035, rot_z=-sx * 0.08, rot_x=sz * 0.08, color=iron, tag_dict=tc)
    add_cyl(bm, 0, 4.98, 0, 0.34, 0.14, 0.16, axis='Y', segs=8, color=iron, tag_dict=tc)
    add_cyl(bm, 0, 5.14, 0, 0.14, 0.02, 0.22, axis='Y', segs=8, color=brass, tag_dict=tc)
    return finalize_tagged("street_lamp", bm, tc, smooth=False)

def build_supply_wagon():
    bm = bmesh.new()
    tc = {}
    wood = (0.48, 0.34, 0.20)
    wood_lt = (0.62, 0.47, 0.30)
    wood_dk = (0.35, 0.24, 0.14)
    iron = (0.23, 0.25, 0.28)
    steel = (0.58, 0.63, 0.68)
    brass = (0.72, 0.58, 0.28)

    add_box(bm, 0, 0.80, 0, 1.86, 0.14, 3.24, color=wood, tag_dict=tc)
    for pz in (-1.2, -0.4, 0.4, 1.2):
        add_box(bm, 0, 0.70, pz, 1.94, 0.10, 0.14, color=wood_dk, tag_dict=tc)
    for wz in (-0.98, 0.98):
        add_box(bm, 0, 0.58, wz, 2.02, 0.12, 0.14, color=iron, tag_dict=tc)
        for s in (-1, 1):
            add_spoked_wheel(bm, s * 1.02, 0.58, wz, 0.56, 0.11, 8, wood_dk, iron, tc)

    for s in (-1, 1):
        add_box(bm, s * 0.88, 1.08, 0, 0.08, 0.14, 3.22, color=wood_lt, tag_dict=tc)
        add_box(bm, s * 0.88, 1.38, 0, 0.08, 0.14, 3.22, color=wood_lt, tag_dict=tc)
        for sz in (-1.52, -0.76, 0.0, 0.76, 1.52):
            add_box(bm, s * 0.90, 1.16, sz, 0.10, 0.68, 0.10, color=wood_dk, tag_dict=tc)
    add_box(bm, 0, 1.18, -1.56, 1.84, 0.64, 0.08, color=wood_lt, tag_dict=tc)
    add_box(bm, 0, 1.08, 1.56, 1.84, 0.44, 0.08, color=wood_lt, tag_dict=tc)

    for s in (-1, 1):
        add_box(bm, s * 0.46, 0.76, 2.30, 0.09, 0.09, 1.55, color=wood_dk, tag_dict=tc)
    add_box(bm, 0, 0.76, 1.72, 1.12, 0.09, 0.10, color=iron, tag_dict=tc)

    add_box(bm, -0.38, 1.24, -0.68, 0.84, 0.74, 0.84, color=wood_lt, tag_dict=tc)
    add_box(bm, -0.38, 1.24, -0.68, 0.88, 0.12, 0.88, color=wood_dk, tag_dict=tc)
    add_cyl(bm, -0.38, 1.22, 0.48, 0.34, 0.34, 0.76, axis='Y', segs=14, color=wood, tag_dict=tc)
    for by in (1.02, 1.42):
        add_cyl(bm, -0.38, by, 0.48, 0.355, 0.355, 0.06, axis='Y', segs=14, color=iron, tag_dict=tc)
    for gx, gz in [(0.42, -0.85), (0.42, -0.28), (0.42, 0.28), (0.42, 0.85)]:
        add_cyl(bm, gx, 1.30, gz, 0.21, 0.21, 0.86, axis='Y', segs=14, color=steel, tag_dict=tc)
        add_cyl(bm, gx, 1.76, gz, 0.08, 0.06, 0.14, axis='Y', segs=10, color=brass, tag_dict=tc)
    add_box(bm, 0.42, 1.28, 0.0, 0.48, 0.08, 2.15, color=iron, tag_dict=tc)

    return finalize_tagged("supply_wagon", bm, tc, smooth=False)

def build_fountain():
    bm = bmesh.new()
    tc = {}
    stone = (0.65, 0.62, 0.57)
    stone_lt = (0.74, 0.71, 0.66)
    stone_dk = (0.49, 0.47, 0.43)
    bronze = (0.36, 0.33, 0.26)
    water = (0.32, 0.63, 0.78)

    add_cyl(bm, 0, 0.08, 0, 3.28, 3.22, 0.16, axis='Y', segs=8, color=stone_dk, tag_dict=tc)
    add_cyl(bm, 0, 0.46, 0, 2.92, 3.02, 0.68, axis='Y', segs=8, color=stone, tag_dict=tc)
    add_cyl(bm, 0, 0.84, 0, 3.12, 3.08, 0.12, axis='Y', segs=8, color=stone_lt, tag_dict=tc)
    for k in range(8):
        ang = (k / 8) * math.tau + math.pi / 8
        px, pz = math.cos(ang) * 2.95, math.sin(ang) * 2.95
        add_box(bm, px, 0.48, pz, 0.32, 0.78, 0.32, rot_y=-ang, color=stone_dk, tag_dict=tc)
    add_cyl(bm, 0, 0.76, 0, 2.68, 2.68, 0.16, axis='Y', segs=16, color=water, tag_dict=tc)

    add_cyl(bm, 0, 1.05, 0, 0.78, 0.62, 0.52, axis='Y', segs=8, color=stone_dk, tag_dict=tc)
    add_cyl(bm, 0, 1.72, 0, 0.46, 0.38, 1.25, axis='Y', segs=12, color=stone, tag_dict=tc)
    for k in range(4):
        ang = (k / 4) * math.tau
        add_cyl(bm, math.cos(ang) * 0.45, 1.65, math.sin(ang) * 0.45, 0.10, 0.07, 0.24, axis='Y', segs=8, color=bronze, tag_dict=tc)

    add_cyl(bm, 0, 2.38, 0, 0.98, 1.42, 0.34, axis='Y', segs=12, color=stone_lt, tag_dict=tc)
    add_cyl(bm, 0, 2.52, 0, 1.22, 1.22, 0.10, axis='Y', segs=12, color=water, tag_dict=tc)
    add_cyl(bm, 0, 2.88, 0, 0.28, 0.18, 0.68, axis='Y', segs=8, color=stone_dk, tag_dict=tc)
    add_cyl(bm, 0, 3.24, 0, 0.56, 0.72, 0.22, axis='Y', segs=10, color=stone_lt, tag_dict=tc)
    add_cyl(bm, 0, 3.58, 0, 0.18, 0.03, 0.52, axis='Y', segs=8, color=bronze, tag_dict=tc)
    return finalize_tagged("fountain", bm, tc, smooth=False)

def build_giant_tree_trunk():
    rings = []
    N = 14
    for k in range(N + 1):
        u = k / N
        ty = u
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
        ao = 0.62 + 0.38 * min(1.0, ty / 0.18)
        furrow = 0.90 + 0.10 * math.sin(math.atan2(tx, tz) * 14.0)
        s = ao * furrow
        return (s, s * 0.96, s * 0.92)

    return finalize_mesh("giant_tree_trunk", bm, smooth=True, color_fn=color_fn)

def build_foliage_cluster():
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
        t = max(0.0, min(1.0, (ty + 0.38) / 0.82 * 0.65 + (ny * 0.5 + 0.5) * 0.35))
        r = 0.52 + t * 0.56
        g = 0.62 + t * 0.46
        b = 0.55 + t * 0.35
        return (min(1.0, r), min(1.0, g), min(1.0, b))

    return finalize_mesh("foliage_cluster", bm, smooth=True, color_fn=color_fn)

# Build all objects
objs = [
    build_titan_torso(colossus=False),
    build_titan_torso(colossus=True),
    build_titan_pelvis(),
    build_titan_neck(),
    build_titan_nape(),
    build_titan_head(colossus=False),
    build_titan_head(colossus=True),
    build_titan_teeth(),
    build_titan_hair_short(),
    build_titan_hair_shaggy(),
    build_titan_hair_long(),
    build_titan_hair_armored(),
    build_titan_upper_arm(),
    build_titan_forearm(),
    build_titan_hand(),
    build_titan_thigh(),
    build_titan_calf(),
    build_titan_foot(),
    build_armor_nape(),
    build_armor_chest(),
    build_armor_abdomen(),
    build_armor_shoulder(),
    build_armor_forearm(),
    build_armor_thigh(),
    build_armor_shin(),
    build_armor_face(),
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
    print(f"  - {o.name:24s} verts={len(o.data.vertices):5d} tris={len(o.data.polygons):5d}")
