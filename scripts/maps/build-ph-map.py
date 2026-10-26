#!/usr/bin/env python3
"""Builds the Council Statistics map shapes (src/web/public/maps/ph-*.json).

Input: geoBoundaries "gbOpen" simplified GeoJSON for the Philippines (CC BY 3.0 IGO;
source NAMRIA / PSA / OCHA):
  ADM1 (17 regions)   https://www.geoboundaries.org/api/current/gbOpen/PHL/ADM1/
  ADM2 (87 provinces) https://www.geoboundaries.org/api/current/gbOpen/PHL/ADM2/
Download each `simplifiedGeometryGeoJSON` file, then:

  python3 scripts/maps/build-ph-map.py adm1.geojson adm2.geojson src/web/public/maps

Output: two small JSON files of ready-to-draw SVG path strings in one shared viewBox, so
the phone just paints them — no map library, no projection maths in the browser. Each
shape is tied to OUR reference data (dbo.Region.RegionCode / dbo.Province.ProvinceCode,
db/seed/05_ph_geography.sql), so the app sums member counts onto shapes by code:

  ph-regions.json   { viewBox, attribution, shapes: [{ key, regionCode, name, label, d, cx, cy }] }
  ph-provinces.json { viewBox, attribution, shapes: [{ key, provinceCodes: [..], regionCode, name, d, cx, cy }] }

Our province list differs from the map's (it lists Metro Manila's cities as provinces, keeps
Kalinga-Apayao as one, has no Davao Occidental / Dinagat Islands / the two chartered cities),
so the mapping below is explicit; the script fails loudly if any of our codes or any map
shape is left unassigned.
"""
import json
import math
import sys

# ---- Our regions (dbo.Region) -> map region name ------------------------------------------
REGIONS = {
    "01": ("ARMM", "ARMM (Bangsamoro)"),
    "02": ("CAR", "Cordillera (CAR)"),
    "03": ("NCR", "Metro Manila (NCR)"),
    "04": ("Ilocos Region", "Region 1 · Ilocos"),
    "05": ("Cagayan Valley", "Region 2 · Cagayan Valley"),
    "06": ("Central Luzon", "Region 3 · Central Luzon"),
    "07": ("Calabarzon", "Region 4A · Calabarzon"),
    "08": ("Mimaropa", "Region 4B · Mimaropa"),
    "09": ("Bicol Region", "Region 5 · Bicol"),
    "10": ("Western Visayas", "Region 6 · Western Visayas"),
    "11": ("Central Visayas", "Region 7 · Central Visayas"),
    "12": ("Eastern Visayas", "Region 8 · Eastern Visayas"),
    "13": ("Zamboanga Peninsula", "Region 9 · Zamboanga Peninsula"),
    "14": ("Northern Mindanao", "Region 10 · Northern Mindanao"),
    "15": ("Davao Region", "Region 11 · Davao"),
    "16": ("Soccsksargen", "Region 12 · Soccsksargen"),
    "17": ("Caraga", "Region 13 · Caraga"),
}

