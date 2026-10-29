void mainImage(out vec4 o, in vec2 f){
  vec2 uv = (f - .5*iResolution.xy)/iResolution.y;
  float b = texture(iChannel0, vec2(.05, .25)).x;
  float r = length(uv), a = atan(uv.y, uv.x);
  vec3 c = .5 + .5*cos(iTime + a*3. + r*10. - b*4. + vec3(0,2,4));
  o = vec4(c*smoothstep(.9, .1, r), 1.);
}
