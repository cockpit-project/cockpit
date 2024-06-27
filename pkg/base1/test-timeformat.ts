import QUnit from 'qunit-tests';

import cockpit from "cockpit";
import * as timeformat from "timeformat";

const d1 = new Date("2024-01-02 03:04:05");

QUnit.test("absolute formatters, English", assert => {
    cockpit.language = "en";
    assert.equal(timeformat.time(d1), "3:04 AM");
    assert.equal(timeformat.timeSeconds(d1), "3:04:05 AM");
    assert.equal(timeformat.date(d1), "January 2, 2024");
    assert.equal(timeformat.dateShort(d1), "1/2/2024");
    assert.equal(timeformat.dateTime(d1), "Jan 2, 2024, 3:04 AM");
    assert.equal(timeformat.dateTimeSeconds(d1), "Jan 2, 2024, 3:04:05 AM");
    assert.equal(timeformat.dateTimeNoYear(d1), "Jan 02, 03:04 AM");
    assert.equal(timeformat.weekdayDate(d1), "Tuesday, January 2, 2024");

    // all of these work with numbers as time argument
    assert.equal(timeformat.dateTimeSeconds(d1.valueOf()), "Jan 2, 2024, 3:04:05 AM");
});

QUnit.test("absolute formatters, German", assert => {
    cockpit.language = "de";
    assert.equal(timeformat.time(d1), "03:04");
    assert.equal(timeformat.timeSeconds(d1), "03:04:05");
    assert.equal(timeformat.date(d1), "2. Januar 2024");
    assert.equal(timeformat.dateShort(d1), "2.1.2024");
    assert.equal(timeformat.dateTime(d1), "02.01.2024, 03:04");
    assert.equal(timeformat.dateTimeSeconds(d1), "02.01.2024, 03:04:05");
    assert.equal(timeformat.dateTimeNoYear(d1), "02. Jan., 03:04");
    assert.equal(timeformat.weekdayDate(d1), "Dienstag, 2. Januar 2024");

    // all of these work with numbers as time argument
    assert.equal(timeformat.dateTimeSeconds(d1.valueOf()), "02.01.2024, 03:04:05");
});

QUnit.test("absolute formatters, per-country locale", assert => {
    cockpit.language = "en_GB";
    assert.equal(timeformat.timeSeconds(d1), "03:04:05");
    assert.equal(timeformat.date(d1), "2 January 2024");
    assert.equal(timeformat.dateShort(d1), "02/01/2024");

    cockpit.language = "pt";
    assert.equal(timeformat.date(d1), "2 de janeiro de 2024");

    cockpit.language = "pt_BR";
    assert.equal(timeformat.date(d1), "2 de janeiro de 2024");

    cockpit.language = "zh_CN";
    assert.equal(timeformat.weekdayDate(d1), "2024年1月2日星期二");

    cockpit.language = "zh_TW";
    assert.equal(timeformat.weekdayDate(d1), "2024年1月2日 星期二");
});

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

QUnit.test("relative formatter, English", assert => {
    const now = Date.now();

    cockpit.language = "en";
    assert.equal(timeformat.distanceToNow(now + 4.5 * SEC), "in less than a minute");
    assert.equal(timeformat.distanceToNow(now - 4.5 * SEC), "less than a minute ago");

    assert.equal(timeformat.distanceToNow(now + 4 * MIN - 5 * SEC), "in 4 minutes");
    assert.equal(timeformat.distanceToNow(now - 4 * MIN - 5 * SEC), "4 minutes ago");
    assert.equal(timeformat.distanceToNow(now - 4 * MIN + 5 * SEC), "4 minutes ago");

    assert.equal(timeformat.distanceToNow(now - 32 * MIN), "32 minutes ago");
    assert.equal(timeformat.distanceToNow(now + 32 * MIN), "in 32 minutes");

    assert.equal(timeformat.distanceToNow(now + 3 * HOUR + 57 * MIN), "in 4 hours");
    assert.equal(timeformat.distanceToNow(now - 3 * HOUR - 57 * MIN), "4 hours ago");

    assert.equal(timeformat.distanceToNow(now + 25 * HOUR), "tomorrow");
    assert.equal(timeformat.distanceToNow(now - 25 * HOUR), "yesterday");

    assert.equal(timeformat.distanceToNow(now + 4 * DAY - 2 * HOUR), "in 4 days");
    assert.equal(timeformat.distanceToNow(now + 4 * DAY + 2 * HOUR), "in 4 days");
    assert.equal(timeformat.distanceToNow(now - 4 * DAY - 2 * HOUR), "4 days ago");
    assert.equal(timeformat.distanceToNow(now - 4 * DAY + 2 * HOUR), "4 days ago");

    assert.equal(timeformat.distanceToNow(now + 20 * DAY), "in 3 weeks");
    assert.equal(timeformat.distanceToNow(now + 21 * DAY), "in 3 weeks");
    assert.equal(timeformat.distanceToNow(now - 21 * DAY), "3 weeks ago");

    assert.equal(timeformat.distanceToNow(now + 60 * DAY), "in 2 months");
    assert.equal(timeformat.distanceToNow(now - 60 * DAY), "2 months ago");

    assert.equal(timeformat.distanceToNow(now + 1200 * DAY), "in 3 years");
    assert.equal(timeformat.distanceToNow(now - 1200 * DAY), "3 years ago");
});

QUnit.test("relative formatter, German", assert => {
    const now = Date.now();

    // no need to be as thorough as with English, just spot check that it's translated
    cockpit.language = "de";
    /* TODO: this first needs to be translated in po/de.po
    assert.equal(timeformat.distanceToNow(now + 4.5 * SEC), "in weniger als 1 Minute");
    assert.equal(timeformat.distanceToNow(now - 4.5 * SEC), "vor weniger als 1 Minute");
    */

    assert.equal(timeformat.distanceToNow(now + 25 * HOUR), "morgen");
    assert.equal(timeformat.distanceToNow(now - 25 * HOUR), "gestern");
    assert.equal(timeformat.distanceToNow(now - 4 * DAY), "vor 4 Tagen");
    assert.equal(timeformat.distanceToNow(now + 21 * DAY), "in 3 Wochen");
});

QUnit.test("firstDayOfWeek", assert => {
    cockpit.language = "en";
    assert.equal(timeformat.firstDayOfWeek(), 0);
    cockpit.language = "de";
    assert.equal(timeformat.firstDayOfWeek(), 1);
});

QUnit.start();
