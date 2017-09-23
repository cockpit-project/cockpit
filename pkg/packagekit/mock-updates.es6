/*jshint esversion: 6 */

/*
 * Mock "available updates" entries for interactively testing layout changes with large updates
 * To use it, import it in updates.jsx:
 *
 *    import { injectMockUpdates } from "./mock-updates.es6";
 *
 * and call it in loadUpdates()'s Finished: Handler:
 *
 *      Finished: () => {
 *          injectMockUpdates(updates);
 *          let pkg_ids = Object.keys(updates);
 */

export function injectMockUpdates(updates) {
    // two security updates
    updates["security-one;2.3-4"] = {
        name: "security-one",
        version: "2.3-4",
        bug_urls: [],
        cve_urls: ["https://cve.example.com?name=CVE-2014-123456"],
        security: true,
        description: "This will wreck your data center!",
    };
    updates["security-two;1-2+sec1"] = {
        name: "security-two",
        version: "1-2+sec1",
        bug_urls: [],
        cve_urls: ["https://cve.example.com?name=CVE-2014-54321"],
        security: true,
        description: "Mostly Harmless",
    };

    // source with many binaries
    for (let i = 1; i < 50; ++i) {
        let name = `manypkgs${i}`;
        updates[name + ";1-1"] = {
            name: name,
            version: "1-1",
            bug_urls: [],
            cve_urls: [],
            security: false,
            description: "Make everything better",
        };
    }

    // long changelog
    updates["verbose;1-1"] = {
        name: "verbose",
        version: "1-1",
        bug_urls: [],
        cve_urls: [],
        security: false,
        description: ("Some longish explanation of some boring technical change. " +
            "This is total technobabble gibberish for layman users.\n\n").repeat(30)
    };

    // many bug fixes
    var bugs = [];
    for (let i = 10000; i < 10025; ++i)
        bugs.push("http://bugzilla.example.com/" + i);
    updates["buggy;1-1"] = {
        name: "buggy",
        version: "1-1",
        bug_urls: bugs,
        cve_urls: [],
        security: false,
        description: "This is FUBAR",
    };
}