# ---- Our provinces (dbo.Province code -> display name, region code) -----------------------
PROVINCES = {
    8: ("Basilan", "01"), 41: ("Lanao del Sur", "01"), 44: ("Maguindanao", "01"), 84: ("Sulu", "01"), 89: ("Tawi-Tawi", "01"),
    1: ("Abra", "02"), 12: ("Benguet", "02"), 32: ("Ifugao", "02"), 37: ("Kalinga-Apayao", "02"), 56: ("Mountain Province", "02"),
    18: ("Caloocan", "03"), 42: ("Las Piñas", "03"), 45: ("Makati", "03"), 46: ("Malabon", "03"), 47: ("Mandaluyong", "03"),
    48: ("Manila", "03"), 49: ("Marikina", "03"), 57: ("Muntinlupa", "03"), 58: ("Navotas", "03"), 68: ("Parañaque", "03"),
    69: ("Pasay", "03"), 70: ("Pasig", "03"), 71: ("Pateros", "03"), 72: ("Quezon City", "03"), 77: ("San Juan", "03"),
    87: ("Taguig", "03"), 90: ("Valenzuela", "03"),
    33: ("Ilocos Norte", "04"), 34: ("Ilocos Sur", "04"), 38: ("La Union", "04"), 67: ("Pangasinan", "04"),
    10: ("Batanes", "05"), 17: ("Cagayan", "05"), 36: ("Isabela", "05"), 64: ("Nueva Vizcaya", "05"), 74: ("Quirino", "05"),
    7: ("Aurora", "06"), 9: ("Bataan", "06"), 16: ("Bulacan", "06"), 63: ("Nueva Ecija", "06"), 66: ("Pampanga", "06"),
    88: ("Tarlac", "06"), 92: ("Zambales", "06"),
    11: ("Batangas", "07"), 24: ("Cavite", "07"), 39: ("Laguna", "07"), 73: ("Quezon", "07"), 75: ("Rizal", "07"),
    50: ("Marinduque", "08"), 52: ("Occidental Mindoro", "08"), 53: ("Oriental Mindoro", "08"), 65: ("Palawan", "08"), 76: ("Romblon", "08"),
    5: ("Albay", "09"), 19: ("Camarines Norte", "09"), 20: ("Camarines Sur", "09"), 23: ("Catanduanes", "09"), 51: ("Masbate", "09"), 80: ("Sorsogon", "09"),
    4: ("Aklan", "10"), 6: ("Antique", "10"), 22: ("Capiz", "10"), 31: ("Guimaras", "10"), 35: ("Iloilo", "10"), 59: ("Negros Occidental", "10"),
    14: ("Bohol", "11"), 25: ("Cebu", "11"), 60: ("Negros Oriental", "11"), 79: ("Siquijor", "11"),
    13: ("Biliran", "12"), 30: ("Eastern Samar", "12"), 43: ("Leyte", "12"), 62: ("Northern Samar", "12"), 82: ("Southern Leyte", "12"), 91: ("Samar", "12"),
    93: ("Zamboanga del Norte", "13"), 94: ("Zamboanga del Sur", "13"), 95: ("Zamboanga Sibugay", "13"),
    15: ("Bukidnon", "14"), 21: ("Camiguin", "14"), 40: ("Lanao del Norte", "14"), 54: ("Misamis Occidental", "14"), 55: ("Misamis Oriental", "14"),
    26: ("Davao de Oro (Compostela Valley)", "15"), 27: ("Davao del Norte", "15"), 28: ("Davao del Sur", "15"), 29: ("Davao Oriental", "15"),
    61: ("Cotabato", "16"), 78: ("Sarangani", "16"), 81: ("South Cotabato", "16"), 83: ("Sultan Kudarat", "16"),
    2: ("Agusan del Norte", "17"), 3: ("Agusan del Sur", "17"), 85: ("Surigao del Norte", "17"), 86: ("Surigao del Sur", "17"),
}

NCR_CODES = [c for c, (_, r) in PROVINCES.items() if r == "03"]

# ---- Map province shapes -> one drawn entry (key, our province codes, display name) --------
# Shapes listed together are merged into one path (same colour, one tap target).
def p(name):  # entry for a one-to-one province
    code = next(c for c, (n, _) in PROVINCES.items() if n == name)
    return (f"P{code}", [code], name)

ENTRIES = {}   # key -> (codes, name, [map shape names])
def add(key, codes, name, shapes):
    ENTRIES[key] = (codes, name, shapes)

