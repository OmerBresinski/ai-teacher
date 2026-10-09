// Batch G kit parts: history, geography and people (map_skills, hist_map, place_change,
// community_helpers; family trees for any people model).
// White things (coats, signs, ambulances) use --cloud so they stay white in Night.
// Plain ES module on the kit core. Tokens only (every fill is a token or a color-mix of tokens,
// the same way the tokens stylesheet derives its roles). Every word is real SVG text; callers pass the params
// path for each word (edit) or the value it comes from (computedPath). Nothing runs on a timer:
// builds are attributes (s / hide / c) the caller passes in `a` (or per-item attrs functions).
//
// MAPS (outlines are hand-simplified for this kit from public-domain geography, so they are
// licence-clear; equirectangular with a standard parallel at the view's middle latitude, so a
// region keeps its true shape there; no coastline is exaggerated)
//   basemap(p, region, {box, view:{lon:[w,e], lat:[s,n]}, cover=false, graticule=false, sea=true, a})
//       region: 'uk' | 'europe' | 'mediterranean' | 'world' (lon/lat maps) or 'school' | 'classroom'
//       (plans drawn in the box; positions are 0..1 fractions of the frame).
//       -> {g, land, frame:{x,y,w,h}, proj(lon,lat)->[x,y] (or (fx,fy) for plans), at(name)->[x,y]|null,
//           landClip (clip-path url of the land, for territory), features (plans: {name:{x,y,w,h,cx,cy}}),
//           kmPerUnit (lon/lat maps: km per slide unit at the standard parallel, for a true scale bar)}
//   REGIONS, PLACES {name: [lon, lat]} (real places, for routes that must start and end somewhere real),
//   placeOf(name) -> [lon,lat] | null.
//   todayBorders(p, map, {a}) -> g. Faint dashed modern borders (UK nations and the Irish border only).
//   compassRose(p, x, y, {r=56, points=4|8, north=0 (degrees clockwise), labels={N,E,S,W}, edit={N:path..}, a})
//       -> {g, box, dir(name)->angle}. Letters stay upright, carry the halo class.
//   gridRefs(p, box, cols, rows, {e0=0, n0=0, digits=2, tenths=false, computedPath, a})
//       -> {g, x(e), y(n), cell(e,n)->box, ref4(e,n), ref6(e,n), warnings[]}. Eastings run along the
//       bottom (along the corridor), northings up the left (up the stairs). Line numbers are computed text.
//   scaleBar(p, x, y, {km, map, units='km'|'m', label, computedPath, a}) -> {g, w}. True for the drawn map.
//   route(p, pts, {col='var(--focus)', w='var(--sw-data)', s, delay, smooth=true, dash, stops, head=16, a})
//       -> {g, d, len}. Draws on at build s (class draw); a dashed route fades in instead.
//   territory(p, poly, era (1..6), {clip: map.landClip, hatch=false, a}) -> {g, box, centre}.
//       poly in slide units. hatch = an uncertain or claimed extent.
//   pin(p, x, y, label, {edit, anchor='start', dx, dy, col='var(--event)', r=7, a}) -> {g, box}.
//       A place dot with its name on a solid label ground (ground drawn before the leader).
//
// PEOPLE
//   figure(p, role, x, y, s=1, {skin, hair:'short'|'long'|'bun'|'none', hairCol, sign, signEdit, a})
//       roles: firefighter, nurse, doctor, police, postal, lollipop, teacher, refuse, vet, person.
//       Built on the kit person, each with its own props (helmet, stethoscope, lollipop sign, bag ...).
//   ROLES {role: {name, props[], vehicle, place}} (truth table: which tools belong to which helper).
//   SKINS (three tones), HAIR_COLS, look(i) -> {skin, hair, hairCol}: a mixed, deterministic cast.
//   EMERGENCY {GB:'999', IN:'112', ...} the locale's emergency number.
//
// PERIOD OBJECTS AND VEHICLES (side view, base centre at x,y; s=1 is about 60 units tall)
//   periodObject(p, kind, x, y, s=1, a, {sign, signEdit}) kinds: horse_cart, early_car, car, bus,
//       fire_engine, ambulance, police_car, post_van, bin_lorry, gas_lamp, street_lamp, beach_hut,
//       bathing_machine, shopfront, teddy, spinning_top, hoop, tablet, smartphone.
//   PERIODS {kind: {from, to|null, name}}, G_OBJECT_CULTURES {kind: [culture tags]},
//   OBJECT_TOPICS {kind: [topic tags]}, objectsFor(year, topic?) -> kinds that existed that year,
//   periodCheck(kind, year) -> null | refusal reason, sceneryForG(culture) -> kinds (signature first).
//
// FAMILY TREES
//   treeLayout(p, nodes, {box, cardW=220, cardH=104, editBase='people', attrs(node,i)->{s,c,cls}, focus, a})
//       nodes: [{id, name, note?, parents?:[id,id], partner?:id}]
//       -> {g, cards:{id:{box, g}}, warnings[]}. Generations by descent, partners side by side,
//       connectors in a group under the cards (they never cross a name).
import { landRings, gazPlace } from './geo.js'; // libdata: real land
import { h, T, measure, clamp, rng } from './svg.js';
import { GRID } from './layout.js';
import { editable, computed, textBlock, labelGround, headD } from './components.js';

let UID = 0;
const P2 = (pts, close = true) => 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L') + (close ? ' Z' : '');

