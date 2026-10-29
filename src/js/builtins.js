// ============================================================ built-in GLSL: transitions, look, duet, fx
// Built-in transitions use the same contract as gl-transitions (from, to, progress, resolution),
// so they run through the exact code path the library's transitions do. They also get the music
// (uAudio, uBass, uKick) so a wipe can breathe with the song.

const TR_PRELUDE = `
uniform sampler2D from; uniform sampler2D to; uniform float progress; uniform vec2 resolution;
uniform sampler2D uAudio; uniform float uBass; uniform float uKick; uniform float uSeed; uniform vec2 uDir;
out vec4 outColor;
vec4 A(vec2 uv){ return texture(from, uv); }
vec4 B(vec2 uv){ return texture(to, uv); }
float h21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+1.),f.x), f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p*=2.03; a*=.5; } return s; }
float fft(float x){ return texture(uAudio, vec2(x, .25)).r; }
float luma(vec3 c){ return dot(c, vec3(.299,.587,.114)); }
vec2 mirror(vec2 q){ return 1. - abs(1. - mod(q, 2.)); }
`;

// feel: hard = reads as a cut, punch = a hit with motion, smooth = a dissolve, musical = driven by the spectrum
const BUILTIN_TRANSITIONS = [
  { id: 'bt-flash', name: 'Flash Cut', feel: 'hard', beats: [0.25, 0.5], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; float p=progress;
  vec4 c = p<.5 ? A(uv) : B(uv);
  float f = exp(-pow((p-.5)*6.,2.));
  vec3 tint = mix(vec3(1.), .5+.5*cos(6.2831*(uSeed+vec3(0.,.33,.67))), .35);
  outColor = vec4(c.rgb + tint*f*1.3, 1.); }` },

  { id: 'bt-glitch', name: 'Glitch Slices', feel: 'hard', beats: [0.5, 1], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; float p=progress;
  float rows = 14. + floor(uSeed*34.);
  float row = floor(uv.y*rows);
  float r = h21(vec2(row, uSeed*91.));
  float s = sin(3.1416*p);
  float shift = (h21(vec2(row, 7.+floor(p*24.)))-.5) * .3 * s;
  vec2 su = vec2(fract(uv.x+shift), uv.y);
  vec2 o = vec2(.012*s, 0.);
  vec3 ca = vec3(A(su+o).r, A(su).g, A(su-o).b);
  vec3 cb = vec3(B(su+o).r, B(su).g, B(su-o).b);
  vec3 col = mix(ca, cb, step(r, p*1.15-.05));
  col *= 1. - .15*s*step(.5, fract(uv.y*resolution.y*.5));
  outColor = vec4(col, 1.); }` },

  { id: 'bt-zoom', name: 'Zoom Punch', feel: 'punch', beats: [0.5, 1], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; vec2 c=uv-.5; float p=progress;
  float e = p<.5 ? p*2. : (1.-p)*2.;
  float z = 1. + e*e*2.2;
  vec3 acc = vec3(0.);
  for(int i=0;i<12;i++){ float k=float(i)/12.; vec2 q=.5+c/(z*(1.+k*.14*e)); acc += (p<.5 ? A(q) : B(q)).rgb; }
  outColor = vec4(acc/12. + vec3(e*e*.22), 1.); }` },

  { id: 'bt-whip', name: 'Whip Pan', feel: 'punch', beats: [0.5, 1], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; float p=progress;
  float e = p*p*(3.-2.*p);
  vec2 d = abs(uDir.x) >= abs(uDir.y) ? vec2(sign(uDir.x + 1e-4), 0.) : vec2(0., sign(uDir.y));
  float sp = sin(3.1416*p);
  vec3 acc = vec3(0.);
  for(int i=0;i<16;i++){ float k = (float(i)/15. - .5) * .3 * sp;
    vec2 qa = uv + d*(e+k), qb = uv + d*(e-1.+k);
    bool inA = qa.x>=0. && qa.x<=1. && qa.y>=0. && qa.y<=1.;
    acc += inA ? A(qa).rgb : B(clamp(qb,0.,1.)).rgb; }
  outColor = vec4(acc/16., 1.); }` },

  { id: 'bt-iris', name: 'Bass Iris', feel: 'musical', beats: [1, 2], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; float asp=resolution.x/resolution.y;
  vec2 c=(uv-.5-uDir*.18)*vec2(asp,1.); float r=length(c), ang=atan(c.y,c.x);
  float p=progress, s=sin(3.1416*p);
  float R = p*p*(3.-2.*p) * (length(vec2(asp,1.))*.75 + .1);
  R += (.035*sin(ang*7.+uSeed*20.)*(.3+uBass) + .03*uKick) * s;
  float m = smoothstep(R, R-.012, r);
  vec3 col = mix(A(uv).rgb, B(uv).rgb, m);
  col += exp(-pow((r-R)/.012,2.)) * s * (B(uv).rgb*1.4 + .35);
  outColor = vec4(col, 1.); }` },

  { id: 'bt-pixel', name: 'Pixel Swap', feel: 'hard', beats: [0.5, 1], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; float p=progress;
  float e = 1. - abs(p*2.-1.);
  float cells = floor(mix(resolution.y, 10., pow(e,.6))/2.)*2. + 2.;
  vec2 sz = vec2(cells*resolution.x/resolution.y, cells);
  vec2 id = floor(uv*sz), q = (id+.5)/sz;
  float r = h21(id + uSeed*17.);
  vec4 col = p < .35 + .3*r ? A(q) : B(q);
  outColor = vec4(col.rgb, 1.); }` },

  { id: 'bt-burn', name: 'Luma Burn', feel: 'smooth', beats: [1, 4], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; float p=progress;
  vec3 a=A(uv).rgb, b=B(uv).rgb;
  float l = luma(a)*.65 + fbm(uv*4.+uSeed*10.)*.35;
  float e = p*1.3 - .15;
  float m = smoothstep(e+.06, e, l);
  float g = smoothstep(.07, 0., abs(l-e)) * (1.-m);
  vec3 hot = mix(vec3(1.,.5,.15), vec3(.4,.8,1.), step(.5, fract(uSeed*3.7)));
  outColor = vec4(mix(a,b,m) + g*hot*2., 1.); }` },

  { id: 'bt-bars', name: 'Spectrum Bars', feel: 'musical', beats: [1, 2], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; float p=progress;
  float bars = 32. + floor(uSeed*32.);
  float bx = (floor(uv.x*bars)+.5)/bars;
  float a = fft(pow(bx,1.6)*.7+.01);
  float s = sin(3.1416*p);
  float h = p*1.6 - .3 + a*.7*s;
  float m = step(uv.y, h);
  vec3 col = mix(A(uv).rgb, B(uv).rgb, m);
  col += exp(-pow((uv.y-h)*70.,2.)) * s * vec3(.85,.95,1.);
  col *= mix(1., .55, s*(1.-step(.08, fract(uv.x*bars))));
  outColor = vec4(col, 1.); }` },

  { id: 'bt-shatter', name: 'Card Flip Grid', feel: 'hard', beats: [1, 2], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; float p=progress;
  float n = floor(4. + uSeed*6.);
  vec2 g = vec2(floor(n*resolution.x/resolution.y), n);
  vec2 id = floor(uv*g), f = fract(uv*g);
  float r = h21(id + uSeed*13.);
  float lt = clamp((p - r*.5)/.5, 0., 1.);
  float s = cos(lt*3.1416);
  bool inside = abs(f.x-.5) <= abs(s)*.5;
  vec2 ff = vec2((f.x-.5)/max(abs(s),1e-3)+.5, f.y);
  vec2 q = (id + ff)/g;
  vec3 col = s > 0. ? A(q).rgb : B(q).rgb;
  col *= .55 + .45*abs(s);
  outColor = vec4(inside ? col : vec3(.015), 1.); }` },

  { id: 'bt-ink', name: 'Ink Dissolve', feel: 'smooth', beats: [1, 4], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; float p=progress;
  float n = fbm(uv*vec2(resolution.x/resolution.y,1.)*3. + uSeed*7.);
  float e = p*1.3 - .15;
  float m = smoothstep(e+.025, e-.025, n);
  float edge = smoothstep(.05, 0., abs(n-e));
  outColor = vec4(mix(A(uv).rgb, B(uv).rgb, m) * (1.-edge*.85), 1.); }` },

  { id: 'bt-swirl', name: 'Swirl', feel: 'smooth', beats: [1, 2], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; float asp=resolution.x/resolution.y;
  vec2 c=(uv-.5)*vec2(asp,1.); float r=length(c), p=progress;
  float a = sin(3.1416*p)*(1.-smoothstep(0.,.9,r))*7.*sign(uDir.x+.001);
  c = mat2(cos(a),-sin(a),sin(a),cos(a))*c;
  vec2 q = mirror(c/vec2(asp,1.)+.5);
  outColor = vec4(mix(A(q).rgb, B(q).rgb, smoothstep(.35,.65,p)), 1.); }` },

  { id: 'bt-rgb', name: 'RGB Drift', feel: 'smooth', beats: [0.5, 2], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; float p=progress;
  vec2 d = normalize(uDir+vec2(1e-4))*.18;
  float pr=smoothstep(0.,.7,p), pg=smoothstep(.15,.85,p), pb=smoothstep(.3,1.,p);
  vec3 a = A(uv).rgb;
  vec3 b = vec3(B(mirror(uv+d*(1.-pr))).r, B(mirror(uv+d*(1.-pg)*.4)).g, B(mirror(uv-d*(1.-pb))).b);
  outColor = vec4(mix(a.r,b.r,pr), mix(a.g,b.g,pg), mix(a.b,b.b,pb), 1.); }` },

  { id: 'bt-hex', name: 'Hex Bloom', feel: 'musical', beats: [1, 2], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; float asp=resolution.x/resolution.y;
  vec2 P = (uv-.5)*vec2(asp,1.)*10.;
  vec2 s = vec2(1.,1.7320508), h = s*.5;
  vec2 a = mod(P, s)-h, b = mod(P-h, s)-h;
  vec2 gv = dot(a,a) < dot(b,b) ? a : b;
  vec2 id = P - gv;
  vec2 o = uDir*vec2(asp,1.)*5.;
  float d = length(id-o) / (length(vec2(asp,1.))*10.);
  float t = progress*1.45 - .25 + uBass*.06*sin(3.1416*progress);
  float m = smoothstep(t, t-.06, d + h21(id)*.1);
  float rim = smoothstep(.42, .5, length(gv)) * m * (1.-m) * 4.;
  outColor = vec4(mix(A(uv).rgb, B(uv).rgb, m) + rim*vec3(1.), 1.); }` },

  { id: 'bt-stripes', name: 'Stripe Wipe', feel: 'hard', beats: [0.5, 1], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; float asp=resolution.x/resolution.y;
  vec2 d = normalize(uDir+vec2(1e-4));
  vec2 c = (uv-.5)*vec2(asp,1.);
  float x = dot(c, d) / (abs(d.x)*asp + abs(d.y)) + .5;
  float y = dot(c, vec2(-d.y, d.x));
  float stripe = floor(y*(8.+floor(uSeed*10.)));
  float off = h21(vec2(stripe, uSeed*5.))*.3;
  float m = step(x, progress*1.3 - off);
  outColor = vec4(mix(A(uv).rgb, B(uv).rgb, m), 1.); }` },

  { id: 'bt-kaleido', name: 'Kaleido Fold', feel: 'smooth', beats: [1, 2], code: `
void main(){ vec2 uv=gl_FragCoord.xy/resolution; float asp=resolution.x/resolution.y; float p=progress;
  float e = sin(3.1416*p);
  vec2 c=(uv-.5)*vec2(asp,1.);
  float n = 5. + floor(uSeed*5.), a = atan(c.y,c.x), r = length(c);
  float seg = 6.2831/n, af = abs(mod(a + p*2., seg)-seg*.5);
  vec2 k = vec2(cos(af), sin(af))*r;
  vec2 q = mirror(mix(c, k, e)/vec2(asp,1.) + .5);
  outColor = vec4(mix(A(q).rgb, B(q).rgb, smoothstep(.4,.6,p)), 1.); }` },
];

