go(     ["_reporter", "require", "two", "funcTwo", "funcThree"],
function (amdJS,       require,   two,   funcTwo,   funcThree) {
  var args = two.doSomething(),
      twoInst = new funcTwo("TWO"),
      oneMod = two.getOneModule();

  amdJS.assert('small' === args.size, 'basic_circular: args.size');
  amdJS.assert('redtwo' === args.color, 'basic_circular: args.color');
  amdJS.assert('one' === oneMod.id, 'basic_circular: module.id property supported');
  amdJS.assert('TWO' === twoInst.name, 'basic_circular: instantiated objects');
  amdJS.assert('ONE-NESTED' === twoInst.oneName(), 'basic_circular: nested objects');
  amdJS.assert('THREE-THREE_SUFFIX' === funcThree('THREE'), 'basic_circular: resolved circular references');
  amdJS.print('DONE', 'done');
});
