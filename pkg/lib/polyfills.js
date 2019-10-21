// This file contains various polyfills and other compatibility hacks
// Don't complain about extending native data types -- that's what polyfills do
/* eslint-disable no-extend-native */

if (!Promise.prototype.finally) {
    Promise.prototype.finally = function (f) {
        return this.then(function (value) {
            return Promise.resolve(f()).then(function () {
                return value;
            });
        }, function (err) {
            return Promise.resolve(f()).then(function () {
                throw err;
            });
        });
    };
}