/* ------------------------------------------------------------------ outlines (lon, lat) */
const LAND = {
  britain: [[-5.7,50.05],[-5.0,50.0],[-4.2,50.35],[-3.5,50.3],[-3.0,50.7],[-2.0,50.6],[-1.3,50.75],[-0.8,50.75],[0.3,50.75],[1.0,50.95],[1.4,51.15],[1.4,51.38],[0.9,51.5],[0.6,51.55],[0.9,51.75],[1.3,51.95],[1.75,52.45],[1.7,52.75],[1.3,52.95],[0.4,52.95],[0.2,52.85],[0.35,53.2],[0.1,53.55],[-0.1,53.65],[-0.3,54.1],[-0.6,54.5],[-1.2,54.65],[-1.5,55.0],[-1.6,55.6],[-2.0,55.85],[-2.6,56.05],[-2.6,56.3],[-2.8,56.45],[-2.5,56.6],[-2.0,57.15],[-1.8,57.5],[-2.0,57.68],[-3.0,57.7],[-3.6,57.65],[-4.2,57.5],[-3.8,57.85],[-3.1,58.6],[-3.4,58.65],[-4.5,58.55],[-5.0,58.62],[-5.2,58.3],[-5.4,57.9],[-5.7,57.6],[-5.6,57.2],[-5.8,56.8],[-5.6,56.5],[-5.4,56.2],[-5.7,55.7],[-5.6,55.3],[-5.0,55.7],[-4.9,55.2],[-5.15,54.85],[-4.4,54.9],[-3.6,54.95],[-3.4,54.6],[-3.1,54.15],[-2.9,53.75],[-3.1,53.3],[-3.6,53.3],[-4.2,53.2],[-4.6,53.3],[-4.7,52.8],[-4.1,52.75],[-4.1,52.3],[-4.7,52.1],[-5.2,51.9],[-5.1,51.7],[-4.3,51.65],[-3.9,51.6],[-3.2,51.45],[-2.7,51.5],[-3.0,51.25],[-3.6,51.2],[-4.2,51.2],[-4.6,51.0],[-4.5,50.8],[-5.0,50.55],[-5.5,50.2]],
  ireland: [[-6.2,53.3],[-6.0,52.95],[-6.0,52.6],[-6.4,52.18],[-7.0,52.13],[-7.6,51.95],[-8.2,51.8],[-9.0,51.6],[-9.8,51.5],[-10.3,51.8],[-9.9,52.1],[-10.4,52.2],[-9.6,52.6],[-9.4,53.0],[-10.0,53.4],[-9.9,53.9],[-10.0,54.2],[-9.1,54.3],[-8.5,54.3],[-8.6,54.65],[-8.3,55.1],[-7.6,55.25],[-6.9,55.2],[-6.1,55.2],[-5.6,54.7],[-5.5,54.4],[-6.1,54.0],[-6.3,53.85]],
  eurasia: [[-5.6,36.0],[-6.3,36.8],[-7.4,37.2],[-8.9,37.0],[-8.8,38.5],[-9.5,38.75],[-8.9,40.0],[-8.8,41.5],[-8.9,42.6],[-9.3,43.0],[-8.0,43.7],[-6.0,43.6],[-3.8,43.45],[-1.8,43.4],[-1.4,44.5],[-1.2,45.6],[-2.2,47.1],[-4.4,47.9],[-4.7,48.4],[-3.0,48.8],[-1.6,48.65],[-1.8,49.7],[-1.2,49.4],[0.2,49.45],[1.5,50.2],[1.6,50.9],[2.5,51.1],[3.6,51.45],[4.2,52.0],[4.7,52.9],[5.4,53.3],[6.9,53.5],[8.2,53.6],[8.7,53.9],[8.6,54.9],[8.1,55.5],[8.2,56.8],[8.6,57.1],[9.9,57.6],[10.6,57.7],[10.3,56.6],[10.9,56.4],[10.0,55.7],[9.6,55.0],[10.0,54.5],[11.0,54.0],[12.5,54.4],[14.2,53.9],[16.0,54.3],[18.5,54.8],[19.6,54.4],[21.1,55.3],[21.0,56.8],[22.6,57.6],[24.4,57.3],[23.6,58.9],[24.8,59.5],[28.0,59.5],[30.2,59.9],[29.0,60.2],[26.5,60.4],[22.9,59.9],[21.4,60.6],[21.5,61.7],[21.2,62.8],[22.4,63.8],[24.5,64.9],[25.4,65.1],[24.6,65.8],[22.4,65.85],[21.4,64.8],[20.0,63.7],[18.5,62.9],[17.3,61.5],[17.2,60.6],[18.7,60.0],[17.9,58.9],[16.6,57.4],[16.4,56.6],[15.2,56.15],[14.2,55.4],[12.9,55.5],[12.6,56.2],[11.9,57.6],[11.2,58.9],[10.5,59.3],[9.6,59.0],[8.0,58.1],[6.6,58.1],[5.6,58.9],[5.0,60.2],[5.0,61.6],[5.4,62.5],[7.0,63.0],[9.5,63.8],[10.6,64.8],[12.2,65.9],[13.6,67.6],[15.4,68.4],[17.0,69.0],[18.8,69.8],[21.0,70.2],[23.5,70.6],[25.8,71.1],[28.5,71.0],[31.0,70.3],[33.0,69.4],[36.0,69.1],[41.0,67.7],[40.2,66.4],[38.0,66.1],[35.0,66.2],[33.4,66.6],[34.8,65.2],[34.8,64.4],[36.5,64.2],[38.0,64.6],[40.5,64.6],[44.0,66.2],[44.2,68.3],[46.5,68.2],[53.5,68.5],[60.0,69.6],[68.5,68.2],[73.0,72.5],[80.0,73.5],[90.0,75.5],[100.0,76.5],[105.0,77.6],[113.0,73.6],[130.0,71.0],[140.0,72.5],[150.0,71.5],[160.0,69.6],[170.0,70.0],[180,69.0],[180,65],[178,62.5],[170,60],[163,59.8],[162,57],[156.5,51],[156,57],[163,61.5],[155,59.3],[143,59.3],[137,54],[141,52],[140,48],[135,43.5],[131,42.6],[129.5,40.8],[128.5,38.3],[129.4,35.5],[126.5,34.4],[126.2,37.7],[124.8,39.6],[121.6,38.9],[122.0,40.8],[119.5,39.5],[117.7,38.8],[119.0,37.2],[122.5,37.4],[120.0,35.7],[120.9,32.0],[122.0,30.0],[119.9,26.0],[116.5,23.0],[113.5,22.2],[110.5,21.0],[108.5,21.6],[106.5,20.0],[105.8,18.6],[108.9,15.3],[109.3,11.5],[107.0,10.4],[104.8,8.6],[105.0,10.0],[102.7,12.2],[101.0,12.7],[100.0,13.4],[99.2,9.2],[100.4,7.2],[101.5,6.8],[103.4,4.0],[103.6,1.3],[101.3,2.8],[98.7,8.0],[98.3,10.0],[98.7,13.5],[97.6,16.5],[94.5,16.0],[94.2,18.8],[92.4,20.8],[90.5,22.6],[88.1,21.9],[86.9,20.7],[85.0,19.4],[82.3,16.6],[80.2,15.3],[80.3,13.0],[79.9,10.3],[78.0,8.4],[77.3,8.1],[76.0,10.5],[74.6,14.0],[73.4,16.0],[72.8,19.0],[72.6,21.5],[70.4,20.9],[69.0,22.3],[68.2,23.6],[66.6,25.4],[61.5,25.2],[57.3,25.8],[56.4,27.1],[54.0,26.6],[51.5,27.9],[50.1,30.1],[48.6,29.9],[48.4,28.5],[49.6,27.0],[50.8,24.8],[51.6,24.2],[52.6,24.2],[54.6,24.3],[56.4,26.2],[56.6,24.5],[58.6,23.6],[59.8,22.5],[58.5,20.4],[57.7,19.0],[55.0,17.0],[52.2,15.6],[49.1,14.0],[45.0,12.8],[43.4,12.7],[42.8,15.0],[42.5,17.0],[40.8,19.8],[39.1,21.8],[38.5,23.6],[37.0,25.5],[35.2,28.0],[34.9,29.5],[34.2,27.8],[33.5,28.4],[32.6,29.9],[32.3,31.2],[34.3,31.3],[35.0,32.8],[35.5,33.9],[35.9,35.4],[36.2,36.6],[35.6,36.6],[34.6,36.8],[32.8,36.1],[31.0,36.8],[29.6,36.2],[28.0,36.7],[27.3,37.4],[26.3,38.3],[26.7,39.4],[26.2,40.1],[26.7,40.5],[28.8,40.4],[29.9,40.7],[29.1,41.2],[31.3,41.1],[33.4,42.0],[35.1,42.0],[36.9,41.3],[38.3,40.9],[41.5,41.5],[41.7,42.6],[40.0,43.4],[38.5,44.3],[37.4,44.8],[38.2,46.0],[39.2,47.2],[37.5,47.0],[35.1,46.3],[35.4,45.3],[36.4,45.4],[35.5,44.6],[33.6,44.4],[32.5,45.3],[33.6,46.0],[31.7,46.6],[30.7,46.4],[29.6,45.3],[28.7,44.3],[28.0,43.0],[27.9,42.0],[28.9,41.3],[28.0,41.0],[26.4,40.9],[25.4,40.9],[24.0,40.7],[23.0,40.4],[22.6,40.3],[22.9,39.4],[23.0,38.2],[23.9,38.0],[24.0,37.7],[23.2,37.3],[22.8,36.5],[22.4,36.5],[21.7,36.8],[21.1,37.8],[21.7,38.3],[20.8,39.0],[20.0,39.7],[19.4,40.4],[19.4,41.8],[18.5,42.5],[17.5,43.0],[16.0,43.5],[15.2,44.2],[14.9,45.1],[13.7,45.1],[13.8,45.6],[12.4,45.4],[12.3,44.8],[12.4,44.2],[13.6,43.5],[14.0,42.7],[15.2,41.9],[16.0,41.9],[17.5,40.8],[18.5,40.1],[17.2,40.4],[16.6,39.9],[17.1,39.0],[16.6,38.4],[16.0,38.0],[15.7,38.2],[16.2,38.9],[15.7,40.0],[14.9,40.2],[14.0,40.8],[12.6,41.4],[11.2,42.4],[10.5,42.9],[10.2,43.9],[8.9,44.4],[7.9,43.9],[6.5,43.1],[5.0,43.4],[4.0,43.5],[3.1,43.1],[3.2,42.0],[2.2,41.3],[0.8,41.0],[0.0,39.9],[-0.3,39.4],[0.2,38.7],[-0.7,37.6],[-1.4,37.4],[-2.1,36.7],[-4.4,36.7],[-5.0,36.4]],
  africa: [[32.5,30.0],[31.0,31.5],[30.0,31.3],[29.0,30.9],[25.2,31.6],[23.0,32.6],[21.0,32.8],[20.0,31.0],[19.0,30.3],[15.5,31.6],[13.0,32.9],[11.1,33.3],[10.1,34.3],[11.1,35.2],[10.6,36.6],[9.8,37.3],[8.6,36.9],[5.0,36.8],[3.0,36.8],[1.0,36.5],[-1.2,35.3],[-2.9,35.3],[-5.3,35.9],[-6.0,35.7],[-6.8,34.0],[-8.5,33.3],[-9.7,30.6],[-10.0,29.0],[-13.0,27.6],[-14.5,26.0],[-16.0,23.8],[-17.0,21.0],[-16.3,19.0],[-16.5,16.0],[-17.4,14.7],[-16.8,13.0],[-15.0,11.0],[-13.3,9.0],[-12.0,7.6],[-11.0,6.8],[-9.0,5.0],[-7.5,4.4],[-5.0,5.1],[-2.0,4.8],[1.0,5.9],[2.7,6.3],[4.5,6.3],[6.0,4.3],[7.0,4.4],[8.7,4.6],[9.7,3.0],[9.8,1.0],[9.3,-1.0],[11.2,-3.8],[12.2,-5.8],[13.2,-8.8],[13.6,-12.0],[12.0,-15.5],[11.8,-18.0],[14.5,-22.9],[15.2,-27.0],[16.5,-28.6],[18.0,-31.5],[18.4,-34.2],[20.0,-34.8],[22.5,-34.0],[25.6,-33.9],[27.5,-33.2],[30.0,-31.2],[32.5,-28.5],[32.9,-26.0],[35.4,-24.0],[35.5,-21.5],[34.7,-19.8],[36.8,-17.8],[40.5,-15.0],[40.5,-10.4],[39.3,-7.0],[39.2,-4.7],[40.9,-2.0],[41.5,-1.5],[43.5,0.8],[46.0,2.0],[48.0,4.5],[49.5,7.5],[51.1,10.6],[51.2,11.9],[48.0,11.2],[45.0,10.4],[43.3,11.6],[42.7,13.0],[41.0,14.5],[39.4,15.9],[38.6,18.0],[37.2,21.0],[36.8,22.5],[35.6,24.0],[34.0,26.6],[32.6,29.9]],
  northAmerica: [[-168,65.6],[-166,68.9],[-161,70.3],[-156.5,71.3],[-152,70.8],[-143,70.1],[-137,69],[-130,70],[-124,69.4],[-117,68.6],[-108,68],[-98,67.8],[-95,71.5],[-90,69],[-85,69.8],[-82,66.5],[-87,64.2],[-93,61.5],[-94.5,58.5],[-93,57],[-88,56],[-82.5,55],[-82,52.5],[-79,51.5],[-79,54.5],[-76.6,57],[-78,60],[-78,62.4],[-73,62],[-70,61],[-69.5,58.8],[-64.5,60.3],[-61.5,56],[-57.5,54],[-55.8,51.6],[-60,50.2],[-66,50],[-71,46.8],[-65,49],[-64.2,48.5],[-64.5,46.2],[-61,45.5],[-66,43.7],[-70,43.5],[-70.5,41.8],[-74,40.6],[-75.5,38.5],[-76.3,37],[-75.8,35.2],[-77.5,34.2],[-81,31.5],[-80.5,28],[-80.1,25.8],[-81.1,25.1],[-82.7,27.5],[-83,29.1],[-85.4,29.7],[-89.6,30.2],[-89.3,29.1],[-94,29.7],[-97.2,27.7],[-97.5,25],[-97.8,22.3],[-96.2,19.3],[-94.5,18.2],[-91.4,18.6],[-90.4,21.1],[-87.1,21.5],[-88.2,17.7],[-88.9,15.9],[-83.3,15.1],[-83.6,11],[-81.5,8.8],[-79,9.6],[-77.4,8.6],[-78.4,8.0],[-80.4,7.4],[-82.3,8.3],[-85.7,10.8],[-87.6,13],[-91.4,13.9],[-94.5,16.1],[-96.5,15.7],[-101,17.2],[-105.6,20.4],[-105.2,21.9],[-106.5,23.2],[-109.4,26],[-112.7,31.5],[-114.7,31.7],[-112.2,28.9],[-109.9,23.2],[-112,24.8],[-114.2,28.1],[-115.6,30.4],[-117.1,32.6],[-118.4,34],[-120.6,34.6],[-122.4,37.2],[-123.7,39.4],[-124.3,42],[-124,46.2],[-124.7,48.4],[-123,49],[-127.5,50.6],[-130.5,54.7],[-133,57],[-137,58.9],[-141,60],[-146,61],[-150,61],[-152,59.5],[-154.5,57.5],[-158,56.6],[-162,55],[-158.5,58],[-162,59.8],[-165,62.5],[-164.5,63.5],[-161,64.5],[-166,64.6]],
  southAmerica: [[-77.4,8.6],[-75.5,10.6],[-73,11.6],[-71.5,12.4],[-71,10.9],[-68,10.6],[-64,10.6],[-61.7,10.7],[-60,8.5],[-57,6],[-53.5,5.5],[-51,4],[-50,1.7],[-48.5,-1],[-44.5,-2.5],[-40,-2.9],[-37,-4.8],[-35,-5.5],[-35,-8.9],[-37.2,-11],[-39,-13.5],[-39.2,-17.5],[-40.7,-20.8],[-42,-22.9],[-44.6,-23.4],[-48.5,-26],[-48.7,-28.5],[-50.7,-31],[-53,-33.7],[-55,-35],[-57.3,-36],[-57.5,-38.2],[-62.2,-38.8],[-62,-40.8],[-65,-41],[-63.7,-42.7],[-65.3,-45],[-67.6,-46.6],[-65.8,-48],[-69,-50.4],[-68.4,-52.3],[-71,-53.8],[-74.5,-52.5],[-75.5,-48.5],[-73.5,-44],[-73.2,-41],[-73.7,-37.3],[-71.5,-32.5],[-71.4,-28.8],[-70.4,-23.5],[-70.2,-18.3],[-75,-15.4],[-77,-12.2],[-79.3,-7.5],[-81.2,-5.2],[-80.3,-3.4],[-80.9,-1],[-80,0.9],[-78.9,1.6],[-77.4,4],[-77.4,6.6]],
  greenland: [[-73,78],[-66,80.5],[-60,82],[-45,82.8],[-30,83.5],[-20,82],[-18,80],[-19,76],[-22,72],[-22,70],[-26,68.5],[-32,68],[-36,65.7],[-40,64.5],[-43,60],[-46,60.8],[-50,62.5],[-51,64.5],[-53.5,66.7],[-51,69],[-54,70.7],[-56,74],[-60,76],[-68,76.5]],
  baffin: [[-62,66],[-68,71],[-78,72.5],[-90,73],[-84,69.5],[-77,67],[-73,64.5],[-65,62]],
  newfoundland: [[-59.3,47.6],[-55.4,51.6],[-53,48.5],[-52.7,47.0],[-55.8,46.9]],
  cuba: [[-84.9,21.9],[-82,23.2],[-77,22],[-74.2,20.2],[-77.7,19.9],[-80.5,21.8],[-84,21.6]],
  hispaniola: [[-74.4,18.4],[-72.8,19.9],[-69.9,19.6],[-68.4,18.6],[-71.4,17.6]],
  australia: [[113.5,-22],[114,-26.3],[115,-30],[115,-33.6],[117.9,-35.1],[123.5,-33.9],[126,-32.3],[131,-31.5],[134.2,-32.5],[135.8,-34.8],[138,-34.3],[137.8,-35.6],[139.6,-37.5],[143.5,-38.8],[146.3,-39],[150,-37.5],[151.3,-33.8],[153.1,-30.5],[153.6,-28],[153,-25.3],[150.5,-22.5],[148.7,-20.3],[146.3,-19],[145.4,-16],[145.3,-14.9],[143.5,-12.6],[142.5,-10.7],[141.6,-12.9],[141.5,-15.5],[140.7,-17.5],[139.3,-17.4],[136.7,-15.9],[135.4,-14.8],[136.9,-12.3],[132.6,-11.5],[131,-12.2],[129.4,-14.9],[127.8,-14.3],[125.2,-15.5],[122.2,-17.3],[121.1,-19.5],[117.5,-20.7],[114.6,-21.8]],
  iceland: [[-22.5,64.0],[-24,65.5],[-22,66.4],[-16,66.5],[-14,65.5],[-14.6,64.3],[-18.5,63.4],[-21,63.8]],
  honshu: [[130,31.3],[131.7,31.5],[132,33.8],[135,33.6],[136.8,34.5],[139.8,35],[140.9,36.9],[141.5,39.5],[141.4,41.4],[140,40.8],[139.7,38],[137.3,36.8],[136.0,35.7],[133,35.6],[131,34.4],[129.8,33.2]],
  hokkaido: [[140,41.5],[141.5,42.5],[143.2,42],[145.5,43.3],[144,44.1],[142,45.4],[141.6,43.5]],
  madagascar: [[44.0,-25],[47.1,-24.9],[49.4,-17],[50.4,-15.5],[49.3,-12],[48,-13.5],[44.4,-16.2],[43.3,-21.5]],
  nzNorth: [[172.7,-34.5],[174.3,-35.5],[175.8,-37],[178.5,-37.7],[177,-39.5],[175.2,-41.6],[174.6,-39.8],[173.8,-39.1],[174.5,-37]],
  nzSouth: [[172.7,-40.5],[174.3,-41.5],[173,-43.8],[171,-45.9],[169,-46.6],[166.5,-46],[168.3,-44],[171,-42]],
  borneo: [[109,1.5],[109.6,-1],[110.2,-2.9],[114.5,-3.5],[116.5,-2.5],[116,1],[117.9,1.8],[119,5.2],[117.2,7],[115.5,5],[113,3.1],[111,1.7]],
  sumatra: [[95.3,5.6],[97.5,5.2],[100.5,2],[104.0,-1],[106,-3.2],[105.8,-5.8],[104.5,-5.8],[102,-3.5],[100.3,-0.8],[98.6,1.8]],
  java: [[105.3,-6.8],[108,-6.3],[111,-6.4],[114.5,-7.7],[112,-8.4],[108,-7.7]],
  newGuinea: [[131,-1.3],[134.5,-1],[138,-1.6],[141,-2.6],[145,-4.4],[147.5,-6],[147.6,-8],[150,-10.5],[146,-8.2],[143.5,-9],[141,-9.1],[138.5,-8.4],[137.6,-5.5],[135,-4.4],[132.5,-3.5]],
  sriLanka: [[79.9,6.0],[81.8,7.5],[80.2,9.8],[79.8,8.0]],
  luzon: [[120.6,18.5],[122.3,18.3],[122,16],[124,13],[121,13.8],[120.1,16]],
  sicily: [[12.4,38.1],[15.6,38.3],[15.1,36.7],[12.5,37.6]],
  sardinia: [[8.4,39],[9.6,39.2],[9.8,41],[9.2,41.2],[8.2,40.9]],
  corsica: [[8.6,41.4],[9.4,41.4],[9.5,43],[8.6,42.4]],
  crete: [[23.5,35.3],[26.3,35.3],[26.0,35.0],[24,35.0]],
  cyprus: [[32.3,34.7],[34.6,35.6],[33.9,35.1],[33.0,34.6]],
  zealand: [[11.0,55.3],[12.6,55.6],[12.3,56.1],[11.0,55.9]],
};
const LAKES = { caspian: [[46.8,44.6],[47.5,45.6],[49.2,46.5],[51,47],[53,46.8],[53,45.2],[51.3,44.5],[50.3,44.4],[51.4,43.1],[52.7,41.8],[53.9,40.7],[53.0,39.2],[54,37.4],[51.0,36.7],[49.0,37.6],[49.2,40.0],[48.0,42.0],[47.5,43.0]] };
// Today's borders (approximate, for a faint reference layer only).
const BORDERS = {
  uk: [[[-3.05,54.98],[-2.6,55.15],[-2.2,55.45],[-2.03,55.8]], [[-3.05,53.25],[-2.95,52.6],[-3.1,52.1],[-2.7,51.6]], [[-7.25,55.05],[-7.55,54.75],[-8.15,54.45],[-7.6,54.15],[-7.0,54.4],[-6.3,54.1]]],
};

