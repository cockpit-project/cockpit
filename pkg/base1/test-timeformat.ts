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
    const seconds = now - 4.5 * SEC;
    const minutes = now - 4 * MIN - 5 * SEC;
    const halfhour = now - 32 * MIN;
    const hours = now - 3 * HOUR - 57 * MIN;
    const yesterday = now - 25 * HOUR;
    const days4short = now - 4 * DAY + 2 * HOUR;
    const days4long = now - 4 * DAY - 2 * HOUR;
    const week3short = now - 20 * DAY + 2 * HOUR;
    const week3long = now - 21 * DAY - 2 * HOUR;
    const month2short = now - 2 * 30 * DAY + 5 * DAY;
    const month2long = now - 2 * 30 * DAY - 5 * DAY;

    cockpit.language = "en";
    assert.equal(timeformat.distanceToNow(seconds), "less than a minute");
    assert.equal(timeformat.distanceToNow(seconds, false), "less than a minute");
    assert.equal(timeformat.distanceToNow(seconds, true), "less than a minute ago");

    assert.equal(timeformat.distanceToNow(minutes), "4 minutes");
    assert.equal(timeformat.distanceToNow(minutes, true), "4 minutes ago");

    assert.equal(timeformat.distanceToNow(halfhour), "32 minutes");
    assert.equal(timeformat.distanceToNow(halfhour, true), "32 minutes ago");

    assert.equal(timeformat.distanceToNow(hours), "about 4 hours");
    assert.equal(timeformat.distanceToNow(hours, true), "about 4 hours ago");

    assert.equal(timeformat.distanceToNow(yesterday), "1 day");
    assert.equal(timeformat.distanceToNow(yesterday, true), "1 day ago");

    assert.equal(timeformat.distanceToNow(days4short), "4 days");
    assert.equal(timeformat.distanceToNow(days4long), "4 days");
    assert.equal(timeformat.distanceToNow(days4short, true), "4 days ago");

    assert.equal(timeformat.distanceToNow(week3short), "20 days");
    assert.equal(timeformat.distanceToNow(week3long), "21 days");
    assert.equal(timeformat.distanceToNow(week3long, true), "21 days ago");

    assert.equal(timeformat.distanceToNow(month2short), "about 2 months");
    assert.equal(timeformat.distanceToNow(month2long), "2 months");
});

QUnit.test("relative formatter, German", assert => {
    const now = Date.now();
    const seconds = now - 4.5 * SEC;

    // no need to be as thorough as with English, just spot check that it's translated
    cockpit.language = "de";
    assert.equal(timeformat.distanceToNow(seconds), "weniger als 1 Minute");
    assert.equal(timeformat.distanceToNow(seconds, true), "vor weniger als 1 Minute");

    assert.equal(timeformat.distanceToNow(now - 25 * HOUR), "1 Tag");
    assert.equal(timeformat.distanceToNow(now - 4 * DAY), "4 Tage");
    assert.equal(timeformat.distanceToNow(now - 21 * DAY), "21 Tage");
    assert.equal(timeformat.distanceToNow(now - 62 * DAY), "2 Monate");
});

QUnit.test("firstDayOfWeek", assert => {
    cockpit.language = "en";
    assert.equal(timeformat.firstDayOfWeek(), 0);
    cockpit.language = "de";
    assert.equal(timeformat.firstDayOfWeek(), 1);
});

QUnit.start();
