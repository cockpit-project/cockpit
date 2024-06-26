/* Wrappers around Intl.DateTimeFormat and date-fns which use Cockpit's current locale, and define a few standard formats.
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
 *
 * Time stamps are given in milliseconds since the epoch.
 */
import cockpit from "cockpit";
import { formatDistanceToNow } from 'date-fns';
import * as locales from 'date-fns/locale';

// this needs to be dynamic, as some pages don't initialize cockpit.language right away
export const dateFormatLang = (): string => cockpit.language.replace('_', '-');

const dateFormatLangDateFns = (): string => {
    if (cockpit.language == "en") return "enUS";
    else return cockpit.language.replace('_', '');
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dateFnsLocale = (): any => (locales as any)[dateFormatLangDateFns()];

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

// about 1 hour [ago]
export const distanceToNow = (t: Time, addSuffix?: boolean): string => formatDistanceToNow(t, {
    locale: dateFnsLocale(),
    addSuffix: addSuffix ?? false
});

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
