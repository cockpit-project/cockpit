/**
 * QUnit-TAP - A TAP Output Producer Plugin for QUnit
 *
 * https://github.com/twada/qunit-tap
 * version: 1.5.1
 *
 * Copyright (c) 2010-2016 Takuto Wada
 * Dual licensed under the MIT and GPLv2 licenses.
 *   https://raw.github.com/twada/qunit-tap/master/MIT-LICENSE.txt
 *   https://raw.github.com/twada/qunit-tap/master/GPL-LICENSE.txt
 *
 * A part of extend function is:
 *   Copyright 2012 jQuery Foundation and other contributors
 *   Released under the MIT license.
 *   http://jquery.org/license
 */
(function (root, factory) {
    'use strict';

    // using returnExports UMD pattern
    if (typeof define === 'function' && define.amd) {
        define(factory);
    } else if (typeof exports === 'object') {
        module.exports = factory();
    } else {
        root.qunitTap = factory();
    }
}(this, function () {
    'use strict';

    var qunitTapVersion = '1.5.1',
        slice = Array.prototype.slice;

    // borrowed from qunit.js
    function extend (a, b) {
        var prop;
        for (prop in b) {
            if (b.hasOwnProperty(prop)) {
                if (typeof b[prop] === 'undefined') {
                    delete a[prop];
                } else {
                    a[prop] = b[prop];
                }
            }
        }
        return a;
    }

    function indexOf (ary, element) {
        var i;
        for (i = 0; i < ary.length; i += 1) {
            if (ary[i] === element) {
                return i;
            }
        }
        return -1;
    }

    function removeElement (ary, element) {
        var index = indexOf(ary, element);
        if (index !== -1) {
            return ary.splice(index, 1);
        } else {
            return [];
        }
    }

    function isPlanRequired (conf) {
        return (typeof conf !== 'undefined' && typeof conf.requireExpects !== 'undefined' && conf.requireExpects);
    }

    function isPassed (details) {
        return !!(details.result);
    }

    function isFailed (details) {
        return !(isPassed(details));
    }

    function isAssertOkFailed (details) {
        return isFailed(details) && typeof details.expected === 'undefined' && typeof details.actual === 'undefined';
    }

    function escapeLineEndings (str) {
        return str.replace(/(\r?\n)/g, '$&# ');
    }

    function ltrim (str) {
        return str.replace(/^\s+/, '');
    }

    function noop (obj) {
        return obj;
    }

    function render (desc, fieldName, fieldValue, formatter) {
        desc.push(fieldName + ': ' + formatter(fieldValue));
    }

    function renderIf (shouldRender, desc, fieldName, fieldValue, formatter) {
        if (!shouldRender || typeof fieldValue === 'undefined') {
            return;
        }
        render(desc, fieldName, fieldValue, formatter);
    }

    function formatTestLine (testLine, rest) {
        if (!rest) {
            return testLine;
        }
        return testLine + ' - ' + escapeLineEndings(rest);
    }

    var createCallbackAppenderFor = function (qu) {
        return function (subject, observer, event) {
            var originalLoggingCallback = subject[event],
                callback = function () {
                    // make listener methods (moduleStart,testStart,log, ...) overridable.
                    observer[event].apply(observer, slice.apply(arguments));
                };
            originalLoggingCallback(callback);
            return callback;
        };
    };


    /**
     * QUnit-TAP - A TAP Output Producer Plugin for QUnit
     * @param qunitObject QUnit object reference.
     * @param printLikeFunction print-like function for TAP output (assumes line-separator is added by this function for each call).
     * @param options configuration options to customize default behavior.
     * @return object to provide QUnit-TAP API and customization subject.
     */
    function qunitTap(qunitObject, printLikeFunction, options) {
        if (!qunitObject) {
            throw new Error('should pass QUnit object reference. Please check QUnit\'s "require" path if you are using Node.js (or any CommonJS env).');
        } else if (typeof printLikeFunction !== 'function') {
            throw new Error('should pass print-like function');
        }

        var qu = qunitObject,
            tap = {},
            deprecateOption = function deprecateOption (optionName, fallback) {
                // option deprecation and fallback function
                if (!options || typeof options !== 'object') {
                    return;
                }
                if (typeof options[optionName] === 'undefined') {
                    return;
                }
                printLikeFunction('# WARNING: Option "' + optionName + '" is deprecated and will be removed in future version.');
                fallback(options[optionName]);
            },
            targetEvents = [
                'moduleStart',
                'testStart',
                'log',
                'testDone',
                'done'
            ],
            registeredCallbacks = {},
            explain = (function () {
                if (typeof qu.dump !== 'undefined' && typeof qu.dump.parse === 'function') {
                    return function explain (obj) {
                        return qu.dump.parse(obj);
                    };
                }
                if (typeof qu.jsDump !== 'undefined' && typeof qu.jsDump.parse === 'function') {
                    return function explain (obj) {
                        return qu.jsDump.parse(obj);
                    };
                }
                return noop;
            })();

        tap.config = extend(
            {
                initialCount: 1,
                showModuleNameOnFailure: true,
                showTestNameOnFailure: true,
                showExpectationOnFailure: true,
                showSourceOnFailure: true
            },
            options
        );
        deprecateOption('noPlan', function (flag) {
            printLikeFunction('# Now QUnit-TAP works as with "noPlan: true" by default. If you want to delare plan explicitly, please use "QUnit.config.requireExpects" option instead.');
            tap.config.noPlan = flag;
        });
        deprecateOption('count', function (count) {
            tap.config.initialCount = (count + 1);
        });
        deprecateOption('showDetailsOnFailure', function (flag) {
            tap.config.showModuleNameOnFailure = flag;
            tap.config.showTestNameOnFailure = flag;
            tap.config.showExpectationOnFailure = flag;
            tap.config.showSourceOnFailure = flag;
        });
        tap.VERSION = qunitTapVersion;
        tap.puts = printLikeFunction;
        tap.count = tap.config.initialCount - 1;
        tap.expectedCount = tap.config.initialCount - 1;

        function isEnabled (configName) {
            return tap.config[configName];
        }

        function formatDetails (details) {
            if (isPassed(details)) {
                return details.message;
            }
            var desc = [];
            if (details.message) {
                desc.push(details.message);
            }
            if (isEnabled('showExpectationOnFailure') && !(isAssertOkFailed(details))) {
                render(desc, 'expected', details.expected, explain);
                render(desc, 'got', details.actual, explain);
            }
            renderIf(isEnabled('showTestNameOnFailure'), desc, 'test', details.name, noop);
            renderIf(isEnabled('showModuleNameOnFailure'), desc, 'module', details.module, noop);
            renderIf(isEnabled('showSourceOnFailure'), desc, 'source', details.source, ltrim);
            return desc.join(', ');
        }

        function printPlanLine (toCount) {
            tap.puts(tap.config.initialCount + '..' + toCount);
        }

        function unsubscribeEvent (eventName) {
            var listeners;
            if (indexOf(targetEvents, eventName) === -1) {
                return;
            }
            listeners = qu.config[eventName];
            if (typeof listeners === 'undefined') {
                return;
            }
            removeElement(listeners, registeredCallbacks[eventName]);
        }

        function unsubscribeEvents (eventNames) {
            var i;
            for (i = 0; i < eventNames.length; i += 1) {
                unsubscribeEvent(eventNames[i]);
            }
        }

        tap.explain = explain;

        tap.note = function note (obj) {
            tap.puts(escapeLineEndings('# ' + obj));
        };

        tap.diag = function diag (obj) {
            tap.note(obj);
            return false;
        };

        tap.moduleStart = function moduleStart (arg) {
            var name = (typeof arg === 'string') ? arg : arg.name;
            tap.note('module: ' + name);
        };

        tap.testStart = function testStart (arg) {
            var name = (typeof arg === 'string') ? arg : arg.name;
            tap.note('test: ' + name);
        };

        tap.log = function log (details) {
            var testLine = '';
            tap.count += 1;
            if (isFailed(details)) {
                testLine += 'not ';
            }
            testLine += ('ok ' + tap.count);
            tap.puts(formatTestLine(testLine, formatDetails(details)));
        };

        tap.testDone = function testDone () {
            if (isPlanRequired(qu.config)) {
                tap.expectedCount += qu.config.current.expected;
            }
        };

        tap.done = function done () {
            if (typeof tap.config.noPlan !== 'undefined' && !(tap.config.noPlan)) {
                // Do nothing until removal of 'noPlan' option.
            } else if (isPlanRequired(qu.config)) {
                printPlanLine(tap.expectedCount);
            } else {
                printPlanLine(tap.count);
            }
        };

        tap.unsubscribe = function unsubscribe () {
            if (typeof qu.config === 'undefined') {
                return;
            }
            if (arguments.length === 0) {
                unsubscribeEvents(targetEvents);
            } else {
                unsubscribeEvents(slice.apply(arguments));
            }
        };

        (function () {
            var appendCallback = createCallbackAppenderFor(qu),
                eventName, i, callback;
            for (i = 0; i < targetEvents.length; i += 1) {
                eventName = targetEvents[i];
                callback = appendCallback(qu, tap, eventName);
                registeredCallbacks[eventName] = callback;
            }
        })();

        return tap;
    }

    qunitTap.qunitTap = function () {
        throw new Error('[BC BREAK] Since 1.4.0, QUnit-TAP exports single qunitTap function as module.exports. Therefore, require("qunit-tap") returns qunitTap function itself. Please fix your code if you are using Node.js (or any CommonJS env).');
    };

    // using substack pattern (export single function)
    return qunitTap;
}));