export const REGIONS = {
  uk: { lon: [-11, 2.5], lat: [49.6, 61] },
  europe: { lon: [-12, 42], lat: [34, 66] },
  mediterranean: { lon: [-10, 38], lat: [29, 47.5] },
  world: { lon: [-180, 180], lat: [-58, 80] },
};
/** Real places, [lon, lat]. Routes that must start and end at real places look names up here. */
export const PLACES = {
  London: [-0.13, 51.51], Canterbury: [1.08, 51.28], Dover: [1.31, 51.13], Richborough: [1.33, 51.29], Colchester: [0.9, 51.89],
  York: [-1.08, 53.96], Lindisfarne: [-1.8, 55.67], Edinburgh: [-3.19, 55.95], Cardiff: [-3.18, 51.48], Belfast: [-5.93, 54.6],
  Dublin: [-6.26, 53.35], Bath: [-2.36, 51.38], Winchester: [-1.31, 51.06], 'Sutton Hoo': [1.34, 52.09], Hastings: [0.59, 50.86],
  Boulogne: [1.61, 50.73], Calais: [1.86, 50.95], Paris: [2.35, 48.86], Rome: [12.5, 41.9], Athens: [23.73, 37.98], Sparta: [22.43, 37.07],
  Alexandria: [29.92, 31.2], Cairo: [31.24, 30.04], Giza: [31.13, 29.98], Carthage: [10.32, 36.85], Constantinople: [28.98, 41.01],
  Jerusalem: [35.21, 31.77], Troy: [26.24, 39.96], Byzantium: [28.98, 41.01], Marseille: [5.37, 43.3],
  Angeln: [9.7, 54.65], Jutland: [9.2, 56.2], Saxony: [8.6, 53.2], Frisia: [6.2, 53.3], Denmark: [9.5, 56.0], Norway: [6.5, 60.5],
  Normandy: [-0.4, 49.2], Scandinavia: [15.0, 62.0],
  Palos: [-6.89, 37.23], 'San Salvador': [-74.5, 24.05], 'Canary Islands': [-15.4, 28.1], 'Cape Canaveral': [-80.6, 28.4],
  'Pacific splashdown': [-169.2, 13.3], Plymouth: [-4.14, 50.37], 'New York': [-74.0, 40.71], Lisbon: [-9.14, 38.72],
  Delhi: [77.2, 28.61], Mumbai: [72.88, 19.08], Beijing: [116.4, 39.9], Sydney: [151.2, -33.87], 'Cape Town': [18.42, -33.92],
  Lagos: [3.38, 6.52], Nairobi: [36.82, -1.29], 'Rio de Janeiro': [-43.2, -22.9], Mecca: [39.83, 21.42], Baghdad: [44.36, 33.31],
  Babylon: [44.42, 32.54], Ur: [46.1, 30.96], Benin: [5.63, 6.34], Tenochtitlan: [-99.13, 19.43], Cusco: [-71.97, -13.53],
};
export const placeOf = name => PLACES[name] || Object.entries(PLACES).find(([k]) => k.toLowerCase() === String(name || '').trim().toLowerCase())?.[1] || gazPlace(name); // libdata: gazetteer fallback

