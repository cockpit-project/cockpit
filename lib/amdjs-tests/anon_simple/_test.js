go(     ["_reporter", "a", "b"],
function (amdJS,       a,   b) {
  amdJS.assert("a" === a.name, "anon_simple: a.name");
  amdJS.assert("b" === b.name, "anon_simple: b.name");
  amdJS.assert("c" === b.cName, "anon_simple: c.name via b");
  amdJS.print("DONE", "done");
});