// How the director should treat transitions that come from the library (gl-transitions).
// Anything not listed here (a transition added to the library later) is treated as smooth.
const LIB_TRANSITION_FEEL = {
  dreamy: 'smooth', colorphase: 'smooth', filmburn: 'smooth', waterdrop: 'smooth', ripple: 'smooth',
  morph: 'smooth', displacement: 'smooth', 'rotate-scale-fade': 'smooth', trippyswirl4: 'smooth', edgetransition: 'smooth',
  tangentmotionblur: 'punch', flyeye: 'punch', powerkaleido: 'punch', rotatetransition: 'punch',
};

// ------------------------------------------------------------ look pass (lens + grade), per layer
const LOOK_SRC = `
uniform sampler2D from; uniform vec2 resolution; uniform float uT;
uniform int uLens; uniform vec4 uLensP; uniform vec4 uGrade; uniform vec4 uTint; uniform float uPoster;
uniform float uBass; uniform float uKick;
out vec4 outColor;
const float PI = 3.14159265;
vec2 mirror(vec2 q){ return 1. - abs(1. - mod(q, 2.)); }
vec3 hue(vec3 c, float h){
  const mat3 toYIQ = mat3(.299,.596,.211, .587,-.274,-.523, .114,-.322,.312);
  const mat3 toRGB = mat3(1.,1.,1., .956,-.272,-1.106, .621,-.647,1.703);
  vec3 y = toYIQ*c; float a = h*6.2831853, cs=cos(a), sn=sin(a);
  y.yz = mat2(cs,sn,-sn,cs)*y.yz; return toRGB*y; }
void main(){
  vec2 uv = gl_FragCoord.xy/resolution; float asp = resolution.x/resolution.y;
  vec2 c = (uv-.5)*vec2(asp,1.);
  vec2 q = uv;
  if (uLens == 1) q.x = .5 - abs(uv.x-.5);                                     // mirror left
  else if (uLens == 2) q = .5 - abs(uv-.5);                                   // mirror quad
  else if (uLens == 3) {                                                      // kaleidoscope
    float n = uLensP.x, a = atan(c.y,c.x) + uT*uLensP.y, r = length(c);
    float seg = 2.*PI/n; a = abs(mod(a, seg) - seg*.5);
    q = mirror(vec2(cos(a), sin(a))*r*(1.+.1*uBass)/vec2(asp,1.) + .5); }
  else if (uLens == 4) q = mirror(uv*uLensP.x + vec2(uT*.02, 0.));            // mirrored tiles
  else if (uLens == 5) {                                                      // polar tunnel
    float a = atan(c.y,c.x)/(2.*PI)+.5, r = length(c);
    q = mirror(vec2(a*uLensP.x, .25/(r+.05) + uT*uLensP.y)); }
  else if (uLens == 6) {                                                      // bulge, breathes with bass
    float r = length(c), k = uLensP.x*(.6+.8*uBass);
    q = c*(1. - k*(1.-r*r))/vec2(asp,1.) + .5; q = mirror(q); }
  else if (uLens == 7) {                                                      // slow drift, kick push
    float a = uT*uLensP.y, z = 1. + uLensP.x + .06*uKick;
    q = mirror(mat2(cos(a),-sin(a),sin(a),cos(a))*c/z/vec2(asp,1.) + .5); }
  else if (uLens == 8) {                                                      // mosaic, pops on kicks
    float cells = uLensP.x*(1. - .45*uKick);
    vec2 sz = vec2(cells*asp, cells); q = (floor(uv*sz)+.5)/sz; }
  else if (uLens == 9) q.y = .5 - abs(uv.y-.5);                                // mirror top
  else if (uLens == 10) {                                                     // ripple
    float r = length(c); q = uv + c/max(r,1e-3)*sin(r*uLensP.x - uT*4.)*.012*(.4+uBass); q = mirror(q); }
  vec3 col = texture(from, q).rgb;
  // grade: hue rotate, saturation, contrast, exposure
  if (uGrade.x != 0.) col = max(hue(col, uGrade.x), 0.);
  float l = dot(col, vec3(.299,.587,.114));
  col = mix(vec3(l), col, uGrade.y);
  col = (col - .5)*uGrade.z + .5;
  col *= uGrade.w;
  if (uTint.a > 0.) { float L = clamp(dot(col, vec3(.299,.587,.114)),0.,1.);
    vec3 duo = mix(vec3(.02,.01,.04), uTint.rgb, smoothstep(.0,1.,L)); duo = mix(duo, vec3(1.), smoothstep(.75,1.,L));
    col = mix(col, duo, uTint.a); }
  if (uPoster > 1.) col = floor(col*uPoster + .5)/uPoster;
  outColor = vec4(clamp(col, 0., 1.), 1.);
}`;

