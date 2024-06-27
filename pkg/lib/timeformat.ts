/* Wrappers around Intl.DateTimeFormat and date-fns which use Cockpit's current locale, and define a few standard formats.
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
 *
 * Time stamps are given in milliseconds since the epoch.
 */
import cockpit from "cockpit";

const _ = cockpit.gettext;

// this needs to be dynamic, as some pages don't initialize cockpit.language right away
export const dateFormatLang = (): string => cockpit.language.replace('_', '-');

type Time = Date | number;

// general Intl.DateTimeFormat formatter object
export const formatter = (options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(dateFormatLang(), options);

// common formatters; try to use these as much as possible, for UI consistency
// 07:41 AM
export const time = (t: Time): string => formatter({ timeStyle: "short" }).format(t);
// 7:41:26 AM
export const timeSeconds = (t: Time): string => formatter({ timeStyle: "medium" }).format(t);
// June 30, 2021
export const date = (t: Time): string => formatter({ dateStyle: "long" }).format(t);
// 06/30/2021
export const dateShort = (t: Time): string => formatter().format(t);
// Jun 30, 2021, 7:41 AM
export const dateTime = (t: Time): string => formatter({ dateStyle: "medium", timeStyle: "short" }).format(t);
// Jun 30, 2021, 7:41:23 AM
export const dateTimeSeconds = (t: Time): string => formatter({ dateStyle: "medium", timeStyle: "medium" }).format(t);
// Jun 30, 7:41 AM
export const dateTimeNoYear = (t: Time): string => formatter({ month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(t);
// Wednesday, June 30, 2021
export const weekdayDate = (t: Time): string => formatter({ dateStyle: "full" }).format(t);

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat/format
const units: { name: Intl.RelativeTimeFormatUnit, max: number }[] = [
    { name: "second", max: 60 },
    { name: "minute", max: 3600 },
    { name: "hour", max: 86400 },
    { name: "day", max: 86400 * 7 },
    { name: "week", max: 86400 * 30 },
    { name: "month", max: 86400 * 365 },
    { name: "year", max: Infinity },
];

// "1 hour ago" for past times, "in 1 hour" for future times
export function distanceToNow(t: Time): string {
    // Calculate the difference in seconds between the given date and the current date
    const t_timestamp = t?.valueOf() ?? t;
    const secondsDiff = Math.round((t_timestamp - Date.now()) / 1000);

    // special case for < 1 minute, like date-fns
    // we don't constantly re-render pages and there are delays, so seconds is too precise
    if (secondsDiff <= 0 && secondsDiff > -60)
        return _("less than a minute ago");
    if (secondsDiff > 0 && secondsDiff < 60)
        return _("in less than a minute");

    // find the appropriate unit based on the seconds difference
    const unitIndex = units.findIndex(u => u.max > Math.abs(secondsDiff));
    // get the divisor to convert seconds to the appropriate unit
    const divisor = unitIndex ? units[unitIndex - 1].max : 1;

    const formatter = new Intl.RelativeTimeFormat(dateFormatLang(), { numeric: "auto" });
    return formatter.format(Math.round(secondsDiff / divisor), units[unitIndex].name);
}

/***
 * sorely missing from Intl: https://github.com/tc39/ecma402/issues/6
 * based on https://github.com/unicode-cldr/cldr-core/blob/master/supplemental/weekData.json#L59
 * However, we don't have translations for most locales, and cockpit.language does not even contain
 * the country in most cases, so this is just an approximation.
 * Most locales start the week on Monday (day 1), so default to that and enumerate the others.
 */

const first_dow_sun = ['en', 'ja', 'ko', 'pt', 'pt_BR', 'sv', 'zh_CN', 'zh_TW'];

export function firstDayOfWeek(): number {
    return first_dow_sun.indexOf(cockpit.language) >= 0 ? 0 : 1;
}
