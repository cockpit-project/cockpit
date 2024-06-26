import { is_function, is_object } from './common';

/* ------------------------------------------------------------------------------------
 * An ordered queue of functions that should be called later.
 */

let later_queue = [];
let later_timeout = null;

function later_drain() {
    const queue = later_queue;
    later_timeout = null;
    later_queue = [];
    for (;;) {
        const func = queue.shift();
        if (!func)
            break;
        func();
    }
}

export function later_invoke(func) {
    if (func)
        later_queue.push(func);
    if (later_timeout === null)
        later_timeout = window.setTimeout(later_drain, 0);
}

/* ------------------------------------------------------------------------------------
 * Promises.
 * Based on Q and angular promises, with some jQuery compatibility. See the angular
 * license in COPYING.node for license lineage. There are some key differences with
 * both Q and jQuery.
 *
 *  * Exceptions thrown in handlers are not treated as rejections or failures.
 *    Exceptions remain actual exceptions.
 *  * Unlike jQuery callbacks added to an already completed promise don't execute
 *    immediately. Wait until control is returned to the browser.
 */

function promise_then(state, fulfilled, rejected, updated) {
    if (fulfilled === undefined && rejected === undefined && updated === undefined)
        return null;
    const result = new Deferred();
    state.pending = state.pending || [];
    state.pending.push([result, fulfilled, rejected, updated]);
    if (state.status > 0)
        schedule_process_queue(state);
    return result.promise;
}

function create_promise(state) {
    /* Like jQuery the promise object is callable */
    const self = function Promise(target) {
        if (target) {
            Object.assign(target, self);
            return target;
        }
        return self;
    };

    state.status = 0;

    self.then = function then(fulfilled, rejected, updated) {
        return promise_then(state, fulfilled, rejected, updated) || self;
    };

    self.catch = function catch_(callback) {
        return promise_then(state, null, callback) || self;
    };

    self.finally = function finally_(callback, updated) {
        return promise_then(state, function() {
            return handle_callback(arguments, true, callback);
        }, function() {
            return handle_callback(arguments, false, callback);
        }, updated) || self;
    };

    /* Basic jQuery Promise compatibility */
    self.done = function done(fulfilled) {
        promise_then(state, fulfilled);
        return self;
    };

    self.fail = function fail(rejected) {
        promise_then(state, null, rejected);
        return self;
    };

    self.always = function always(callback) {
        promise_then(state, callback, callback);
        return self;
    };

    self.progress = function progress(updated) {
        promise_then(state, null, null, updated);
        return self;
    };

    self.state = function state_() {
        if (state.status == 1)
            return "resolved";
        if (state.status == 2)
            return "rejected";
        return "pending";
    };

    /* Promises are recursive like jQuery */
    self.promise = self;

    return self;
}

function process_queue(state) {
    const pending = state.pending;
    state.process_scheduled = false;
    state.pending = undefined;
    for (let i = 0, ii = pending.length; i < ii; ++i) {
        state.pur = true;
        const deferred = pending[i][0];
        const fn = pending[i][state.status];
        if (is_function(fn)) {
            deferred.resolve(fn.apply(state.promise, state.values));
        } else if (state.status === 1) {
            deferred.resolve.apply(deferred.resolve, state.values);
        } else {
            deferred.reject.apply(deferred.reject, state.values);
        }
    }
}

function schedule_process_queue(state) {
    if (state.process_scheduled || !state.pending)
        return;
    state.process_scheduled = true;
    later_invoke(function() { process_queue(state) });
}

function deferred_resolve(state, values) {
    let then;
    let done = false;
    if (is_object(values[0]) || is_function(values[0]))
        then = values[0]?.then;
    if (is_function(then)) {
        state.status = -1;
        then.call(values[0], function(/* ... */) {
            if (done)
                return;
            done = true;
            deferred_resolve(state, arguments);
        }, function(/* ... */) {
            if (done)
                return;
            done = true;
            deferred_reject(state, arguments);
        }, function(/* ... */) {
            deferred_notify(state, arguments);
        });
    } else {
        state.values = values;
        state.status = 1;
        schedule_process_queue(state);
    }
}

function deferred_reject(state, values) {
    state.values = values;
    state.status = 2;
    schedule_process_queue(state);
}

function deferred_notify(state, values) {
    const callbacks = state.pending;
    if ((state.status <= 0) && callbacks?.length) {
        later_invoke(function() {
            for (let i = 0, ii = callbacks.length; i < ii; i++) {
                const result = callbacks[i][0];
                const callback = callbacks[i][3];
                if (is_function(callback))
                    result.notify(callback.apply(state.promise, values));
                else
                    result.notify.apply(result, values);
            }
        });
    }
}

export function Deferred() {
    const self = this;
    const state = { };
    self.promise = state.promise = create_promise(state);

    self.resolve = function resolve(/* ... */) {
        if (arguments[0] === state.promise)
            throw new Error("Expected promise to be resolved with other value than itself");
        if (!state.status)
            deferred_resolve(state, arguments);
        return self;
    };

    self.reject = function reject(/* ... */) {
        if (state.status)
            return;
        deferred_reject(state, arguments);
        return self;
    };

    self.notify = function notify(/* ... */) {
        deferred_notify(state, arguments);
        return self;
    };
}

function prep_promise(values, resolved) {
    const result = new Deferred();
    if (resolved)
        result.resolve.apply(result, values);
    else
        result.reject.apply(result, values);
    return result.promise;
}

function handle_callback(values, is_resolved, callback) {
    let callback_output = null;
    if (is_function(callback))
        callback_output = callback();
    if (callback_output && is_function(callback_output.then)) {
        return callback_output.then(function() {
            return prep_promise(values, is_resolved);
        }, function() {
            return prep_promise(arguments, false);
        });
    } else {
        return prep_promise(values, is_resolved);
    }
}
