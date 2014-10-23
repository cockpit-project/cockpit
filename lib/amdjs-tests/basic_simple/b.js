define('b', ['sub/c'], function (c) {
    return {
        name: 'b',
        cName: c.name
    };
});
