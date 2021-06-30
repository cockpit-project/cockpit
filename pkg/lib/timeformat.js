/* Wrappers around Intl.DateTimeFormat which use Cockpit's current locale, and define a few standard formats.
 * https://developer.mozilla.org/de/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat
 */
import cockpit from "cockpit";

// this needs to be dynamic, as some pages don't initialize cockpit.language right away
const dateFormatLang = () => cockpit.language.replace('_', '-');

// general Intl.DateTimeFormat formatter object
export const formatter = options => new Intl.DateTimeFormat(dateFormatLang(), options);

// common formatters; try to use these as much as possible, for UI consistency
// 07:41 AM
export const time = t => formatter({ timeStyle: "short" }).format(t);
// 7:41:26 AM
export const timeSeconds = t => formatter({ timeStyle: "medium" }).format(t);
// June 30, 2021
export const date = t => formatter({ dateStyle: "long" }).format(t);
// Jun 30, 2021, 7:41 AM
export const dateTime = t => formatter({ dateStyle: "medium", timeStyle: "short" }).format(t);
// Jun 30, 2021, 7:41:23 AM
export const dateTimeSeconds = t => formatter({ dateStyle: "medium", timeStyle: "medium" }).format(t);
// Wednesday, June 30, 2021
export const weekdayDate = t => formatter({ dateStyle: "full" }).format(t);
