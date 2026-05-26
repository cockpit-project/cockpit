/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/* NOTIFICATIONS
 *
 * A page can broadcast notifications to the rest of Cockpit.  For
 * example, the "Software updates" page can send out a notification when
 * it detects that software updates are available.  The shell will then
 * highlight the menu entry for "Software updates" and the "System"
 * overview page will also mention it in its "Operating system" section.
 *
 * Two mechanisms coexist:
 *
 *  - page_status: legacy per-page status keyed by [host, page].  Used
 *    for shell navigation icons.
 *
 *  - channel() / NotificationChannel: consumer-managed named channels
 *    for broadcast notifications.  A consumer page (e.g. Overview
 *    health) owns a channel name; any producer can publish to it.
 *
 *  - publish_page_health: helper that drives both sinks in one call.
 *
 * The details are all still experimental and subject to change.
 */

import cockpit, { JsonValue, JsonObject } from "cockpit";
import { dequal } from 'dequal/lite';

export interface Status {
    type?: string | null;
    title?: string;
    details?: JsonObject;
}

/* - page_status
 *
 * A page status is either null, or a JSON value with the following
 * fields:
 *
 *  - type (string, optional): one of "info", "warning", "error".  The
 *    shell uses this to put an icon next to the page's navigation
 *    entry.  Omitting it (or using null as the whole status) broadcasts
 *    'details' without forcing an icon into the menu.
 *
 *  - title (string, optional): a short, human-readable, localized
 *    description of the status, suitable for a tooltip.
 *
 *  - details (JSON object, optional): the "System" overview page uses
 *    this to display a richer status than just type + title.  Recognized
 *    properties:
 *
 *      * icon: custom icon name (defaults to standard icon for type)
 *      * pficon: PatternFly icon name, e.g. "enhancement", "bug",
 *        "security", "spinner", "check"; see get_pficon() in
 *        pkg/systemd/page-status.jsx
 *      * link: custom link target (defaults to page name); if false,
 *        the notification will not be a link
 *
 * Usage:
 *
 *   import { page_status } from "notifications";
 *
 *  - page_status.set_own(STATUS): overwrite the calling page's status.
 *    Calling with the same value repeatedly is cheap (dequal dedup).
 *
 *      page_status.set_own({
 *          type: "info",
 *          title: _("Software updates available"),
 *          details: { num_updates: 10, num_security_updates: 5 }
 *      });
 *
 *  - page_status.get(PAGE, [HOST]): retrieve the current status of
 *    PAGE on HOST (HOST defaults to the calling page's host).  PAGE is
 *    the Cockpit URL name, e.g. "system/terminal" or "storage".
 *    Returns undefined until 'valid' is true.
 *
 *  - page_status.addEventListener("changed", ev => ...): fires on any
 *    page status change.
 *
 *  - page_status.valid: false until cockpit.transport.wait() resolves;
 *    flips to true with a "changed" event.
 */

class PageStatus extends EventTarget {
    valid: boolean = false;
    cur_own: Status | null = null;

    constructor() {
        super();
        window.addEventListener("storage", event => {
            if (event.key == "cockpit:page_status") {
                this.dispatchEvent(new CustomEvent("changed"));
            }
        });

        cockpit.transport.wait(() => {
            this.valid = true;
            this.dispatchEvent(new CustomEvent("changed"));
        });
    }

    get(page: string, host?: string): Status | null | undefined {
        let page_status;

        if (!this.valid)
            return undefined;

        if (host === undefined)
            host = cockpit.transport.host;

        try {
            page_status = JSON.parse(sessionStorage.getItem("cockpit:page_status") || "{}");
        } catch {
            return null;
        }

        if (page_status?.[host])
            return page_status[host][page] || null;
        return null;
    }

    set_own(status: Status | null) {
        if (!dequal(status, this.cur_own)) {
            this.cur_own = status;
            cockpit.transport.control("notify", { page_status: status as JsonValue });
        }
    }
}

export const page_status = new PageStatus();

export const CHANNELS_KEY = "cockpit:notification-channels";
export const OVERVIEW_HEALTH_CHANNEL = "overview:health";

// Allowed characters for channel names and publisher-supplied ids.
// Permissive on names like __proto__ / constructor; the registry uses
// Object.create(null) so reserved names are inert.
export const CHANNEL_KEY_RE = /^[A-Za-z0-9_:.\-/]{1,128}$/;

// Cockpit page path, e.g. "updates" or "system/services".  Rejects
// "@host" forms, absolute paths, "..", and URL schemes, so a publisher
// cannot drive cockpit.jump to an arbitrary host.
export const SAFE_LINK_RE = /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/;

export interface ChannelNotification {
    id: string;
    type?: "info" | "warning" | "error" | null;
    title: string;
    details?: JsonObject;
}

export interface ChannelEntry extends ChannelNotification {
    publisher: string;
}

export interface ChannelRegistry {
    [channel: string]: {
        [host: string]: {
            [publisher_key: string]: ChannelNotification;
        };
    };
}

