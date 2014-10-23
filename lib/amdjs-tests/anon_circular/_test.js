go(     ["_reporter", "require", "two", "funcTwo", "funcThree"],
function (amdJS,       require,   two,   funcTwo,   funcThree) {
  var args = two.doSomething(),
      twoInst = new funcTwo("TWO"),
      oneMod = two.getOneModule();
  amdJS.assert('small' === args.size, 'anon_circular: args.size');
  amdJS.assert('redtwo' === args.color, 'anon_circular: args.color');
  amdJS.assert('one' === oneMod.id, 'anon_circular: module.id property supported');
  amdJS.assert('TWO' === twoInst.name, 'anon_circular: instantiated objects');
  amdJS.assert('ONE-NESTED' === twoInst.oneName(), 'anon_circular: nested objects');
  amdJS.assert('THREE-THREE_SUFFIX' === funcThree('THREE'), 'anon_circular: resolved circular references');
  amdJS.print('DONE', 'done');
});