// ------------------------------------------------------------ duet: two shaders in one frame
const DUET_SRC = `
uniform sampler2D from; uniform sampler2D to; uniform vec2 resolution; uniform float uT;
uniform int uBlend; uniform float uAmt; uniform float uBass; uniform float uKick; uniform float uSeed;
out vec4 outColor;
float luma(vec3 c){ return dot(c, vec3(.299,.587,.114)); }
void main(){
  vec2 uv = gl_FragCoord.xy/resolution; float asp = resolution.x/resolution.y;
  vec3 a = texture(from, uv).rgb, b = texture(to, uv).rgb, col;
  if (uBlend == 0) col = 1. - (1.-a)*(1.-b*uAmt);                                   // screen
  else if (uBlend == 1) col = abs(a - b*uAmt);                                       // difference
  else if (uBlend == 2) col = mix(a, b, smoothstep(.18, .05, luma(a))*uAmt);         // B fills A's shadows
  else if (uBlend == 3) {                                                            // moving diagonal split
    float x = dot(uv-.5, normalize(vec2(1., .6))) + .12*sin(uT*.4+uSeed*6.);
    col = mix(a, b, smoothstep(-.004, .004, x)); col += .6*exp(-pow(x/.003,2.)); }
  else if (uBlend == 4) {                                                            // portal that breathes with bass
    vec2 c = (uv - .5 - .2*vec2(sin(uT*.3+uSeed*9.), cos(uT*.23)))*vec2(asp,1.);
    float R = .22 + .12*uBass + .05*uKick, r = length(c);
    col = mix(a, b, smoothstep(R, R-.008, r)); col += vec3(1.)*exp(-pow((r-R)/.006,2.))*.8; }
  else if (uBlend == 5) col = max(a, b*uAmt);                                        // lighten
  else { vec3 o = mix(2.*a*b, 1.-2.*(1.-a)*(1.-b), step(.5, a)); col = mix(a, o, uAmt); }   // overlay
  outColor = vec4(clamp(col,0.,1.), 1.);
}`;

