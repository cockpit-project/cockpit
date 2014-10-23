go(["_reporter", "require"], function(amdJS, require) {

  // tests if there are NO dependencies, the default
  // values of "require, exports, module" are used
  define('noDeps', function(require, exports, module) {
    amdJS.assert(typeof(require) === 'function', 'basic_no_deps: no dependencies case uses require in first slot. Is a function');
    amdJS.assert(typeof(exports) === 'object', 'basic_no_deps: no dependencies case uses exports in second slot. Is an object.');
    amdJS.assert(typeof(module) === 'object', 'basic_no_deps: no dependencies case uses module in third slot. Is an object.');
  });

  window.setTimeout(function() {
    require(['noDeps'], function () {
      amdJS.print('DONE', 'done');
    });
  });
});