/* ------------------------------------------------------------------ basemap */
export function basemap(p, region, o = {}) {
  const box = o.box || { x: GRID.left, y: GRID.top, w: GRID.right - GRID.left, h: GRID.bottom - GRID.top };
  const g = h('g', o.a || {}, p); const id = 'gmap' + (++UID);
  if (region === 'school' || region === 'classroom') return plan(g, region, box, id, o);
  const V = o.view || REGIONS[region] || REGIONS.world;
  const [w0, e0] = V.lon, [s0, n0] = V.lat; const lat0 = (s0 + n0) / 2;
  const kx = region === 'world' && !o.view ? 1 : Math.cos(lat0 * Math.PI / 180);
  const W0 = (e0 - w0) * kx, H0 = n0 - s0;
  const k = o.cover ? Math.max(box.w / W0, box.h / H0) : Math.min(box.w / W0, box.h / H0);
  const fw = o.cover ? box.w : W0 * k, fh = o.cover ? box.h : H0 * k;
  const frame = { x: box.x + (box.w - fw) / 2, y: box.y + (box.h - fh) / 2, w: fw, h: fh };
  const ox = box.x + (box.w - W0 * k) / 2, oy = box.y + (box.h - H0 * k) / 2;
  const proj = (lon, lat) => [ox + (lon - w0) * kx * k, oy + (n0 - lat) * k];
  const cp = h('clipPath', { id: id + '-f' }, h('defs', {}, g)); h('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h }, cp);
  const inner = h('g', { 'clip-path': `url(#${id}-f)` }, g);
  if (o.sea !== false) h('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h, fill: 'var(--sky-top)' }, inner);
  const landD = (o.schematic ? Object.values(LAND) : landRings({ lon: [w0 - 5, e0 + 5], lat: [s0 - 5, n0 + 5] })).map(poly => P2(poly.map(q => proj(q[0], q[1])))).join(' '); // libdata: real land (Natural Earth)
  const land = h('path', { d: landD, 'fill-rule': 'evenodd', fill: 'var(--paper)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', 'stroke-linejoin': 'round' }, inner);
  h('path', { d: Object.values(LAKES).map(poly => P2(poly.map(q => proj(q[0], q[1])))).join(' '), fill: 'var(--sky-top)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, inner);
  if (o.graticule) {
    const step = W0 * k / kx / (e0 - w0) > 20 ? 10 : 30; let d = '';
    for (let lo = Math.ceil(w0 / step) * step; lo <= e0; lo += step) { const [x] = proj(lo, 0); d += `M${x.toFixed(1)} ${frame.y} V${frame.y + frame.h} `; }
    for (let la = Math.ceil(s0 / step) * step; la <= n0; la += step) { const [, y] = proj(0, la); d += `M${frame.x} ${y.toFixed(1)} H${frame.x + frame.w} `; }
    h('path', { d, fill: 'none', stroke: 'var(--grid-line)', 'stroke-width': 'var(--sw-hair)' }, inner);
  }
  h('rect', { x: frame.x, y: frame.y, width: frame.w, height: frame.h, fill: 'none', stroke: 'var(--rule)', 'stroke-width': 'var(--sw-rule)', rx: 'var(--r-mark)' }, g);
  const lc = h('clipPath', { id: id + '-land' }, h('defs', {}, g)); h('path', { d: landD, 'clip-rule': 'evenodd' }, lc);
  const kmPerUnit = 111.32 / k; // 1 degree of latitude is about 111 km: exact along meridians and the standard parallel only, so a world map's bar is labelled for the equator by the caller
  return { g, inner, land, frame, proj, kmPerUnit, region, landClip: `url(#${id}-land)`, at: name => { const q = placeOf(name); return q ? proj(q[0], q[1]) : null; } };
}

// Plans (bird's-eye): a generic school site or a classroom, drawn flat in the frame.
function plan(g, kind, box, id, o) {
  const frame = { x: box.x, y: box.y, w: box.w, h: box.h };
  const proj = (fx, fy) => [frame.x + fx * frame.w, frame.y + fy * frame.h];
  const R = (fx, fy, fw, fh) => { const [x, y] = proj(fx, fy); const w = fw * frame.w, hh = fh * frame.h; return { x, y, w, h: hh, cx: x + w / 2, cy: y + hh / 2 }; };
  const rect = (b, a) => h('rect', Object.assign({ x: b.x, y: b.y, width: b.w, height: b.h }, a), g);
  const F = {};
  if (kind === 'school') {
    rect(frame, { fill: 'var(--hill-far)', rx: 'var(--r-card)' });
    F.field = R(.56, .05, .40, .52); rect(F.field, { fill: 'var(--hill-mid)', rx: 'var(--r-mark)' });
    for (let i = 1; i < 5; i++) { const x = F.field.x + F.field.w * i / 5; h('rect', { x: x - F.field.w / 10, y: F.field.y, width: F.field.w / 10, height: F.field.h, fill: 'var(--hill-near)', opacity: .35 }, g); }
    F.building = R(.05, .07, .36, .32); rect(F.building, { fill: 'var(--tile)', cls: 'body' });
    h('rect', { x: F.building.x, y: F.building.cy, width: F.building.w, height: F.building.h / 2, fill: 'var(--tile-shade)' }, g);
    F.hall = R(.30, .39, .11, .12); rect(F.hall, { fill: 'var(--tile)', cls: 'body' });
    F.garden = R(.44, .07, .09, .18); rect(F.garden, { fill: 'var(--soil)', rx: 'var(--r-mark)' });
    for (let i = 0; i < 4; i++) h('line', { x1: F.garden.x + 6, x2: F.garden.x + F.garden.w - 6, y1: F.garden.y + F.garden.h * (i + .5) / 4, y2: F.garden.y + F.garden.h * (i + .5) / 4, stroke: 'var(--life)', 'stroke-width': 'var(--sw-arrow)', 'stroke-linecap': 'round' }, g);
    F.playground = R(.05, .55, .44, .37); rect(F.playground, { fill: 'var(--road)', rx: 'var(--r-mark)' });
    const pc = F.playground; h('circle', { cx: pc.x + pc.w * .3, cy: pc.cy, r: Math.min(pc.w, pc.h) * .22, fill: 'none', stroke: 'var(--road-line)', 'stroke-width': 'var(--sw-struct)' }, g);
    for (let i = 0; i < 4; i++) h('rect', { x: pc.x + pc.w * .68, y: pc.y + pc.h * (.12 + i * .19), width: pc.w * .14, height: pc.h * .16, fill: 'none', stroke: 'var(--road-line)', 'stroke-width': 'var(--sw-rule)' }, g);
    F.carpark = R(.58, .66, .38, .28); rect(F.carpark, { fill: 'var(--road)', rx: 'var(--r-mark)' });
    for (let i = 1; i < 6; i++) h('line', { x1: F.carpark.x + F.carpark.w * i / 6, x2: F.carpark.x + F.carpark.w * i / 6, y1: F.carpark.y, y2: F.carpark.y + F.carpark.h * .4, stroke: 'var(--road-line)', 'stroke-width': 'var(--sw-rule)' }, g);
    F.gate = R(.505, .94, .06, .06);
    const pth = [proj(.535, 1), proj(.535, .60), proj(.36, .60), proj(.36, .51)];
    h('path', { d: P2(pth, false), fill: 'none', stroke: 'var(--sand)', 'stroke-width': frame.w * .028, 'stroke-linejoin': 'round' }, g);
    F.path = R(.36, .51, .18, .49);
    h('rect', { x: F.gate.x, y: frame.y + frame.h - 8, width: F.gate.w, height: 8, fill: 'var(--hull)' }, g);
    const r = rng(7); for (let i = 0; i < 6; i++) { const [x, y] = proj(.55 + i * .08, .015 + r() * .02); h('circle', { cx: x, cy: y + 8, r: frame.w * .016, fill: 'var(--canopy)', cls: 'body' }, g); }
    for (let i = 0; i < 3; i++) { const [x, y] = proj(.025, .6 + i * .12); h('circle', { cx: x, cy: y, r: frame.w * .014, fill: 'var(--canopy)', cls: 'body' }, g); }
  } else {
    rect(frame, { fill: 'var(--wall-bot)', stroke: 'var(--ink-2)', 'stroke-width': 'calc(var(--sw-struct) * 2)' });
    F.board = R(.3, 0, .4, .035); rect(F.board, { fill: 'var(--hob)' });
    F.door = R(0, .78, .018, .16); rect(F.door, { fill: 'var(--wall-bot)' }); h('path', { d: `M${F.door.x} ${F.door.y} A${F.door.h} ${F.door.h} 0 0 1 ${F.door.x + F.door.h} ${F.door.y + F.door.h}`, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)', 'stroke-dasharray': '6 6' }, g);
    F.windows = R(.982, .12, .018, .66); for (let i = 0; i < 3; i++) h('rect', { x: F.windows.x, y: F.windows.y + F.windows.h * i / 3 + 6, width: F.windows.w, height: F.windows.h / 3 - 12, fill: 'var(--sky-top)' }, g);
    F.desk = R(.08, .08, .16, .1); rect(F.desk, { fill: 'var(--bench-front)', rx: 'var(--r-mark)', cls: 'body' });
    F.carpet = R(.06, .3, .26, .4); rect(F.carpet, { fill: 'var(--compare-pale)', rx: 'var(--r-card)' });
    F.sink = R(.82, .9, .12, .1); rect(F.sink, { fill: 'var(--metal)', cls: 'body' });
    F.tables = [];
    for (let r0 = 0; r0 < 2; r0++) for (let c = 0; c < 3; c++) {
      const t = R(.4 + c * .19, .26 + r0 * .32, .13, .16); F.tables.push(t); F['table' + (F.tables.length)] = t;
      rect(t, { fill: 'var(--bench-top)', rx: 'var(--r-mark)', cls: 'body' });
      for (const [dx, dy] of [[.2, -.22], [.6, -.22], [.2, 1.02], [.6, 1.02]]) h('rect', { x: t.x + t.w * dx, y: t.y + t.h * dy, width: t.w * .2, height: t.h * .2, rx: 3, fill: 'var(--cloth-1)' }, g);
    }
  }
  return { g, frame, proj, features: F, region: kind, landClip: null, at: name => F[name] ? [F[name].cx, F[name].cy] : null };
}

/** Faint dashed modern borders, for "today's borders" reference builds. */
export function todayBorders(p, map, o = {}) {
  const g = h('g', o.a || {}, map.inner || p);
  for (const line of BORDERS.uk) h('path', { d: P2(line.map(q => map.proj(q[0], q[1])), false), fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': '6 6' }, g);
  return g;
}

/* ------------------------------------------------------------------ compass, grid, scale */
export function compassRose(p, x, y, o = {}) {
  const r = o.r || 56, n = o.points === 8 ? 8 : 4, rot = (o.north || 0) * Math.PI / 180;
  const L = Object.assign({ N: 'N', E: 'E', S: 'S', W: 'W' }, o.labels || {}), E = o.edit || {};
  const g = h('g', o.a || {}, p); const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const ang = i => rot + i * Math.PI / 4 - Math.PI / 2; // N up when rot = 0
  h('circle', { cx: x, cy: y, r: r * .62, fill: 'var(--paper)', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-hair)' }, g);
  for (const main of [false, true]) for (let i = main ? 0 : 1; i < 8; i += 2) {
    if (!main && n === 4) continue;
    const a = ang(i), len = main ? r : r * .6, wd = main ? r * .2 : r * .14;
    const tip = [x + Math.cos(a) * len, y + Math.sin(a) * len], l = [x + Math.cos(a - Math.PI / 2) * wd, y + Math.sin(a - Math.PI / 2) * wd], rr = [x + Math.cos(a + Math.PI / 2) * wd, y + Math.sin(a + Math.PI / 2) * wd];
    const dark = i === 0 ? 'var(--event)' : main ? 'var(--ink)' : 'var(--ink-3)';
    h('path', { d: P2([[x, y], l, tip]), fill: dark }, g); h('path', { d: P2([[x, y], rr, tip]), fill: 'var(--paper)', stroke: dark, 'stroke-width': 'var(--sw-hair)', 'stroke-linejoin': 'round' }, g);
  }
  for (const [i, k] of [[0, 'N'], [2, 'E'], [4, 'S'], [6, 'W']]) {
    const a = ang(i), d = r + 26; const t = T(g, x + Math.cos(a) * d, y + Math.sin(a) * d + 10, L[k], 'ts-label halo', { 'text-anchor': 'middle', cls: k === 'N' ? 'strong' : null });
    editable(t, E[k]);
  }
  const R2 = r + 48; return { g, box: { x: x - R2, y: y - R2, w: R2 * 2, h: R2 * 2 }, dir: name => ang(names.indexOf(name)) };
}

export function gridRefs(p, box, cols, rows, o = {}) {
  const g = h('g', o.a || {}, p); const e0 = o.e0 || 0, n0 = o.n0 || 0, dg = o.digits || 2;
  const cw = box.w / cols, ch = box.h / rows; const warnings = [];
  const x = e => box.x + (e - e0) * cw, y = n => box.y + box.h - (n - n0) * ch;
  const num = v => String(v).padStart(dg, '0');
  const ln = { stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-rule)' };
  if (o.tenths) for (let i = 0; i < cols * 10; i++) if (i % 10) { const xx = box.x + i * cw / 10; h('line', Object.assign({ x1: xx, x2: xx, y1: box.y + box.h, y2: box.y + box.h - 8 }, ln, { 'stroke-width': 'var(--sw-hair)' }), g); }
  if (o.tenths) for (let i = 0; i < rows * 10; i++) if (i % 10) { const yy = box.y + i * ch / 10; h('line', Object.assign({ x1: box.x, x2: box.x + 8, y1: yy, y2: yy }, ln, { 'stroke-width': 'var(--sw-hair)' }), g); }
  for (let i = 0; i <= cols; i++) h('line', Object.assign({ x1: box.x + i * cw, x2: box.x + i * cw, y1: box.y, y2: box.y + box.h }, ln), g);
  for (let j = 0; j <= rows; j++) h('line', Object.assign({ x1: box.x, x2: box.x + box.w, y1: box.y + j * ch, y2: box.y + j * ch }, ln), g);
  const lw = measure(g, '00'.padStart(dg, '0'), 'ts-axis'); let every = 1; while (cw * every < lw + 28) every++;
  if (every > 1) warnings.push(`grid columns are narrow: easting numbers show every ${every}`);
  for (let i = 0; i <= cols; i += every) computed(T(g, x(e0 + i), box.y + box.h + 32, num(e0 + i), 'ts-axis', { 'text-anchor': 'middle' }), o.computedPath);
  let everyN = 1; while (ch * everyN < 22 + 12) everyN++;
  for (let j = 0; j <= rows; j += everyN) computed(T(g, box.x - 12, y(n0 + j) + 8, num(n0 + j), 'ts-axis', { 'text-anchor': 'end' }), o.computedPath);
  return {
    g, cw, ch, x, y, warnings,
    cell: (e, n) => ({ x: x(e), y: y(n + 1), w: cw, h: ch, cx: x(e) + cw / 2, cy: y(n) - ch / 2 }),
    ref4: (e, n) => num(e) + num(n),
    ref6: (e, n) => num(Math.floor(e)) + Math.round((e % 1) * 10) % 10 + num(Math.floor(n)) + Math.round((n % 1) * 10) % 10,
  };
}

/** Scale bar: `km` long on the drawn map (map.kmPerUnit), or `units` per slide unit for plans (o.perUnit). */
export function scaleBar(p, x, y, o = {}) {
  const per = o.map && o.map.kmPerUnit ? o.map.kmPerUnit : (o.perUnit || 1); const w = (o.km || 100) / per;
  const g = h('g', o.a || {}, p);
  h('rect', { x, y: y - 8, width: w / 2, height: 8, fill: 'var(--ink)' }, g); h('rect', { x: x + w / 2, y: y - 8, width: w / 2, height: 8, fill: 'var(--paper)', stroke: 'var(--ink)', 'stroke-width': 'var(--sw-hair)' }, g);
  const lab = o.label || `${o.km || 100} ${o.units || 'km'}`; const lw = measure(g, lab, 'ts-axis');
  if (w >= lw + 48) { computed(T(g, x, y + 30, '0', 'ts-axis halo', { 'text-anchor': 'middle' }), o.computedPath); computed(T(g, x + w, y + 30, lab, 'ts-axis halo', { 'text-anchor': 'middle' }), o.computedPath); }
  else computed(T(g, x + w + 12, y + 2, lab, 'ts-axis halo', { 'text-anchor': 'start' }), o.computedPath); // a short bar: the length reads after it
  return { g, w };
}

/* ------------------------------------------------------------------ route, territory, pin */
export function route(p, pts, o = {}) {
  const col = o.col || 'var(--focus)', head = o.head || 16; const g = h('g', o.a || {}, p);
  const n = pts.length; const [xa, ya] = pts[n - 2], [xb, yb] = pts[n - 1]; const ang = Math.atan2(yb - ya, xb - xa);
  const end = [xb - Math.cos(ang) * head * .72, yb - Math.sin(ang) * head * .72]; const P = pts.slice(0, -1).concat([end]);
  let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`;
  if (o.smooth === false || P.length === 2) for (let i = 1; i < P.length; i++) d += ` L${P[i][0].toFixed(1)} ${P[i][1].toFixed(1)}`;
  else for (let i = 1; i < P.length - 1; i++) { const last = i === P.length - 2; const mx = last ? P[i + 1][0] : (P[i][0] + P[i + 1][0]) / 2, my = last ? P[i + 1][1] : (P[i][1] + P[i + 1][1]) / 2; d += ` Q${P[i][0].toFixed(1)} ${P[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`; }
  const a = { d, fill: 'none', stroke: col, 'stroke-width': o.w || 'var(--sw-data)', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  if (o.dash) Object.assign(a, { 'stroke-dasharray': o.dash, s: o.s, delay: o.delay });
  else if (o.s != null) Object.assign(a, { cls: 'draw', pathLength: 1, s: o.s, delay: o.delay || 0 });
  const path = h('path', a, g);
  if (o.stops) for (const q of pts.slice(1, -1)) h('circle', { cx: q[0], cy: q[1], r: 6, fill: 'var(--paper)', stroke: col, 'stroke-width': 'var(--sw-struct)', s: o.s, delay: o.s != null ? (o.delay || 0) + 900 : null }, g);
  h('circle', { cx: pts[0][0], cy: pts[0][1], r: 7, fill: col, s: o.s, delay: o.delay }, g);
  h('path', { d: headD(xb, yb, ang, head), fill: col, s: o.s, delay: o.s != null ? (o.delay || 0) + 1300 : null }, g);
  return { g, d, path };
}

export function territory(p, poly, era = 1, o = {}) {
  const e = clamp(Math.round(era), 1, 6); const g = h('g', o.a || {}, p); const inner = h('g', o.clip ? { 'clip-path': o.clip } : {}, g);
  const d = P2(poly);
  h('path', { d, fill: `var(--era-${e})`, 'fill-opacity': o.hatch ? .45 : .85, stroke: 'none' }, inner);
  if (o.hatch) {
    const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const id = 'gter' + (++UID); const cp = h('clipPath', { id }, h('defs', {}, g)); h('path', { d }, cp); let hd = '';
    for (let x = x0 - (y1 - y0); x < x1; x += 14) hd += `M${x.toFixed(1)} ${y1.toFixed(1)} L${(x + (y1 - y0)).toFixed(1)} ${y0.toFixed(1)} `;
    h('path', { d: hd, stroke: `var(--era-${e}-text)`, 'stroke-width': 'var(--sw-hair)', fill: 'none', 'clip-path': `url(#${id})` }, inner);
  }
  h('path', { d, fill: 'none', stroke: `var(--era-${e}-text)`, 'stroke-width': 'var(--sw-rule)', 'stroke-dasharray': o.hatch ? '8 6' : null, 'stroke-linejoin': 'round' }, inner);
  const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]);
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  return { g, box, centre: [box.x + box.w / 2, box.y + box.h / 2] };
}

export function pin(p, x, y, label, o = {}) {
  const g = h('g', o.a || {}, p); const anchor = o.anchor || 'start'; const dx = o.dx ?? (anchor === 'end' ? -16 : anchor === 'middle' ? 0 : 16), dy = o.dy ?? (anchor === 'middle' ? -22 : 9);
  let box = null;
  if (label) {
    const w = measure(g, label, 'ts-small'); const tx = x + dx; const x0 = anchor === 'end' ? tx - w : anchor === 'middle' ? tx - w / 2 : tx;
    box = { x: x0 - 8, y: y + dy - 24, w: w + 16, h: 34 };
    labelGround(g, box);
    editable(T(g, tx, y + dy, label, 'ts-small', { 'text-anchor': anchor, fill: 'var(--ink)' }), o.edit);
  }
  h('circle', { cx: x, cy: y, r: o.r || 7, fill: o.col || 'var(--event)', stroke: 'var(--paper)', 'stroke-width': 'var(--sw-rule)' }, g);
  return { g, box };
}

/* ------------------------------------------------------------------ people */
export const SKINS = ['var(--person-1)', 'color-mix(in oklab,var(--person-1) 50%,var(--person-2))', 'var(--person-2)'];
export const HAIR_COLS = ['var(--hull)', 'var(--ink-2)', 'var(--seedhead)', 'var(--trunk)'];
const HAIRS = ['short', 'long', 'bun', 'short', 'long'];
/** A mixed, deterministic cast: tone, hair style and colour vary person to person. */
export const look = i => ({ skin: SKINS[(i * 2 + 1) % 3], hair: HAIRS[i % HAIRS.length], hairCol: HAIR_COLS[(i * 3) % HAIR_COLS.length] });
export const ROLES = {
  firefighter: { name: 'firefighter', props: ['helmet', 'reflective bands'], vehicle: 'fire_engine', place: 'street' },
  nurse: { name: 'nurse', props: ['tunic', 'fob watch'], vehicle: 'ambulance', place: 'hospital' },
  doctor: { name: 'doctor', props: ['white coat', 'stethoscope'], vehicle: null, place: 'hospital' },
  police: { name: 'police officer', props: ['cap', 'hi-vis vest'], vehicle: 'police_car', place: 'street' },
  postal: { name: 'postal worker', props: ['post bag'], vehicle: 'post_van', place: 'street' },
  lollipop: { name: 'lollipop person', props: ['lollipop sign', 'hi-vis coat'], vehicle: null, place: 'school' },
  teacher: { name: 'teacher', props: ['book', 'lanyard'], vehicle: null, place: 'school' },
  refuse: { name: 'refuse collector', props: ['hi-vis', 'wheelie bin'], vehicle: 'bin_lorry', place: 'street' },
  vet: { name: 'vet', props: ['scrubs', 'stethoscope', 'pet'], vehicle: null, place: 'street' },
  person: { name: 'person', props: [], vehicle: null, place: 'street' },
};
/** Emergency numbers by locale (ISO country code). */
export const EMERGENCY = { GB: '999', IE: '112', IN: '112', US: '911', CA: '911', AU: '000', NZ: '111', ZA: '112', EU: '112' };

function hairOn(g, style, col) {
  if (style === 'none') return;
  if (style === 'long') { h('rect', { x: -12, y: -70, width: 6, height: 22, rx: 3, fill: col }, g); h('rect', { x: 6, y: -70, width: 6, height: 22, rx: 3, fill: col }, g); }
  h('path', { d: 'M-10.5 -66 A10.5 10.5 0 0 1 10.5 -66 Q0 -71 -10.5 -66 Z', fill: col }, g);
  if (style === 'bun') h('circle', { cx: 0, cy: -78, r: 5, fill: col }, g);
}
const steth = g => { h('path', { d: 'M-7 -56 Q-9 -42 -1 -38 M7 -56 Q9 -46 4 -42', fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 2, 'stroke-linecap': 'round' }, g); h('circle', { cx: 3, cy: -39, r: 3.5, fill: 'var(--metal)', stroke: 'var(--ink-2)', 'stroke-width': 1.5 }, g); };
const CLOTH = { firefighter: 'var(--hob)', nurse: 'var(--water)', doctor: 'var(--cloud)', police: 'var(--hob)', postal: 'var(--heat)', lollipop: 'var(--sun)', teacher: 'var(--cloth-2)', refuse: 'var(--fox)', vet: 'var(--compare)', person: 'var(--cloth-1)' };

export function figure(p, role, x, y, s = 1, o = {}) {
  const outer = h('g', o.a || {}, p); const g = h('g', { transform: `translate(${x} ${y}) scale(${s})` }, outer);
  const skin = o.skin || SKINS[0], hc = o.hairCol || HAIR_COLS[0], hair = o.hair || 'short';
  const cl = CLOTH[role] || CLOTH.person;
  // the kit person: two legs, a rounded body, a head
  h('rect', { x: -9, y: -26, width: 7, height: 26, rx: 3, fill: 'var(--ink-2)' }, g); h('rect', { x: 2, y: -26, width: 7, height: 26, rx: 3, fill: 'var(--ink-2)' }, g);
  if (role === 'lollipop') h('rect', { x: -14, y: -56, width: 28, height: 44, rx: 9, fill: cl, cls: 'body' }, g);
  else h('rect', { x: -13, y: -56, width: 26, height: 34, rx: 9, fill: cl, cls: 'body', stroke: role === 'doctor' ? 'var(--ink-3)' : null, 'stroke-width': role === 'doctor' ? 1.5 : null }, g);
  h('circle', { cx: 0, cy: -66, r: 10, fill: skin, cls: 'body' }, g);
  const hatted = role === 'firefighter' || role === 'police' || role === 'lollipop';
  hairOn(g, hatted && hair !== 'long' ? 'none' : hair === 'bun' && hatted ? 'none' : hair, hc);
  const band = (yy, col = 'var(--sun)', x0 = -13, w = 26) => h('rect', { x: x0, y: yy, width: w, height: 4, fill: col }, g);
  switch (role) {
    case 'firefighter':
      band(-46); band(-34);
      h('path', { d: 'M-12 -68 A12 12 0 0 1 12 -68 Z', fill: 'var(--sun)', cls: 'body' }, g); h('rect', { x: -15, y: -70, width: 30, height: 4, rx: 2, fill: 'var(--sun)' }, g);
      break;
    case 'police':
      h('rect', { x: -13, y: -56, width: 26, height: 22, rx: 7, fill: 'var(--sun)' }, g); band(-42, 'var(--cloud)');
      h('rect', { x: -11, y: -82, width: 22, height: 9, rx: 2, fill: 'var(--hob)', cls: 'body' }, g); h('rect', { x: -11, y: -76, width: 22, height: 3, fill: 'var(--cloud)' }, g); h('rect', { x: -12, y: -74, width: 16, height: 3, rx: 1.5, fill: 'var(--hob)' }, g);
      break;
    case 'nurse':
      h('path', { d: 'M-7 -56 L0 -46 L7 -56', fill: 'none', stroke: 'var(--cloud)', 'stroke-width': 2.5 }, g); h('circle', { cx: -6, cy: -40, r: 3, fill: 'var(--cloud)' }, g);
      break;
    case 'doctor':
      h('path', { d: 'M-6 -56 L0 -46 L6 -56 Z', fill: 'var(--cloth-2)' }, g); h('line', { x1: 0, x2: 0, y1: -46, y2: -22, stroke: 'var(--ink-3)', 'stroke-width': 1.5 }, g); steth(g);
      break;
    case 'postal':
      h('line', { x1: -10, y1: -55, x2: 9, y2: -32, stroke: 'var(--hull)', 'stroke-width': 3 }, g); h('rect', { x: 5, y: -38, width: 15, height: 13, rx: 3, fill: 'var(--hull)', cls: 'body' }, g);
      break;
    case 'lollipop':
      band(-30, 'var(--cloud)', -14, 28); band(-22, 'var(--cloud)', -14, 28);
      h('path', { d: 'M-11 -74 A11 11 0 0 1 11 -74 L14 -72 L-11 -72 Z', fill: 'var(--cloud)', cls: 'body' }, g);
      break;
    case 'teacher':
      h('path', { d: 'M-6 -56 L0 -44 L6 -56', fill: 'none', stroke: 'var(--focus)', 'stroke-width': 2 }, g); h('rect', { x: -3, y: -44, width: 6, height: 8, fill: 'var(--cloud)' }, g);
      h('rect', { x: 6, y: -42, width: 14, height: 17, rx: 2, fill: 'var(--focus)', cls: 'body' }, g);
      break;
    case 'refuse':
      band(-46, 'var(--cloud)'); band(-34, 'var(--cloud)');
      h('rect', { x: 18, y: -40, width: 22, height: 38, rx: 2, fill: 'var(--life)', cls: 'body' }, g); h('rect', { x: 16, y: -44, width: 26, height: 5, rx: 2, fill: 'var(--life-shade)' }, g); h('circle', { cx: 22, cy: -2, r: 3, fill: 'var(--hob)' }, g);
      break;
    case 'vet':
      steth(g);
      h('ellipse', { cx: 30, cy: -16, rx: 13, ry: 7, fill: 'var(--rabbit)', cls: 'body' }, g); h('circle', { cx: 42, cy: -22, r: 6, fill: 'var(--rabbit)', cls: 'body' }, g);
      h('path', { d: 'M40 -27 L44 -31 L46 -25 Z', fill: 'var(--rabbit-shade)' }, g); for (const lx of [21, 25, 34, 38]) h('rect', { x: lx, y: -11, width: 3, height: 11, fill: 'var(--rabbit-shade)' }, g);
      h('path', { d: 'M18 -18 Q12 -24 13 -28', fill: 'none', stroke: 'var(--rabbit)', 'stroke-width': 3, 'stroke-linecap': 'round' }, g);
      break;
  }
  if (role === 'lollipop') {
    // the sign is drawn unscaled so its word never drops below the type minimum
    const sx = x + 18 * s, top = y - 46 * s; const word = o.sign || 'STOP';
    const tw = measure(outer, word, 'ts-tiny', { cls: 'strong' }); const r = Math.max(26 * s, tw / 2 + 10);
    h('line', { x1: sx, x2: sx, y1: top, y2: top - 70 * s, stroke: 'var(--ink-2)', 'stroke-width': 'var(--sw-struct)' }, outer);
    h('circle', { cx: sx, cy: top - 70 * s - r, r, fill: 'var(--cloud)', stroke: 'var(--heat)', 'stroke-width': 'calc(var(--sw-struct) * 2)', cls: 'body' }, outer);
    editable(T(outer, sx, top - 70 * s - r + 8, word, 'ts-tiny strong', { 'text-anchor': 'middle', fill: 'var(--shade)' }), o.signEdit);
  }
  return outer;
}

/* ------------------------------------------------------------------ period objects and vehicles */
const wheel = (g, cx, r = 12) => { h('circle', { cx, cy: -r, r, fill: 'var(--hob)' }, g); h('circle', { cx, cy: -r, r: r * .4, fill: 'var(--metal)' }, g); };
const spoked = (g, cx, r, col = 'var(--rabbit-shade)') => { h('circle', { cx, cy: -r, r, fill: 'none', stroke: col, 'stroke-width': 3 }, g); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 4; h('line', { x1: cx - Math.cos(a) * r, x2: cx + Math.cos(a) * r, y1: -r - Math.sin(a) * r, y2: -r + Math.sin(a) * r, stroke: col, 'stroke-width': 1.5 }, g); } };
const win = (g, x, y, w, hh) => h('rect', { x, y, width: w, height: hh, rx: 3, fill: 'var(--sky-top)' }, g);
const checker = (g, x0, x1, y, hh, a = 'var(--sun)', b = 'var(--water)') => { for (let x = x0, i = 0; x < x1; x += 12, i++) h('rect', { x, y, width: Math.min(12, x1 - x), height: hh, fill: i % 2 ? b : a }, g); };
const carBody = (g, col) => { h('path', { d: 'M-58 -14 L-58 -30 Q-56 -34 -48 -35 L-30 -36 L-18 -52 Q-14 -55 -6 -55 L24 -55 Q30 -55 34 -50 L44 -37 L56 -34 Q60 -32 60 -26 L60 -14 Z', fill: col, cls: 'body' }, g); win(g, -14, -50, 18, 13); win(g, 8, -50, 22, 13); };
const OBJ_G = {
  horse_cart(g) {
    h('rect', { x: -78, y: -50, width: 72, height: 24, fill: 'var(--board)', stroke: 'var(--rabbit-shade)', 'stroke-width': 2, cls: 'body' }, g);
    h('line', { x1: -8, y1: -34, x2: 30, y2: -38, stroke: 'var(--rabbit-shade)', 'stroke-width': 3 }, g); spoked(g, -42, 18);
    h('ellipse', { cx: 50, cy: -42, rx: 26, ry: 12, fill: 'var(--rabbit)', cls: 'body' }, g);
    h('path', { d: 'M64 -50 L78 -76 L88 -72 L76 -40 Z', fill: 'var(--rabbit)', cls: 'body' }, g); h('path', { d: 'M76 -78 L88 -76 L100 -60 Q100 -54 94 -54 L82 -64 Z', fill: 'var(--rabbit)', cls: 'body' }, g);
    h('path', { d: 'M78 -78 L80 -86 L84 -77 Z', fill: 'var(--rabbit-shade)' }, g); h('path', { d: 'M66 -52 L77 -74', stroke: 'var(--rabbit-shade)', 'stroke-width': 4 }, g);
    for (const lx of [30, 36, 62, 68]) h('rect', { x: lx, y: -34, width: 5, height: 34, fill: 'var(--rabbit-shade)' }, g);
    h('path', { d: 'M24 -44 Q16 -38 18 -24', fill: 'none', stroke: 'var(--rabbit-shade)', 'stroke-width': 4, 'stroke-linecap': 'round' }, g);
  },
  early_car(g) {
    h('rect', { x: -50, y: -40, width: 96, height: 14, rx: 3, fill: 'var(--board)', cls: 'body' }, g); h('rect', { x: -44, y: -62, width: 34, height: 24, rx: 4, fill: 'var(--rabbit-shade)', cls: 'body' }, g);
    h('rect', { x: 22, y: -54, width: 24, height: 16, rx: 2, fill: 'var(--board)' }, g); h('line', { x1: 10, y1: -40, x2: 4, y2: -60, stroke: 'var(--ink-2)', 'stroke-width': 3 }, g); h('circle', { cx: 4, cy: -60, r: 5, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 2 }, g);
    spoked(g, -32, 16, 'var(--ink-2)'); spoked(g, 32, 16, 'var(--ink-2)');
  },
  car(g) { carBody(g, 'var(--cloth-1)'); wheel(g, -36); wheel(g, 38); },
  police_car(g) { carBody(g, 'var(--cloud)'); checker(g, -58, 60, -28, 7); h('rect', { x: -2, y: -61, width: 16, height: 6, rx: 2, fill: 'var(--water)' }, g); wheel(g, -36); wheel(g, 38); },
  bus(g) { h('rect', { x: -90, y: -76, width: 180, height: 64, rx: 10, fill: 'var(--cloth-3)', cls: 'body' }, g); for (let i = 0; i < 6; i++) win(g, -82 + i * 28, -68, 22, 22); h('rect', { x: 70, y: -68, width: 14, height: 52, rx: 2, fill: 'var(--sky-top)' }, g); wheel(g, -56, 13); wheel(g, 54, 13); },
  fire_engine(g) {
    h('rect', { x: -84, y: -54, width: 124, height: 42, rx: 4, fill: 'var(--heat)', cls: 'body' }, g); h('path', { d: 'M40 -12 L40 -68 L70 -68 Q84 -66 86 -50 L86 -12 Z', fill: 'var(--heat)', cls: 'body' }, g); win(g, 48, -62, 30, 18);
    h('rect', { x: -80, y: -64, width: 112, height: 6, fill: 'var(--metal)' }, g); for (let x = -74; x < 30; x += 14) h('rect', { x, y: -66, width: 3, height: 10, fill: 'var(--metal)' }, g);
    h('rect', { x: 52, y: -74, width: 18, height: 6, rx: 2, fill: 'var(--water)' }, g); h('rect', { x: -84, y: -24, width: 170, height: 5, fill: 'var(--sun)' }, g); wheel(g, -52, 13); wheel(g, 56, 13);
  },
  ambulance(g) {
    h('path', { d: 'M-80 -12 L-80 -74 L40 -74 L40 -64 L64 -64 Q80 -62 84 -44 L84 -12 Z', fill: 'var(--cloud)', stroke: 'var(--ink-3)', 'stroke-width': 1.5, cls: 'body' }, g); win(g, 46, -58, 26, 16);
    checker(g, -80, 84, -36, 10, 'var(--sun)', 'var(--water)'); h('rect', { x: -60, y: -80, width: 20, height: 6, rx: 2, fill: 'var(--water)' }, g); wheel(g, -50, 13); wheel(g, 54, 13);
  },
  post_van(g) { h('path', { d: 'M-70 -12 L-70 -70 L30 -70 Q48 -68 56 -46 L66 -40 L66 -12 Z', fill: 'var(--heat)', cls: 'body' }, g); win(g, 30, -62, 18, 16); wheel(g, -42, 13); wheel(g, 42, 13); },
  bin_lorry(g) {
    h('path', { d: 'M-90 -12 L-90 -76 Q-90 -84 -80 -84 L30 -84 L30 -12 Z', fill: 'var(--metal)', cls: 'body' }, g); h('rect', { x: -90, y: -84, width: 14, height: 72, fill: 'var(--metal-shade)' }, g);
    h('path', { d: 'M34 -12 L34 -70 L64 -70 Q80 -68 84 -50 L84 -12 Z', fill: 'var(--life)', cls: 'body' }, g); win(g, 44, -64, 30, 18); wheel(g, -58, 13); wheel(g, -26, 13); wheel(g, 58, 13);
  },
  gas_lamp(g) {
    h('rect', { x: -3, y: -104, width: 6, height: 104, fill: 'var(--hob)' }, g); h('rect', { x: -9, y: -8, width: 18, height: 8, fill: 'var(--hob)' }, g); h('rect', { x: -16, y: -100, width: 32, height: 4, fill: 'var(--hob)' }, g);
    h('path', { d: 'M-12 -104 L-15 -128 L15 -128 L12 -104 Z', fill: 'var(--sun)', stroke: 'var(--hob)', 'stroke-width': 3 }, g); h('path', { d: 'M-18 -128 L0 -140 L18 -128 Z', fill: 'var(--hob)' }, g);
  },
  street_lamp(g) {
    h('rect', { x: -3, y: -150, width: 6, height: 150, fill: 'var(--metal-shade)' }, g); h('path', { d: 'M0 -146 Q2 -158 20 -156', fill: 'none', stroke: 'var(--metal-shade)', 'stroke-width': 5 }, g);
    h('rect', { x: 14, y: -160, width: 30, height: 8, rx: 3, fill: 'var(--metal-shade)' }, g); h('rect', { x: 17, y: -153, width: 24, height: 4, fill: 'var(--sun)' }, g);
  },
  beach_hut(g) {
    h('rect', { x: -26, y: -58, width: 52, height: 58, fill: 'var(--cloth-2)', cls: 'body' }, g); for (let x = -18; x < 26; x += 8) h('line', { x1: x, x2: x, y1: -58, y2: 0, stroke: 'var(--cloud)', 'stroke-width': 1.5, opacity: .5 }, g);
    h('rect', { x: -10, y: -40, width: 20, height: 40, fill: 'var(--cloud)' }, g); h('polygon', { points: '-32,-56 0,-80 32,-56', fill: 'var(--stone)', cls: 'body' }, g); h('polygon', { points: '0,-80 32,-56 10,-56', fill: 'var(--stone-shade)' }, g);
  },
  bathing_machine(g) {
    h('rect', { x: -28, y: -78, width: 56, height: 56, fill: 'var(--board)', stroke: 'var(--rabbit-shade)', 'stroke-width': 2, cls: 'body' }, g); h('path', { d: 'M-32 -78 Q0 -96 32 -78 Z', fill: 'var(--rabbit-shade)' }, g);
    h('rect', { x: -8, y: -64, width: 16, height: 30, fill: 'var(--hull)' }, g); h('path', { d: 'M28 -22 L40 -10 M32 -16 L42 -16', stroke: 'var(--rabbit-shade)', 'stroke-width': 3 }, g); spoked(g, -16, 11); spoked(g, 16, 11);
  },
  shopfront(g) {
    h('rect', { x: -72, y: -132, width: 144, height: 132, fill: 'var(--daub)', cls: 'body' }, g); h('rect', { x: -72, y: -132, width: 144, height: 30, fill: 'var(--hob)' }, g);
    h('rect', { x: -62, y: -92, width: 76, height: 60, rx: 2, fill: 'var(--sky-top)' }, g); h('rect', { x: 24, y: -84, width: 36, height: 84, fill: 'var(--hull)' }, g);
    h('rect', { x: -66, y: -32, width: 84, height: 6, fill: 'var(--daub-shade)' }, g);
  },
  teddy(g) {
    for (const [cx, cy, r] of [[-12, -42, 7], [12, -42, 7], [0, -30, 13], [-12, -6, 7], [12, -6, 7], [0, -14, 15]]) h('circle', { cx, cy, r, fill: 'var(--rabbit)', cls: 'body' }, g);
    h('circle', { cx: 0, cy: -27, r: 5, fill: 'var(--fur-light)' }, g); h('circle', { cx: 0, cy: -10, r: 7, fill: 'var(--fur-light)' }, g);
  },
  spinning_top(g) { h('path', { d: 'M0 0 L-22 -22 Q-20 -32 0 -34 Q20 -32 22 -22 Z', fill: 'var(--heat)', cls: 'body' }, g); h('rect', { x: -22, y: -26, width: 44, height: 5, fill: 'var(--sun)' }, g); h('rect', { x: -2, y: -46, width: 4, height: 12, fill: 'var(--rabbit-shade)' }, g); },
  hoop(g) { h('circle', { cx: 0, cy: -30, r: 30, fill: 'none', stroke: 'var(--rabbit-shade)', 'stroke-width': 5 }, g); h('line', { x1: 24, y1: -18, x2: 48, y2: -62, stroke: 'var(--rabbit-shade)', 'stroke-width': 4, 'stroke-linecap': 'round' }, g); },
  tablet(g) { h('rect', { x: -30, y: -46, width: 60, height: 44, rx: 5, fill: 'var(--hob)', cls: 'body' }, g); h('rect', { x: -25, y: -41, width: 50, height: 34, rx: 2, fill: 'var(--sky-top)' }, g); },
  smartphone(g) { h('rect', { x: -12, y: -46, width: 24, height: 44, rx: 4, fill: 'var(--hob)', cls: 'body' }, g); h('rect', { x: -9, y: -42, width: 18, height: 34, rx: 2, fill: 'var(--sky-top)' }, g); },
};
/** When each object existed (years, null = still today). Used by periodCheck for truth rules. */
export const PERIODS = {
  horse_cart: { from: -3000, to: 1950, name: 'horse and cart' }, early_car: { from: 1890, to: 1935, name: 'early motor car' },
  car: { from: 1990, to: null, name: 'modern car' }, bus: { from: 1990, to: null, name: 'modern bus' },
  fire_engine: { from: 1970, to: null, name: 'fire engine' }, ambulance: { from: 1990, to: null, name: 'modern ambulance' }, police_car: { from: 1990, to: null, name: 'police car' },
  post_van: { from: 1970, to: null, name: 'post van' }, bin_lorry: { from: 1970, to: null, name: 'bin lorry' },
  gas_lamp: { from: 1810, to: 1960, name: 'gas street lamp' }, street_lamp: { from: 1930, to: null, name: 'electric street lamp' },
  beach_hut: { from: 1900, to: null, name: 'beach hut' }, bathing_machine: { from: 1750, to: 1914, name: 'bathing machine' },
  shopfront: { from: 1700, to: null, name: 'shop' },
  teddy: { from: 1902, to: null, name: 'teddy bear' }, spinning_top: { from: -3000, to: null, name: 'spinning top' }, hoop: { from: -500, to: null, name: 'hoop and stick' },
  tablet: { from: 2010, to: null, name: 'tablet computer' }, smartphone: { from: 2007, to: null, name: 'smartphone' },
};
export const G_OBJECT_CULTURES = {
  horse_cart: ['medieval', 'tudor', 'victorian', 'edwardian'], early_car: ['edwardian'], bathing_machine: ['victorian'], gas_lamp: ['victorian', 'edwardian'],
  car: ['modern'], bus: ['modern'], fire_engine: ['modern'], ambulance: ['modern'], police_car: ['modern'], post_van: ['modern'], bin_lorry: ['modern'],
  street_lamp: ['modern'], tablet: ['modern'], smartphone: ['modern'], beach_hut: ['edwardian', 'modern'], shopfront: ['victorian', 'edwardian', 'modern'],
  teddy: ['edwardian', 'modern'], spinning_top: ['any'], hoop: ['victorian', 'edwardian'],
};
export const OBJECT_TOPICS = {
  horse_cart: ['street', 'transport'], early_car: ['street', 'transport'], car: ['street', 'transport'], bus: ['street', 'transport'],
  fire_engine: ['street', 'helpers'], ambulance: ['street', 'helpers', 'hospital'], police_car: ['street', 'helpers'], post_van: ['street', 'helpers'], bin_lorry: ['street', 'helpers'],
  gas_lamp: ['street', 'lighting'], street_lamp: ['street', 'lighting'], beach_hut: ['seaside'], bathing_machine: ['seaside'], shopfront: ['street', 'shops'],
  teddy: ['toys', 'home'], spinning_top: ['toys'], hoop: ['toys'], tablet: ['toys', 'home'], smartphone: ['home'],
};
export const objectsFor = (year, topic) => Object.keys(PERIODS).filter(k => PERIODS[k].from <= year && (PERIODS[k].to == null || PERIODS[k].to >= year) && (!topic || OBJECT_TOPICS[k].includes(topic)));
/** null if the object fits the year, else a refusal reason in teacher words. */
export function periodCheck(kind, year) {
  const q = PERIODS[kind]; if (!q) return null;
  if (year < q.from) return `A ${q.name} would not be seen in ${year}: they date from about ${q.from}. Pick a later period or another object.`;
  if (q.to != null && year > q.to) return `A ${q.name} would be rare by ${year}: they were mostly gone by about ${q.to}. Pick an earlier period or another object.`;
  return null;
}
/** Batch G objects that fit a culture or period tag, signature first. [] means none: show plain layers. */
export const sceneryForG = culture => (!culture || culture === 'none') ? [] : Object.keys(G_OBJECT_CULTURES).filter(k => G_OBJECT_CULTURES[k].includes(culture) || G_OBJECT_CULTURES[k].includes('any'));

export function periodObject(p, kind, x, y, s = 1, a = {}, o = {}) {
  const outer = h('g', a, p); const g = h('g', { transform: `translate(${x} ${y}) scale(${s})` }, outer); (OBJ_G[kind] || OBJ_G.spinning_top)(g);
  if (kind === 'shopfront' && o.sign) {
    // the sign word is drawn unscaled and shrinks only to fit the band
    const bw = 140 * s; const t = T(outer, x, y - 109 * s, o.sign, 'ts-tiny strong', { 'text-anchor': 'middle', fill: 'var(--bg)' }); editable(t, o.signEdit);
    const w = t.getComputedTextLength(); if (w > bw - 12) t.setAttribute('textLength', bw - 12), t.setAttribute('lengthAdjust', 'spacingAndGlyphs');
  }
  return outer;
}
export const G_OBJECTS = Object.keys(OBJ_G);

/* ------------------------------------------------------------------ family trees */
export function treeLayout(p, nodes, o = {}) {
  const box = o.box || { x: GRID.left, y: GRID.top, w: GRID.right - GRID.left, h: GRID.bottom - GRID.top };
  const cardH = o.cardH || 104, gapX = o.gapX || 28, base = o.editBase || 'people';
  const byId = new Map(nodes.map((n, i) => [n.id, Object.assign({}, n, { i })])); const warnings = [];
  const gen = new Map(nodes.map(n => [n.id, 0]));
  for (let it = 0; it < nodes.length + 2; it++) {
    let changed = false;
    for (const n of nodes) {
      let v = gen.get(n.id);
      for (const q of n.parents || []) if (byId.has(q)) v = Math.max(v, gen.get(q) + 1);
      if (n.partner && byId.has(n.partner)) v = Math.max(v, gen.get(n.partner));
      if (v !== gen.get(n.id)) { gen.set(n.id, v); changed = true; }
    }
    if (!changed) break;
  }
  const G = Math.max(0, ...gen.values()) + 1; const rows = Array.from({ length: G }, () => []);
  const pos = {};
  const vgap = G > 1 ? (box.h - G * cardH) / (G - 1) : 0; if (G > 1 && vgap < 48) warnings.push('family tree: too many generations for the slide height');
  for (let r = 0; r < G; r++) {
    let row = nodes.filter(n => gen.get(n.id) === r);
    const key = n => { const ps = (n.parents || []).filter(q => pos[q]); if (ps.length) return ps.reduce((s, q) => s + pos[q].cx, 0) / ps.length; const pt = n.partner && byId.get(n.partner); const pps = pt ? (pt.parents || []).filter(q => pos[q]) : []; return pps.length ? pps.reduce((s, q) => s + pos[q].cx, 0) / pps.length + .5 : 1e6 + byId.get(n.id).i; };
    // couples are one unit (the member nearer their own parents on the left); units sort by key
    const K = new Map(row.map(n => [n.id, key(n)])); const seen = new Set(), units = [];
    const partnerOf = n => row.find(m => m.id !== n.id && (m.id === n.partner || m.partner === n.id));
    for (const n of row) { if (seen.has(n.id)) continue; const pt = partnerOf(n); seen.add(n.id);
      if (pt && !seen.has(pt.id)) { seen.add(pt.id); const u = K.get(n.id) <= K.get(pt.id) ? [n, pt] : [pt, n]; units.push({ k: (K.get(n.id) + K.get(pt.id)) / 2, u }); } else units.push({ k: K.get(n.id), u: [n] }); }
    const out = units.sort((a, b) => a.k - b.k).flatMap(x => x.u);
    const cw = Math.min(o.cardW || 220, (box.w - (out.length - 1) * gapX) / out.length); if (cw < 130) warnings.push(`family tree: ${out.length} people in one row is too many to read`);
    const tw = out.length * cw + (out.length - 1) * gapX, x0 = box.x + (box.w - tw) / 2, y = box.y + r * (cardH + Math.max(vgap, 0));
    out.forEach((n, j) => { const x = x0 + j * (cw + gapX); pos[n.id] = { x, y, w: cw, h: cardH, cx: x + cw / 2, cy: y + cardH / 2 }; });
    rows[r] = out;
  }
  const g = h('g', o.a || {}, p); const lines = h('g', {}, g); const cardsG = h('g', {}, g);
  const L = (d, a) => h('path', Object.assign({ d, fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 'var(--sw-struct)', 'stroke-linejoin': 'round' }, a), lines);
  const attrs = n => (o.attrs ? o.attrs(n, byId.get(n.id).i) : {}) || {};
  const pairs = new Set();
  for (const n of nodes) if (n.partner && pos[n.partner]) { const k = [n.id, n.partner].sort().join('|'); if (pairs.has(k)) continue; pairs.add(k); const a = pos[n.id], b = pos[n.partner]; const [l, r] = a.x < b.x ? [a, b] : [b, a]; L(`M${l.x + l.w} ${l.cy} H${r.x}`, attrs(n)); }
  const famRow = {};
  const fam = new Map(); for (const n of nodes) { const ps = (n.parents || []).filter(q => pos[q]); if (!ps.length) continue; const k = [...ps].sort().join('|'); if (!fam.has(k)) fam.set(k, { ps, kids: [] }); fam.get(k).kids.push(n); }
  for (const { ps, kids } of fam.values()) {
    const kp = kids.map(k => pos[k.id]); const fi = famRow[kp[0].y] = (famRow[kp[0].y] ?? -1) + 1; const barY = kp[0].y - Math.max(vgap, 24) / 2 + fi * 14; const a = attrs(kids[0]);
    let ax, d = '';
    const P = ps.map(q => pos[q]).sort((u, v) => u.x - v.x);
    if (P.length === 2 && Math.abs(P[1].x - (P[0].x + P[0].w)) <= gapX + 1) { ax = (P[0].x + P[0].w + P[1].x) / 2; d += `M${ax} ${P[0].cy} V${barY} `; }
    else { ax = P.reduce((s, q) => s + q.cx, 0) / P.length; for (const q of P) d += `M${q.cx} ${q.y + q.h} V${barY} `; }
    const xs = kp.map(q => q.cx).concat(P.length === 2 && d.startsWith(`M${ax}`) ? [ax] : P.map(q => q.cx));
    d += `M${Math.min(...xs)} ${barY} H${Math.max(...xs)} `; for (const q of kp) d += `M${q.cx} ${barY} V${q.y} `;
    L(d, a);
  }
  const cards = {};
  for (const n of nodes) {
    const b = pos[n.id], i = byId.get(n.id).i; const cg = h('g', attrs(n), cardsG); const foc = o.focus === n.id;
    h('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: 'var(--r-card)', fill: foc ? 'var(--focus-pale)' : 'var(--paper)', stroke: foc ? 'var(--focus)' : 'var(--rule)', 'stroke-width': foc ? 'var(--sw-struct)' : 'var(--sw-rule)', cls: 'lift body' }, cg);
    // the name wraps to two lines (then shrinks); the note sits under it; the block is centred in the card
    const nm = textBlock(cg, b.cx, 0, n.name || '', { cls: 'ts-label', maxW: b.w - 20, maxLines: 2, lh: 28, anchor: 'middle', edit: `${base}.${i}.name` });
    const top = b.cy - (nm.h + (n.note ? 26 : 0)) / 2; nm.el.setAttribute('y', top + 21);
    if (n.note) textBlock(cg, b.cx, top + nm.h + 19, n.note, { cls: 'ts-tiny', maxW: b.w - 20, maxLines: 1, anchor: 'middle', edit: `${base}.${i}.note` });
    if (nm.h + (n.note ? 26 : 0) > b.h - 12) warnings.push(`family tree: “${n.name}” is too long for its card`);
    cards[n.id] = { box: b, g: cg };
  }
  return { g, cards, rows, warnings };
}
