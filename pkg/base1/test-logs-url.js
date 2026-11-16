/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import QUnit from "qunit-tests";
import { linkifyText, renderMessageWithUrls } from "logs-url.jsx";

QUnit.test("linkifyText: plain text and edge cases", assert => {
    assert.deepEqual(linkifyText(""), [{ type: "text", content: "" }], "empty string");
    assert.deepEqual(linkifyText("Plain log with no URLs"),
                     [{ type: "text", content: "Plain log with no URLs" }],
                     "plain string without URLs");
});

QUnit.test("linkifyText: standard URLs", assert => {
    const input = "Visit https://auth.openai.com/codex/device to authenticate";
    const parts = linkifyText(input);

    assert.equal(parts.length, 3, "splits into 3 parts");
    assert.deepEqual(parts[0], { type: "text", content: "Visit " });
    assert.deepEqual(parts[1], { type: "url", url: "https://auth.openai.com/codex/device" });
    assert.deepEqual(parts[2], { type: "text", content: " to authenticate" });
});

QUnit.test("linkifyText: URL at beginning and end of message", assert => {
    const atStart = "https://example.com/start is the beginning";
    const startParts = linkifyText(atStart);
    assert.equal(startParts.length, 2);
    assert.deepEqual(startParts[0], { type: "url", url: "https://example.com/start" });
    assert.deepEqual(startParts[1], { type: "text", content: " is the beginning" });

    const atEnd = "Ends with https://example.com/end";
    const endParts = linkifyText(atEnd);
    assert.equal(endParts.length, 2);
    assert.deepEqual(endParts[0], { type: "text", content: "Ends with " });
    assert.deepEqual(endParts[1], { type: "url", url: "https://example.com/end" });
});

QUnit.test("linkifyText: trailing punctuation and delimiters", assert => {
    const cases = [
        {
            input: "Check https://example.com/api.",
            expectedUrl: "https://example.com/api",
            trailing: "."
        },
        {
            input: "Docs at https://example.com/docs,",
            expectedUrl: "https://example.com/docs",
            trailing: ","
        },
        {
            input: "See (https://example.com/info)",
            expectedUrl: "https://example.com/info",
            trailing: ")"
        },
        {
            input: "Wiki: https://en.wikipedia.org/wiki/URL_(disambiguation)",
            expectedUrl: "https://en.wikipedia.org/wiki/URL_(disambiguation)",
            trailing: ""
        },
        {
            input: "Notice: https://example.com/notice:",
            expectedUrl: "https://example.com/notice",
            trailing: ":"
        },
        {
            input: "Warning! See https://example.com/warn!",
            expectedUrl: "https://example.com/warn",
            trailing: "!"
        },
        {
            input: "Question? See https://example.com/faq?",
            expectedUrl: "https://example.com/faq",
            trailing: "?"
        },
        {
            input: "Quotes: 'https://example.com/test' and \"https://example.com/other\"",
            expectedUrls: ["https://example.com/test", "https://example.com/other"]
        }
    ];

    cases.forEach(({ input, expectedUrl, expectedUrls, trailing }) => {
        const parts = linkifyText(input);
        const urls = parts.filter(p => p.type === "url").map(p => p.url);
        if (expectedUrl) {
            assert.equal(urls[0], expectedUrl, `Extracted ${expectedUrl}`);
            if (trailing) {
                const last = parts[parts.length - 1];
                assert.ok(last.content.endsWith(trailing), `Trailing contains ${trailing}`);
            }
        } else if (expectedUrls) {
            assert.deepEqual(urls, expectedUrls, "Extracted all URLs in quotes");
        }
    });
});

QUnit.test("linkifyText: ANSI escape codes and multiple URLs", assert => {
    const input = "\u001B[1;31mGive Feedback: https://github.com/BerriAI/litellm/issues/new\u001B[0m and https://example.org";
    const parts = linkifyText(input);
    const urls = parts.filter(p => p.type === "url").map(p => p.url);

    assert.deepEqual(urls, [
        "https://github.com/BerriAI/litellm/issues/new",
        "https://example.org"
    ], "Extracted URLs without ANSI codes");
});

QUnit.test("renderMessageWithUrls: renders clickable <a> elements without custom event handlers", assert => {
    const plain = "No links here";
    assert.equal(renderMessageWithUrls(plain), plain, "Returns string when no URLs");

    const message = "Visit https://auth.openai.com/codex/device now";
    const rendered = renderMessageWithUrls(message);
    assert.ok(Array.isArray(rendered), "Returns array of elements when URLs present");
    assert.equal(rendered.length, 3, "3 parts: text, link, text");

    const link = rendered[1];
    assert.equal(link.type, "a", "Rendered as <a> element");
    assert.equal(link.props.href, "https://auth.openai.com/codex/device", "Correct href");
    assert.equal(link.props.target, "_blank", "Opens in new tab");
    assert.equal(link.props.rel, "noopener noreferrer", "Secure rel attribute");
    assert.equal(link.props.className, "cockpit-log-url", "Has cockpit-log-url class");

    // Anchor relies on normal browser navigation and keyboard accessibility without custom event handlers
    assert.equal(link.props.onClick, undefined, "No unnecessary onClick handler on anchor");
    assert.equal(link.props.onKeyDown, undefined, "No unnecessary onKeyDown handler on anchor");
});

QUnit.test("Row event handling: ignores clicks and enter on links", assert => {
    function shouldNavigateRow(ev) {
        if (ev.type === "click") {
            if (ev.button !== 0 || ev.target.closest("a"))
                return false;
            return true;
        }
        if (ev.type === "KeyDown") {
            if (ev.key !== "Enter" || ev.target.closest("a"))
                return false;
            return true;
        }
        return false;
    }

    const fakeLink = document.createElement("a");
    const fakeRow = document.createElement("div");

    assert.notOk(shouldNavigateRow({ type: "click", button: 0, target: fakeLink }),
                 "Click on <a> does not navigate");
    assert.notOk(shouldNavigateRow({ type: "KeyDown", key: "Enter", target: fakeLink }),
                 "Enter on <a> does not navigate");
    assert.ok(shouldNavigateRow({ type: "click", button: 0, target: fakeRow }),
              "Click on row navigates");
    assert.ok(shouldNavigateRow({ type: "KeyDown", key: "Enter", target: fakeRow }),
              "Enter on row navigates");
});

QUnit.start();
