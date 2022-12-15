/* Wrappers around Intl.DateTimeFormat and date-fns which use Cockpit's current locale, and define a few standard formats.
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
 *
 * Time stamps are given in milliseconds since the epoch.
 */
import cockpit from "cockpit";
import { parse, formatDistanceToNow } from 'date-fns';
import * as locales from 'date-fns/locale';

// this needs to be dynamic, as some pages don't initialize cockpit.language right away
export const dateFormatLang = () => cockpit.language.replace('_', '-');

const dateFormatLangDateFns = () => {
    if (cockpit.language == "en") return "enUS";
    else return cockpit.language.replace('_', '');
};

// general Intl.DateTimeFormat formatter object
export const formatter = options => new Intl.DateTimeFormat(dateFormatLang(), options);

// common formatters; try to use these as much as possible, for UI consistency
// 07:41 AM
export const time = t => formatter({ timeStyle: "short" }).format(t);
// 7:41:26 AM
export const timeSeconds = t => formatter({ timeStyle: "medium" }).format(t);
// June 30, 2021
export const date = t => formatter({ dateStyle: "long" }).format(t);
// 06/30/2021
export const dateShort = t => formatter().format(t);
// Jun 30, 2021, 7:41 AM
export const dateTime = t => formatter({ dateStyle: "medium", timeStyle: "short" }).format(t);
// Jun 30, 2021, 7:41:23 AM
export const dateTimeSeconds = t => formatter({ dateStyle: "medium", timeStyle: "medium" }).format(t);
// Jun 30, 7:41 AM
export const dateTimeNoYear = t => formatter({ month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(t);
// Wednesday, June 30, 2021
export const weekdayDate = t => formatter({ dateStyle: "full" }).format(t);

// The following options are helpful for placeholders
// yyyy/mm/dd
export const dateShortFormat = () => locales[dateFormatLangDateFns()].formatLong.date({ width: 'short' });
// about 1 hour [ago]
export const distanceToNow = (t, addSuffix) => formatDistanceToNow(t, { locale: locales[dateFormatLangDateFns()], addSuffix });

// Parse a string localized date like 30.06.21 to a Date Object
export function parseShortDate(dateStr) {
    const parsed = parse(dateStr, dateShortFormat(), new Date());

    // Strip time which may cause bugs in calendar
    const timePortion = parsed.getTime() % (3600 * 1000 * 24);
    return new Date(parsed - timePortion);
}

/***
 * sorely missing from Intl: https://github.com/tc39/ecma402/issues/6
 * based on https://github.com/unicode-cldr/cldr-core/blob/master/supplemental/weekData.json#L59
 * However, we don't have translations for most locales, and cockpit.language does not even contain
 * the country in most cases, so this is just an approximation.
 * Most locales start the week on Monday (day 1), so default to that and enumerate the others.
 */

const first_dow_sun = ['en', 'ja', 'ko', 'pt', 'pt_BR', 'sv', 'zh_CN', 'zh_TW'];

export function firstDayOfWeek() {
    return first_dow_sun.indexOf(cockpit.language) >= 0 ? 0 : 1;
}