// ------------------------------------------------------------ fx: hits, echo, hold, credit, fade
const FX_SRC = `
uniform sampler2D from; uniform sampler2D uPrev; uniform sampler2D uOverlay; uniform sampler2D uEff; uniform float uEffAmt;
uniform vec2 resolution; uniform float uT;
uniform float uZoom; uniform float uRGB; uniform float uEcho; uniform float uHold; uniform float uInvert;
uniform float uShake; uniform float uScan; uniform float uFade; uniform float uOverlayAmt; uniform float uBars;
uniform float uGrain; uniform float uVignette;
uniform vec4 uFlash; uniform vec4 uShock;
out vec4 outColor;
float h21(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
void main(){
  vec2 uv = gl_FragCoord.xy/resolution; float asp = resolution.x/resolution.y;
  vec2 q = .5 + (uv-.5)/(1. + uZoom*.16);
  q += uShake*.012*vec2(sin(uT*61.), cos(uT*47.));
  if (uShock.x > 0.) {                                    // shockwave ring
    vec2 c = (q - uShock.yz)*vec2(asp,1.); float r = length(c);
    float w = exp(-pow((r-uShock.w)/.05, 2.));
    q -= c/max(r,1e-3)/vec2(asp,1.) * w * .035 * uShock.x; }
  vec2 o = vec2(uRGB, 0.);
  vec3 col = vec3(texture(from, q+o).r, texture(from, q).g, texture(from, q-o).b);
  if (uEffAmt > 0.) col = mix(col, vec3(texture(uEff, q+o).r, texture(uEff, q).g, texture(uEff, q-o).b), uEffAmt);
  vec3 prev = texture(uPrev, .5 + (uv-.5)*.985).rgb;
  col = max(col, prev*uEcho);                             // feedback trails
  col = mix(col, texture(uPrev, uv).rgb, uHold);           // freeze frame
  col = mix(col, 1.-col, uInvert);
  col += uFlash.rgb*uFlash.a;
  if (uScan > 0.) col *= 1. - uScan*.35*step(.5, fract(gl_FragCoord.y*.5));
  vec2 v = uv-.5; col *= mix(1., smoothstep(.95, .25, length(v*vec2(1.,.85))), uVignette);
  col += (h21(gl_FragCoord.xy + fract(uT)*91.)-.5)*uGrain;
  vec4 ov = texture(uOverlay, vec2(uv.x, 1.-uv.y));
  col = mix(col, ov.rgb, ov.a*uOverlayAmt);
  float bar = step(abs(uv.y-.5), .5-uBars);
  col *= bar*uFade;
  outColor = vec4(clamp(col,0.,1.), 1.);
}`;

