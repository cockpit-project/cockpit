go(     ["_reporter", "require", "impl/array"],
function (amdJS,       require,   array) {
    amdJS.assert('impl/array' === array.name, 'anon_relative: array.name');
    amdJS.assert('impl/util' === array.dotUtilName, 'anon_relative: resolved "./util" to impl/util');
    amdJS.assert('util' === array.utilName, 'anon_relative: resolved "util" to impl/util');
    amdJS.print('DONE', 'done');
});
