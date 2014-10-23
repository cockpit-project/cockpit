go(["_reporter", "require"], function(amdJS, require) {

  amdJS.assert(typeof define.amd === 'object', 'basic_define: define.amd is object');
  amdJS.print('DONE', 'done');
  
});