const BLIT_SRC = `
uniform sampler2D from; uniform vec2 resolution; out vec4 outColor;
void main(){ outColor = vec4(texture(from, gl_FragCoord.xy/resolution).rgb, 1.); }`;

// ------------------------------------------------------------ a built-in scene
// Silk Ribbons (OneHung): audio-reactive pastel ribbons. Always in the pool, so the page still makes
// a video if the library can't be reached.
const SILK_RIBBONS = `
const vec3 PAL[5] = vec3[5](vec3(1.,.63,.79), vec3(.80,.68,.95), vec3(.63,.78,.97), vec3(.66,.93,.82), vec3(1.,.85,.78));
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
vec2  h22(vec2 p){ float n=h21(p); return vec2(n, h21(p+n+17.7)); }
float fftv(float f){ return texture(iChannel0, vec2(f,.25)).x; }
float wave(float x){ return texture(iChannel0, vec2(x,.75)).x - .5; }
vec3 pearl(vec3 col, vec2 uv, vec2 c, float r, float a, float PX){
  vec2 d = uv-c; float l = length(d);
  float m = 1.-smoothstep(r-PX, r+PX, l);
  if(m<=0.) return col*(1. - .10*exp(-pow((l-r*.6)/(r*.9),2.)));
  vec3 n = vec3(d/r, sqrt(max(1.-dot(d,d)/(r*r),0.)));
  vec3 L = normalize(vec3(-.4,.6,.7));
  float dif = .55+.45*max(dot(n,L),0.), spec = pow(max(dot(reflect(-L,n),vec3(0,0,1)),0.),40.);
  vec3 pc = vec3(.98,.95,.97)*dif + vec3(.85,.75,1.)*pow(1.-n.z,2.5)*.35 + spec*.9;
  return mix(col, pc, m*a); }
void mainImage(out vec4 fragColor, in vec2 fragCoord){
  vec2 R = iResolution.xy, uv = (fragCoord-.5*R)/R.y, p = fragCoord/R.y; float PX = 1.5/R.y, T = iTime;
  float bass = (fftv(.02)+fftv(.05)+fftv(.08))/3., mids = (fftv(.20)+fftv(.30))/2., treb = (fftv(.55)+fftv(.70)+fftv(.85))/3.;
  float KICK = smoothstep(.55,.92,bass);
  vec3 col = mix(vec3(.99,.92,.95), vec3(.90,.92,.99), uv.y+.5);
  col = mix(col, vec3(.95,.97,.93), .25*sin(uv.x*1.3+T*.05)+.1);
  for(int i=4;i>=0;i--){
    float fi = float(i), zz = 1.+abs(fi-2.)*.25, sx = uv.x*zz;
    float swell = fftv(.05+fi*.12), wav = wave(fract(sx*.35+.5+fi*.07))*(.6+mids);
    float Y = mix(.42,-.42,fi/4.) + sin(T*.29+fi*1.9)*.05 + wav*(.10+bass*.16) - KICK*.02;
    float dy = uv.y - Y/zz;
    float th = sx*(2.2+fi*.5) + T*(.45+fi*.10) + wav*3. + KICK*1.1;
    float facing = cos(th), af = abs(facing);
    float halfW = max((.030+swell*.028)*max(af,.07)/zz, PX*1.5);
    float v = clamp(dy/halfW,-1.,1.);
    float body = 1.-smoothstep(halfW-PX, halfW+PX, abs(dy));
    float fog = smoothstep(1.75,.75,zz);
    vec3 rc = PAL[i], face = mix(rc.bgr*vec3(.92,.86,.98), rc, smoothstep(-.08,.08,facing));
    vec3 n = normalize(vec3(0., v*.55+sin(th)*.6, max(af,.15))), L = normalize(vec3(-.3,.6,.75));
    float diff = .55+.45*max(dot(n,L),0.), spec = pow(max(dot(reflect(-L,n),vec3(0,0,1)),0.),24.);
    float sheen = exp(-pow((v-sin(th))/.38,2.))*(.30+swell*.40+KICK*.35);
    vec3 rs = face*diff*(.95+.05*sin(v*24.+th*2.+fi*7.));
    rs = mix(rs, vec3(1.,.98,1.), clamp(sheen+spec*.5,0.,1.));
    rs = mix(rs, face*vec3(.72,.60,.74), smoothstep(.55,1.,abs(v))*.40);
    rs += vec3(1.,.95,1.)*smoothstep(.20,.03,af)*smoothstep(.5,0.,abs(v))*.7;
    rs = mix(col*1.04+.03, rs, .55+.45*fog);
    float sh = exp(-pow((dy+halfW*1.6)/(halfW*2.5+.01),2.));
    col *= 1.-sh*.10*fog*(1.-body);
    col = mix(col, rs, body);
    col += face*exp(-pow(dy/(halfW*4.),2.))*.05*fog*(1.+KICK);
  }
  col = pearl(col, uv, vec2(sin(T*.09+1.2)*.5, -.06+sin(T*.15+1.)*.05+bass*.018), .042, .84, PX);
  vec2 gi = floor(p*22.); float gh = h21(gi+5.1);
  float gd = length(fract(p*22.)-.5-(h22(gi+3.3)-.5)*.6);
  col += vec3(1.,.97,1.)*smoothstep(.12,.02,gd)*smoothstep(.92,.94,gh)*pow(.5+.5*sin(T*6.+gh*40.),8.)*(.12+treb);
  col = mix(col, vec3(1.,.93,.96), smoothstep(.5,1.05,length(uv))*.22);
  fragColor = vec4(clamp(col,0.,1.),1.);
}`;

