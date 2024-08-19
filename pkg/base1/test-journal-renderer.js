/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import QUnit from "qunit-tests";
import { journal } from "journal";

const debug = false;

function pk(label, obj) {
    let str = label;
    if (obj) {
        str += ": ";
        str += obj.toSource();
    }
    console.log(str);
}

function dbg(label, obj) {
    if (debug)
        pk(label, obj);
}

const time = 0;
let bootid = 0;

function make_entry(message) {
    return {
        __REALTIME_TIMESTAMP: time.toString(),
        __CURSOR: "fake",
        _BOOT_ID: bootid.toString(),
        _COMM: "fake",
        UNUSED_FIELD: "12",
        SYSLOG_IDENTIFIER: "fake",
        PRIORITY: "3",
        MESSAGE: message
    };
}

function reboot() {
    bootid += 1;
}

let output;
let renderer;
let expected_day;

const funcs = {
    render_line: (ident, prio, message, count, time, cursor) => ({ message, count }),
    render_day_header: day => ({ day }),
    render_reboot_separator: () => ({ reboot: true }),

    append: elt => {
        dbg('append', elt);
        output.push(elt);
    },
    remove_last: () => {
        dbg('remove-last');
        output = output.slice(0, output.length - 1);
    },
    prepend: elt => {
        dbg('prepend', elt);
        output.unshift(elt);
    },
    remove_first: () => {
        dbg('remove-first');
        output = output.slice(1, output.length);
    }
};

function append(message) {
    renderer.append(make_entry(message));
}

function append_flush() {
    renderer.append_flush();
}

function prepend(message) {
    renderer.prepend(make_entry(message));
}

function prepend_flush() {
    renderer.prepend_flush();
}

function jexpect(assert, label, expected) {
    function jequal(a, b) {
        if (a.day)
            return a.day == b.day;
        else if (a.message)
            return a.message == b.message && a.count == b.count;
        else if (a.reboot)
            return a.reboot == b.reboot;
        else
            return false;
    }

    function check(expected) {
        if (output.length != expected.length)
            return false;
        for (let i = 0; i < output.length; i++)
            if (!jequal(output[i], expected[i]))
                return false;
        return true;
    }

    assert.ok(check(expected), label);
}

const month_names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
];

QUnit.testStart(function() {
    output = [];
    renderer = journal.renderer(funcs);
    const d = new Date(time);
    expected_day = month_names[d.getMonth()] + ' ' + d.getDate().toFixed() + ', ' + d.getFullYear().toFixed();
});

QUnit.test("append", assert => {
    append('foo');
    append('foo');
    append_flush();
    jexpect(assert, 'two repeated lines',
            [{ day: expected_day },
                { message: 'foo', count: 2 }
            ]);
    append('foo');
    append_flush();
    jexpect(assert, 'three repeated lines after flush',
            [{ day: expected_day },
                { message: 'foo', count: 3 }
            ]);
});

QUnit.test('prepend', assert => {
    prepend('foo');
    prepend('foo');
    prepend_flush();
    jexpect(assert, 'two repeated lines',
            [{ day: expected_day },
                { message: 'foo', count: 2 }
            ]);
    prepend('foo');
    prepend_flush();
    jexpect(assert, 'three repeated lines after flush',
            [{ day: expected_day },
                { message: 'foo', count: 3 }
            ]);
});

QUnit.test('prepend after append', assert => {
    append('foo');
    append_flush();
    prepend('foo');
    prepend_flush();
    jexpect(assert, 'two repeated lines',
            [{ day: expected_day },
                { message: 'foo', count: 2 }
            ]);
});

QUnit.test('prepend after append', assert => {
    append('foo');
    append_flush();
    prepend('bar');
    prepend_flush();
    jexpect(assert, 'two different lines',
            [{ day: expected_day },
                { message: 'bar', count: 1 },
                { message: 'foo', count: 1 }
            ]);
});

QUnit.test('append after prepend', assert => {
    prepend('foo');
    prepend_flush();
    append('foo');
    append_flush();
    jexpect(assert, 'two repeated lines',
            [{ day: expected_day },
                { message: 'foo', count: 2 }
            ]);
});

QUnit.test('append after split', assert => {
    prepend('bar');
    prepend('baz');
    prepend_flush();
    append('foo');
    append_flush();
    jexpect(assert, 'two different lines',
            [{ day: expected_day },
                { message: 'baz', count: 1 },
                { message: 'bar', count: 1 },
                { message: 'foo', count: 1 }
            ]);
});

QUnit.test('append after split', assert => {
    prepend('bar');
    prepend('baz');
    prepend_flush();
    append('bar');
    append_flush();
    jexpect(assert, 'two repeated lines',
            [{ day: expected_day },
                { message: 'baz', count: 1 },
                { message: 'bar', count: 2 },
            ]);
});

QUnit.test('prepend after split', assert => {
    append('foo');
    append('bar');
    append_flush();
    prepend('baz');
    prepend_flush();
    jexpect(assert, 'two different lines',
            [{ day: expected_day },
                { message: 'baz', count: 1 },
                { message: 'foo', count: 1 },
                { message: 'bar', count: 1 },
            ]);
});

QUnit.test('prepend after split', assert => {
    append('foo');
    append('bar');
    append_flush();
    prepend('foo');
    prepend_flush();
    jexpect(assert, 'two repeated lines',
            [{ day: expected_day },
                { message: 'foo', count: 2 },
                { message: 'bar', count: 1 },
            ]);
});

QUnit.test('reboot', assert => {
    append('foo');
    append('foo');
    reboot();
    append('foo');
    append_flush();
    jexpect(assert, 'two repeated lines before reboot',
            [{ day: expected_day },
                { message: 'foo', count: 2 },
                { reboot: true },
                { message: 'foo', count: 1 },
            ]);
});

QUnit.test('prepend to reboot same day', assert => {
    append('foo');
    append('baz');
    append_flush();
    reboot();
    prepend('bar');
    prepend_flush();
    jexpect(assert, 'different lines',
            [{ day: expected_day },
                { message: 'bar', count: 1 },
                { reboot: true },
                { message: 'foo', count: 1 },
                { message: 'baz', count: 1 },
            ]);
});

QUnit.test('prepend to reboot same day', assert => {
    append('foo');
    append('baz');
    append_flush();
    reboot();
    prepend('foo');
    prepend_flush();
    jexpect(assert, 'repeated line',
            [{ day: expected_day },
                { message: 'foo', count: 1 },
                { reboot: true },
                { message: 'foo', count: 1 },
                { message: 'baz', count: 1 },
            ]);
});

QUnit.start();