/* - channel(NAME) and NotificationChannel
 *
 * A consumer page owns a channel name (e.g. OVERVIEW_HEALTH_CHANNEL)
 * by being the only place that subscribes to it for display.  Any
 * producer page can publish notifications to that channel.
 *
 * A ChannelNotification has the same shape as a page status, plus a
 * required 'id' that scopes the entry within the publishing page:
 *
 *  - id (string, required): identifies the entry; one publisher can
 *    hold multiple entries by using distinct ids.
 *  - type (string, optional): "info", "warning", "error", or null.
 *  - title (string, required): short, human-readable, localized.
 *  - details (JSON object, optional): the Overview health renderer
 *    recognizes:
 *      * link: Cockpit page path (e.g. "updates", "system/services").
 *        Clicked entries call cockpit.jump("/" + link).  Defaults to
 *        absent (no link).
 *      * pficon: PatternFly icon name passed to get_pficon() in
 *        pkg/systemd/page-status.jsx.  Defaults to the type icon.
 *
 * Usage:
 *
 *   import { channel } from "notifications";
 *
 *  - channel(NAME) returns the (memoized) NotificationChannel object.
 *
 *  - .publish(notification): broadcast a ChannelNotification.  Repeated
 *    publish() with an equal payload is cheap (dequal dedup).
 *
 *  - .clear(id): remove the calling page's entry for id.
 *
 *  - .list(host?): array of current entries for host (default: caller's
 *    host).  Each entry has all ChannelNotification fields plus a
 *    'publisher' string identifying which page/id produced it.  Returns
 *    [] until 'valid' is true.
 *
 *  - .addEventListener("changed", ev => ...): fires on registry change
 *    and once when 'valid' flips to true.
 *
 *  - .valid: false until cockpit.transport.wait() resolves.
 *
 * Validation:
 *
 *  - The shell validates channel name and id against CHANNEL_KEY_RE; a
 *    notify message with any other character (or longer than 128 bytes)
 *    is dropped wholesale before reaching the registry.
 *  - The Overview health renderer validates details.link against
 *    SAFE_LINK_RE and details.pficon against get_pficon()'s allowlist;
 *    non-matching fields are rendered as if absent (no link, type icon).
 */

export class NotificationChannel extends EventTarget {
    readonly name: string;
    valid: boolean = false;
    #last_sent: Map<string, ChannelNotification | null> = new Map();

    constructor(name: string) {
        super();
        this.name = name;

        window.addEventListener("storage", event => {
            if (event.key == CHANNELS_KEY)
                this.dispatchEvent(new CustomEvent("changed"));
        });

        cockpit.transport.wait(() => {
            this.valid = true;
            this.dispatchEvent(new CustomEvent("changed"));
        });
    }

    publish(notification: ChannelNotification): void {
        if (!notification || typeof notification.id !== "string" || notification.id === "")
            throw new Error("NotificationChannel.publish: notification.id is required");

        const prev = this.#last_sent.get(notification.id);
        if (dequal(prev, notification))
            return;

        this.#last_sent.set(notification.id, notification);
        cockpit.transport.control("notify", {
            channel: this.name,
            id: notification.id,
            notification: notification as unknown as JsonValue,
        });
    }

    clear(id: string): void {
        if (this.#last_sent.has(id) && this.#last_sent.get(id) === null)
            return;

        this.#last_sent.set(id, null);
        cockpit.transport.control("notify", {
            channel: this.name,
            id,
            notification: null,
        });
    }

    list(host?: string): ReadonlyArray<ChannelEntry> {
        if (!this.valid)
            return [];

        if (host === undefined)
            host = cockpit.transport.host;

        let registry: ChannelRegistry;
        try {
            registry = JSON.parse(sessionStorage.getItem(CHANNELS_KEY) || "{}");
        } catch {
            return [];
        }

        const slice = registry[this.name]?.[host];
        if (!slice)
            return [];

        return Object.entries(slice).map(([publisher, notification]) => ({
            ...notification,
            publisher,
        }));
    }
}

const channels = new Map<string, NotificationChannel>();

export function channel(name: string): NotificationChannel {
    let ch = channels.get(name);
    if (!ch) {
        ch = new NotificationChannel(name);
        channels.set(name, ch);
    }
    return ch;
}

/* - publish_page_health(page_id, status, opts?)
 *
 * Helper for pages that want to drive both the legacy shell nav icon
 * (via page_status) and the Overview health card (via the channel) in
 * one call.  See updates.jsx and services.jsx for live use.
 *
 *   publish_page_health("updates", status);
 *   publish_page_health("system/services", status, { preserve_details: false });
 *
 *  - page_id: the well-known page name.  Doubles as the channel entry
 *    id and, by default, as details.link.
 *  - status: a Status or null; null clears both sinks.
 *  - opts.channel_name: defaults to OVERVIEW_HEALTH_CHANNEL.
 *  - opts.link: override the default link target.
 *  - opts.preserve_details: false drops status.details on the channel
 *    side (useful when details is an array or otherwise not a
 *    {link, pficon} object).  Defaults to true.
 */

export function publish_page_health(
    page_id: string,
    status: Status | null,
    opts: { channel_name?: string, link?: string, preserve_details?: boolean } = {},
): void {
    page_status.set_own(status);

    const ch = channel(opts.channel_name ?? OVERVIEW_HEALTH_CHANNEL);
    if (status === null) {
        ch.clear(page_id);
        return;
    }

    const preserve = opts.preserve_details ?? true;
    const base: JsonObject = preserve && status.details && typeof status.details === "object" && !Array.isArray(status.details)
        ? { ...status.details }
        : {};
    if (base.link === undefined)
        base.link = opts.link ?? page_id;

    const t = status.type;
    ch.publish({
        id: page_id,
        type: (t === "info" || t === "warning" || t === "error") ? t : null,
        title: status.title ?? "",
        details: base,
    });
}