const MUSIC_INPUT = { channel: 0, type: 'music', sampler: { filter: 'linear', wrap: 'clamp', vflip: false } };

// A shaderlib/1 doc for code that lives in this page or was dropped onto it.
function localDoc(id, name, user, code, dialect, kind, category) {
  return {
    schema: 'shaderlib/1', dialect, kind, category, params: {},
    info: { id, name, username: user, description: '', tags: [], audio: { reactive: true }, preview: { thumb: '', still: '' } },
    renderpass: [{ type: 'image', name: 'Image', code, inputs: kind === 'transition' ? [] : [MUSIC_INPUT] }],
  };
}

function builtinEntries() {
  const scenes = [{
    id: 'builtin-silk-ribbons', name: 'Silk Ribbons', user: 'OneHung', kind: 'standalone', category: 'audio-reactive',
    stars: 4, audio: true, passes: 1, needs: ['music'], tags: ['built-in'], source: 'builtin',
    doc: localDoc('builtin-silk-ribbons', 'Silk Ribbons', 'OneHung', SILK_RIBBONS, 'shadertoy', 'standalone', 'audio-reactive'),
  }];
  const trans = BUILTIN_TRANSITIONS.map(t => ({
    id: t.id, name: t.name, user: 'Shader Roulette', kind: 'transition', category: 'transition', source: 'builtin',
    feel: t.feel, beats: t.beats, stars: 4,
    doc: localDoc(t.id, t.name, 'Shader Roulette', TR_PRELUDE + t.code, 'glsl-full', 'transition', 'transition'),
  }));
  return { scenes, trans };
}