ONE_TO_ONE = {
    "Basilan": ["Basilan", "City of Isabela"], "Lanao del Sur": ["Lanao del Sur"],
    "Maguindanao": ["Maguindanao", "Cotabato City"], "Sulu": ["Sulu"], "Tawi-Tawi": ["Tawi-Tawi"],
    "Abra": ["Abra"], "Benguet": ["Benguet"], "Ifugao": ["Ifugao"], "Kalinga-Apayao": ["Kalinga", "Apayao"],
    "Mountain Province": ["Mountain Province"],
    "Ilocos Norte": ["Ilocos Norte"], "Ilocos Sur": ["Ilocos Sur"], "La Union": ["La Union"], "Pangasinan": ["Pangasinan"],
    "Batanes": ["Batanes"], "Cagayan": ["Cagayan"], "Isabela": ["Isabela"], "Nueva Vizcaya": ["Nueva Vizcaya"], "Quirino": ["Quirino"],
    "Aurora": ["Aurora"], "Bataan": ["Bataan"], "Bulacan": ["Bulacan"], "Nueva Ecija": ["Nueva Ecija"], "Pampanga": ["Pampanga"],
    "Tarlac": ["Tarlac"], "Zambales": ["Zambales"],
    "Batangas": ["Batangas"], "Cavite": ["Cavite"], "Laguna": ["Laguna"], "Quezon": ["Quezon"], "Rizal": ["Rizal"],
    "Marinduque": ["Marinduque"], "Occidental Mindoro": ["Occidental Mindoro"], "Oriental Mindoro": ["Oriental Mindoro"],
    "Palawan": ["Palawan"], "Romblon": ["Romblon"],
    "Albay": ["Albay"], "Camarines Norte": ["Camarines Norte"], "Camarines Sur": ["Camarines Sur"], "Catanduanes": ["Catanduanes"],
    "Masbate": ["Masbate"], "Sorsogon": ["Sorsogon"],
    "Aklan": ["Aklan"], "Antique": ["Antique"], "Capiz": ["Capiz"], "Guimaras": ["Guimaras"], "Iloilo": ["Iloilo"],
    "Negros Occidental": ["Negros Occidental"],
    "Bohol": ["Bohol"], "Cebu": ["Cebu"], "Negros Oriental": ["Negros Oriental"], "Siquijor": ["Siquijor"],
    "Biliran": ["Biliran"], "Eastern Samar": ["Eastern Samar"], "Leyte": ["Leyte"], "Northern Samar": ["Northern Samar"],
    "Southern Leyte": ["Southern Leyte"], "Samar": ["Samar"],
    "Zamboanga del Norte": ["Zamboanga del Norte"], "Zamboanga del Sur": ["Zamboanga del Sur"], "Zamboanga Sibugay": ["Zamboanga Sibugay"],
    "Bukidnon": ["Bukidnon"], "Camiguin": ["Camiguin"], "Lanao del Norte": ["Lanao del Norte"],
    "Misamis Occidental": ["Misamis Occidental"], "Misamis Oriental": ["Misamis Oriental"],
    "Davao de Oro (Compostela Valley)": ["Compostela Valley"], "Davao del Norte": ["Davao del Norte"],
    "Davao del Sur": ["Davao del Sur", "Davao Occidental"], "Davao Oriental": ["Davao Oriental"],
    "Cotabato": ["Cotabato"], "Sarangani": ["Sarangani"], "South Cotabato": ["South Cotabato"], "Sultan Kudarat": ["Sultan Kudarat"],
    "Agusan del Norte": ["Agusan del Norte"], "Agusan del Sur": ["Agusan del Sur"],
    "Surigao del Norte": ["Surigao del Norte", "Dinagat Islands"], "Surigao del Sur": ["Surigao del Sur"],
}
for name, shapes in ONE_TO_ONE.items():
    key, codes, disp = p(name)
    add(key, codes, disp, shapes)
add("NCR", NCR_CODES, "Metro Manila (NCR)",
    ["NCR, City of Manila, First District", "NCR, Second District", "NCR, Third District", "NCR, Fourth District"])

# ---- Geometry ------------------------------------------------------------------------------
LAT0 = 12.5                       # middle of the archipelago, for the x scale
KX = math.cos(math.radians(LAT0))
WIDTH = 1000.0


def rings_of(geom):
    t, c = geom["type"], geom["coordinates"]
    if t == "Polygon":
        return [c]
    if t == "MultiPolygon":
        return c
    raise ValueError(t)


def area(ring):
    s = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def dp(points, tol):
    """Douglas–Peucker, iterative."""
    if len(points) < 4:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        far, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            dist = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if dist > far:
                far, idx = dist, i
        if far > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [pt for pt, k in zip(points, keep) if k]


def dp_ring(ring, tol):
    """Douglas–Peucker for a CLOSED ring. Plain dp() measures every point against the line
    from the first to the last point — on a closed ring those are the same point, the line
    has no length, and the whole island collapses. Split at the point farthest from the
    start and simplify each half, then rejoin (start ... far ... start)."""
    if len(ring) < 4:
        return ring
    x0, y0 = ring[0]
    far = max(range(len(ring)), key=lambda i: (ring[i][0] - x0) ** 2 + (ring[i][1] - y0) ** 2)
    first = dp(ring[: far + 1], tol)
    second = dp(ring[far:], tol)
    return first[:-1] + second


