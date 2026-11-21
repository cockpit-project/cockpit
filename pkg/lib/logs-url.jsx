/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React from "react";

/**
 * Parses a string and splits it into text and URL tokens.
 * Trims trailing sentence punctuation unless part of balanced parentheses.
 *
 * @param {string} text - The input string to parse.
 * @returns {Array<{type: 'text'|'url', content?: string, url?: string}>}
 */
export function linkifyText(text) {
    if (!text)
        return [{ type: "text", content: "" }];

    // Match http or https URLs, avoiding control chars (\x00-\x1f, \x7f), whitespace, and common delimiters
    // eslint-disable-next-line no-control-regex
    const urlRegex = /https?:\/\/[^\s<>"'`\x00-\x1f\x7f]+/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = urlRegex.exec(text)) !== null) {
        let url = match[0];
        const urlIndex = match.index;

        // Strip trailing sentence punctuation if not part of balanced pair
        let trailingPunctuation = "";
        while (url.length > 0) {
            const lastChar = url[url.length - 1];
            if (['.', ',', ';', ':', '!', '?', "'", '"', '>'].includes(lastChar)) {
                trailingPunctuation = lastChar + trailingPunctuation;
                url = url.slice(0, -1);
            } else if (lastChar === ')') {
                let openCount = 0;
                let closeCount = 0;
                for (let i = 0; i < url.length; i++) {
                    const c = url.charCodeAt(i);
                    if (c === 40)
                        openCount++;
                    else if (c === 41)
                        closeCount++;
                }
                if (closeCount > openCount) {
                    trailingPunctuation = lastChar + trailingPunctuation;
                    url = url.slice(0, -1);
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        if (urlIndex > lastIndex) {
            parts.push({ type: "text", content: text.slice(lastIndex, urlIndex) });
        }

        if (url) {
            parts.push({ type: "url", url });
        }

        if (trailingPunctuation) {
            parts.push({ type: "text", content: trailingPunctuation });
        }

        lastIndex = urlIndex + match[0].length;
    }

    if (parts.length === 0)
        return [{ type: "text", content: text }];

    if (lastIndex < text.length) {
        parts.push({ type: "text", content: text.slice(lastIndex) });
    }

    return parts;
}

/**
 * Renders a log message with detected URLs as clickable <a> links.
 *
 * @param {string} message - The log message string.
 * @returns {React.ReactNode}
 */
export function renderMessageWithUrls(message) {
    if (!message || message.indexOf("http") === -1)
        return message;

    const parts = linkifyText(message);
    if (parts.length === 1 && parts[0].type === "text")
        return message;

    return parts.map((part, index) => {
        if (part.type === "url") {
            return (
                <a
                    key={index}
                    className="cockpit-log-url"
                    href={part.url}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    {part.url}
                </a>
            );
        }
        return part.content;
    });
}