def ring_d(points):
    """One closed ring as a compact SVG path: whole-number coordinates (the viewBox is ~1000
    wide, so 1 unit is finer than any phone pixel), first point absolute, the rest relative."""
    pts = [(round(x), round(y)) for x, y in points]
    dedup = [pts[0]] + [b for a, b in zip(pts, pts[1:]) if a != b]
    x0, y0 = dedup[0]
    out = [f"M{x0} {y0}"]
    px, py = x0, y0
    for x, y in dedup[1:]:
        out.append(f"l{x - px} {y - py}")
        px, py = x, y
    return "".join(out) + "z"


def main(adm1_path, adm2_path, out_dir):
    adm1 = json.load(open(adm1_path, encoding="utf-8"))
    adm2 = json.load(open(adm2_path, encoding="utf-8"))

    # One shared projection for both files: bounding box of the provinces layer.
    lons, lats = [], []
    for f in adm2["features"]:
        for poly in rings_of(f["geometry"]):
            for x, y in poly[0]:
                lons.append(x)
                lats.append(y)
    lon0, lon1, lat0, lat1 = min(lons), max(lons), min(lats), max(lats)
    scale = WIDTH / ((lon1 - lon0) * KX)
    height = (lat1 - lat0) * scale

    def proj(pt):
        return ((pt[0] - lon0) * KX * scale, (lat1 - pt[1]) * scale)

    tol, min_area = 1.4, 10.0       # in viewBox units (≈ 1000 wide): finer than a phone shows

    def path_for(features):
        parts, wsum, cx, cy = [], 0.0, 0.0, 0.0
        for f in features:
            for poly in rings_of(f["geometry"]):
                outer = [proj(pt) for pt in poly[0]]
                a = area(outer)
                if a < min_area:
                    continue
                simple = dp_ring(outer, tol)
                if len(simple) < 4:
                    continue
                parts.append(ring_d(simple[:-1]))
                mx = sum(x for x, _ in outer) / len(outer)
                my = sum(y for _, y in outer) / len(outer)
                cx, cy, wsum = cx + mx * a, cy + my * a, wsum + a
        if not parts:   # every ring tiny (a very small province): keep its largest ring anyway
            best = max((proj_ring for f in features for proj_ring in
                        ([proj(pt) for pt in poly[0]] for poly in rings_of(f["geometry"]))), key=area)
            parts = [ring_d(best[:-1])]
            cx, cy, wsum = sum(x for x, _ in best) / len(best), sum(y for _, y in best) / len(best), 1.0
        return "".join(parts), round(cx / wsum, 1), round(cy / wsum, 1)

    attribution = "Boundaries: geoBoundaries (NAMRIA, PSA, OCHA), CC BY 3.0 IGO"
    view_box = f"0 0 {WIDTH:.0f} {height:.0f}"

    # Regions
    by_name = {f["properties"]["shapeName"]: f for f in adm1["features"]}
    regions = []
    for code, (shape_name, label) in REGIONS.items():
        d, cx, cy = path_for([by_name[shape_name]])
        regions.append({"key": f"R{code}", "regionCode": code, "name": label, "d": d, "cx": cx, "cy": cy})
    assert len(regions) == len(adm1["features"]), "a map region is unassigned"

    # Provinces
    by_name2 = {f["properties"]["shapeName"]: f for f in adm2["features"]}
    used = set()
    provinces = []
    for key, (codes, name, shapes) in ENTRIES.items():
        missing = [s for s in shapes if s not in by_name2]
        assert not missing, f"map shapes not found: {missing}"
        used.update(shapes)
        d, cx, cy = path_for([by_name2[s] for s in shapes])
        provinces.append({"key": key, "provinceCodes": sorted(codes), "regionCode": PROVINCES[codes[0]][1],
                          "name": name, "d": d, "cx": cx, "cy": cy})
    unused = set(by_name2) - used
    assert not unused, f"map shapes left unassigned: {sorted(unused)}"
    assigned = sorted(c for e in provinces for c in e["provinceCodes"])
    assert assigned == sorted(PROVINCES), "a province code is unassigned or duplicated"

    for fname, shapes in (("ph-regions.json", regions), ("ph-provinces.json", provinces)):
        with open(f"{out_dir}/{fname}", "w", encoding="utf-8") as fh:
            json.dump({"viewBox": view_box, "attribution": attribution, "shapes": shapes}, fh,
                      ensure_ascii=False, separators=(",", ":"))
        print(fname, len(shapes), "shapes")


if __name__ == "__main__":
    main(*sys.argv[1:4])
