import QUnit from "qunit-tests";

import { transport_globals } from 'cockpit/_internal/transport';
import { Channel, ChannelControlMessage, ChannelOptions, ChannelPayload } from 'cockpit/channel';

// simple function to 'use' values (to avoid 'unused' warnings)
function use(..._args: unknown[]) {
}

// Many of the functions in this file are not designed to run, but to be
// typechecked.  Here's some assertions for the types we'll check.
function is_str(_x: string): void {
}

function is_bytes(_x: Uint8Array): void {
}

// verify that type assertions are fundamentally working the way we think
function verify_type_assertions() {
    const bytes = new Uint8Array();
    const str = "";

    // These are positive assertions
    is_str(str);
    is_bytes(bytes);

    // These are typing fails.  tsc will verify that they fail.
    // @ts-expect-error Cannot pass bytes to is_str()
    is_str(bytes);

    // @ts-expect-error Cannot pass string to is_bytes()
    is_bytes(str);
}

function is_str_channel(x: Channel<string>): void {
    x.on('data', msg => is_str(msg));

    // @ts-expect-error: of course string channels don't get binary data...
    x.on('data', msg => is_bytes(msg));
}

function is_bytes_channel(x: Channel<Uint8Array>): void {
    x.on('data', msg => is_bytes(msg));

    // @ts-expect-error: of course binary channels don't get string data...
    x.on('data', msg => is_str(msg));
}

// tsc seems to have inconsistent treatment of `void` argument types when
// things get complicated.  If this ever gets fixed, search for 'VOID BUG'
// and adjust each test

// https://github.com/microsoft/TypeScript/issues/29131

// This is equivalent to 'void', but tsc treats it weirdly
type AlwaysVoid<P> = P extends string ? void : void;
function simple_void(_x: void): void { }
function weird_void<P>(_x: AlwaysVoid<P>): void { }
class VoidCtor<P> { constructor(x: AlwaysVoid<P>) { use(x) } }
class VoidCtorSubclass extends VoidCtor<unknown> { }
function test_void_weirdness() {
    const v = (() => {})(); // get a value of type 'void'

    // This works just fine
    simple_void();
    // @ts-expect-error But this doesn't work
    weird_void();
    weird_void(v); // but we can demonstrate that `void` is indeed accepted here

    // @ts-expect-error This doesn't work
    use(new VoidCtor<unknown>());
    use(new VoidCtor<unknown>(v)); // ... even though 'void' is the argument type

    // ...but for some reason this works, even though it's the very same function
    use(new VoidCtorSubclass());
}

function test_channel_api_types() {
    // @ts-expect-error: It's not valid to create a channel with no args
    const no_args_channel = new Channel();
    use(no_args_channel);

    // @ts-expect-error: It's not valid to create a channel with no payload
    const no_payload_channel = new Channel({});
    use(no_payload_channel);

    // @ts-expect-error: It's not valid to create a channel with no payload
    const text_no_payload_channel = new Channel({ binary: false });
    use(text_no_payload_channel);

    // @ts-expect-error: It's not valid to create a channel with no payload
    const bytes_no_payload_channel = new Channel({ binary: true });
    use(bytes_no_payload_channel);

    // This how to create a valid text channel
    const text_channel = new Channel({ payload: 'echo' });
    is_str_channel(text_channel);

    // This is also fine, if you like to be explicit
    const explicit_type_text_channel = new Channel<string>({ payload: 'echo' });
    is_str_channel(explicit_type_text_channel);

    // ...another way to be explicit
    const explicit_opt_text_channel = new Channel({ payload: 'echo', binary: false });
    is_str_channel(explicit_opt_text_channel);

    // Or why not both at once?
    const very_explicit_text_channel = new Channel<string>({ payload: 'echo', binary: false });
    is_str_channel(very_explicit_text_channel);

    // Binary channels need to specify both the type and the flag
    const binary_channel = new Channel<Uint8Array>({ payload: 'echo', binary: true });
    is_bytes_channel(binary_channel);

    // Unfortunately we can't detect Channel<Uint8Array> based on `binary: true`
    // without engaging a seriously advanced level of typing gymnastics (which
    // would introduce other drawbacks).
    // @ts-expect-error It would be nice if this were possible...
    const autodetect_binary_channel = new Channel({ payload: 'echo', binary: true });
    use(autodetect_binary_channel);

    // But, directly using the new channel in a typed context should hint the
    // correct type without explicitly specifying it, which will be the usual case.
    is_str_channel(new Channel({ payload: 'echo' }));
    is_str_channel(new Channel({ payload: 'echo', binary: false }));
    is_bytes_channel(new Channel({ payload: 'echo', binary: true }));

    // The opposite should all be impossible
    // @ts-expect-error should not be able to convince a text channel that it's binary
    is_bytes_channel(new Channel({ payload: 'echo' }));
    // @ts-expect-error should not be able to convince a text channel that it's binary
    is_bytes_channel(new Channel({ payload: 'echo', binary: false }));
    // @ts-expect-error should not be able to convince a binary channel that it's text
    is_str_channel(new Channel({ payload: 'echo', binary: true }));

    // Explicitly giving the wrong type parameter should also be forbidden
    // @ts-expect-error should not be able to convince a text channel that it's binary
    const not_text_channel = new Channel<Uint8Array>({ payload: 'echo' });
    use(not_text_channel);

    // @ts-expect-error should not be able to convince a text channel that it's binary
    const not_explicit_text_channel = new Channel<Uint8Array>({ payload: 'echo', binary: false });
    use(not_explicit_text_channel);

    // @ts-expect-error should not be able to convince a binary channel that it's text
    const not_binary_channel = new Channel<string>({ payload: 'echo', binary: true });
    use(not_binary_channel);
}

// This is how it looks to create a wrapper API that can open a channel in
// either text or binary mode.
function open_echo<P extends ChannelPayload = string>(options: ChannelOptions<P>): Channel<P> {
    return new Channel({ ...options, payload: 'echo' });
}

// And this is how you use that API:
function test_open_echo_types() {
    const string_echo = open_echo({});
    is_str_channel(string_echo);

    // @ts-expect-error This should be possible because `void` is valid for
    // options but it oddly doesn't work (VOID BUG)
    const string_echo_void = open_echo();
    is_str_channel(string_echo_void);

    const binary_echo = open_echo<Uint8Array>({ binary: true });
    is_bytes_channel(binary_echo);
}

// Demonstrate how to properly do typing on a derived channel type which can be
// opened in either text or binary mode
class EchoChannel<P extends ChannelPayload = string> extends Channel<P> {
    constructor(options: ChannelOptions<P>) {
        super({ ...options, payload: 'echo' });
    }
}

function test_echo_channel_types() {
    const text_echo_channel = new EchoChannel({});
    is_str_channel(text_echo_channel);

    // @ts-expect-error This should also be possible because options can be void
    // but is currently not working (VOID BUG)
    const void_text_echo_channel = new EchoChannel();
    is_str_channel(void_text_echo_channel);

    const binary_echo_channel = new EchoChannel<Uint8Array>({ binary: true });
    is_bytes_channel(binary_echo_channel);
}

// Various subclasses that further derive from EchoChannel to add a specific mode
export class TextEchoChannel extends EchoChannel<string> {
    constructor() {
        super({ binary: false });
    }
}

export class TextEchoChannelDefaultArg extends EchoChannel<string> {
    constructor() {
        super({ });
    }
}

export class TextEchoChannelTrivial extends EchoChannel<string> {
    // eslint-disable-next-line no-useless-constructor
    constructor() {
        super();
    }
}

export class TextEchoChannelNoConstructor extends EchoChannel<string> {
    // this is fine, will be checked at instantiation
}

export class BinaryEchoChannel extends EchoChannel<Uint8Array> {
    constructor() {
        super({ binary: true });
    }
}

export class BinaryEchoChannelNoConstructor extends EchoChannel<Uint8Array> {
    // this is fine, but users will be required to pass `{ binary: true } for themselves
}

function test_fixed_type_echo_channels_types() {
    const text_echo_channel = new TextEchoChannel();
    is_str_channel(text_echo_channel);

    const text_echo_channel_default_arg = new TextEchoChannelDefaultArg();
    is_str_channel(text_echo_channel_default_arg);

    const text_echo_channel_trivial = new TextEchoChannelTrivial();
    is_str_channel(text_echo_channel_trivial);

    // This is really the same as the other cases of passing no arguments (and
    // indeed, we're directly calling the constructor on EchoChannel, but this
    // time it works for some reason.  VOID BUG doesn't affect this case?
    const text_echo_channel_no_constructor = new TextEchoChannelNoConstructor();
    is_str_channel(text_echo_channel_no_constructor);

    // @ts-expect-error Of course this is invalid...
    const text_binary_channel = new TextEchoChannelNoConstructor({ binary: true });
    is_str_channel(text_binary_channel);

    const binary_echo_channel = new BinaryEchoChannel();
    is_bytes_channel(binary_echo_channel);

    // We need to pass the `binary: true` flag ourselves since there's no
    // constructor in this class to provide it for us.
    const binary_echo_no_ctor = new BinaryEchoChannelNoConstructor({ binary: true });
    is_bytes_channel(binary_echo_no_ctor);

    // @ts-expect-error If we forget to pass the flag, it's an error
    const binary_echo_no_arg = new BinaryEchoChannelNoConstructor();
    is_bytes_channel(binary_echo_no_arg);

    // @ts-expect-error If we pass the wrong flag, it's an error
    const binary_echo_wrong_arg = new BinaryEchoChannelNoConstructor({ binary: false });
    is_bytes_channel(binary_echo_wrong_arg);
}

// These three subclasses are incorrectly implemented and will trigger errors
export class BrokenTextEchoChannelWrongConstructor extends EchoChannel<string> {
    constructor() {
        // @ts-expect-error must specify binary: false for string channel
        super({ binary: true });
    }
}

export class BrokenBinaryEchoChannelWrongConstructor extends EchoChannel<Uint8Array> {
    constructor() {
        // @ts-expect-error must specify binary: true for Uint8Array channel
        super({ binary: false });
    }
}

export class BrokenBinaryEchoChannelTrivialConstructor extends EchoChannel<Uint8Array> {
    // eslint-disable-next-line no-useless-constructor
    constructor() {
        // @ts-expect-error must specify binary: true for Uint8Array channel
        super();
    }
}

// Demonstrate typing on a function that can open a channel in either mode
function open_echo_subclass<P extends ChannelPayload = string>(options: ChannelOptions<P>): EchoChannel<P> {
    return new EchoChannel(options);
}

function is_echo_channel<P extends ChannelPayload>(_channel: EchoChannel<P>) {
}

function test_open_echo_subclass_type() {
    // @ts-expect-error VOID BUG is back again in this case...
    const no_arg = open_echo_subclass();
    is_echo_channel<string>(no_arg);

    // legit calls
    const empty_arg = open_echo_subclass({});
    is_echo_channel<string>(empty_arg);

    const false_arg = open_echo_subclass({ binary: false });
    is_echo_channel<string>(false_arg);

    const true_arg = open_echo_subclass<Uint8Array>({ binary: true });
    is_echo_channel<Uint8Array>(true_arg);

    // inferred type from context
    is_echo_channel<string>(open_echo_subclass({}));
    is_echo_channel<string>(open_echo_subclass({ binary: false }));
    is_echo_channel<Uint8Array>(open_echo_subclass({ binary: true }));

    // and the 'wrong' versions
    // @ts-expect-error Can't have a binary channel with no args
    is_echo_channel<Uint8Array>(open_echo_subclass({}));
    // @ts-expect-error Can't have a binary channel with binary: false
    is_echo_channel<Uint8Array>(open_echo_subclass({ binary: false }));
    // @ts-expect-error Can't have a text channel with binary: true
    is_echo_channel<string>(open_echo_subclass({ binary: true }));
}

// Demonstrate usage of above classes and functions
function test_payload_types() {
    const text_channel = new Channel({ payload: 'echo' });
    text_channel.on('data', msg => {
        is_str(msg);

        // @ts-expect-error This should be a string
        is_bytes(msg);
    });
    text_channel.send_data('');
    // @ts-expect-error Can't send binary data on text channels
    text_channel.send_data(new Uint8Array());

    const binary_channel = new Channel<Uint8Array>({ payload: 'echo', binary: true });
    binary_channel.on('data', msg => {
        is_bytes(msg);

        // @ts-expect-error This should be a Uint8Array
        is_str(msg);
    });
    binary_channel.send_data(new Uint8Array());
    // @ts-expect-error Can't send text data on binary channels
    binary_channel.send_data('');
}

export function test_unknown_payload(binary: boolean) {
    // The type of a channel with unknown payload is Channel<ChannelPayload>
    const unknown0 = new Channel<ChannelPayload>({ payload: 'echo', binary });

    // Upcasting to the unknown type is always valid
    const unknown1: Channel<ChannelPayload> =
        new Channel<string>({ payload: 'echo' });
    use(unknown1);
    const unknown2: Channel<ChannelPayload> =
        new Channel<Uint8Array>({ payload: 'echo', binary: true });
    use(unknown2);

    // @ts-expect-error Downcasting is not valid
    const known1: Channel<string> = unknown0;
    use(known1);
    // @ts-expect-error Downcasting is not valid
    const known2: Channel<string> = unknown0;
    use(known2);

    // It's possible to directly construct the unknown type with any binary flag
    const unknown3 = new Channel<ChannelPayload>({ payload: 'echo' });
    use(unknown3);
    const unknown4 = new Channel<ChannelPayload>({ payload: 'echo', binary: true });
    use(unknown4);
    const unknown5 = new Channel<ChannelPayload>({ payload: 'echo', binary: false });
    use(unknown5);

    unknown0.on('data', msg => {
        // @ts-expect-error msg on unknown payload channel is not str
        is_str(msg);
        // @ts-expect-error msg on unknown payload channel is not bytes
        is_bytes(msg);
    });

    // Unfortunately, because of how the types work, either of these works.
    // Fortunately, it's unproblematic at the protocol implementation level.
    unknown0.send_data(new Uint8Array());
    unknown0.send_data('');
}

// This is all just to verify various properties of the static typing
// Nothing will run this, so we export it to avoid an 'unused' warning
export function test_typing() {
    verify_type_assertions();
    test_void_weirdness();
    test_channel_api_types();
    test_open_echo_types();
    test_echo_channel_types();
    test_fixed_type_echo_channels_types();
    test_open_echo_subclass_type();
    test_payload_types();
}

// Actual dynamic tests start here
// This test must be the first test — it tests global transport startup
QUnit.test("test startup queue", async assert => {
    assert.equal(transport_globals.default_transport, null, 'no transport yet');

    const echo = new Channel({ payload: 'echo' });
    // queue up a bunch of data before our first `await`
    echo.send_data('a');
    echo.send_control({ command: 'x' });
    echo.send_data('b');
    echo.send_control({ command: 'y' });
    echo.send_data('c');
    echo.send_control({ command: 'z' });
    echo.done();

    const incoming_messages: (string | ChannelControlMessage)[] = [];
    echo.on('data', msg => incoming_messages.push(msg));
    echo.on('control', msg => incoming_messages.push(msg));
    echo.on('done', msg => incoming_messages.push(msg));
    echo.on('close', msg => incoming_messages.push(msg));

    // now we await.  the Transport will come online here and our outgoing
    // queue will drain then we'll receive our results.
    assert.false(transport_globals.default_transport?.ready, 'transport not ready');
    assert.true(echo.toString().includes('waiting for transport'), 'waiting for transport');
    assert.equal(echo.id, null, 'null ID');

    await echo.wait();

    assert.true(transport_globals.default_transport?.ready, 'transport now ready');
    assert.false(echo.toString().includes('waiting'), 'no longer waiting for anything');
    assert.notEqual(echo.id, null, 'non-null ID');

    // echo channel echos only data, not control
    // but we will get done/close anyway
    const expected_incoming_messages = [
        'a',
        'b',
        'c',
        { command: 'done', channel: echo.id },
        { command: 'close', channel: echo.id },
    ];

    // wait until we have all of our expected messages, up to 1s
    for (let i = 0; i < 100; i++) {
        if (incoming_messages.length === expected_incoming_messages.length)
            break;
        await new Promise(resolve => window.setTimeout(resolve, 10));
    }

    assert.deepEqual(incoming_messages, expected_incoming_messages, 'received echoed messages');
    assert.true(echo.toString().includes('closed'), 'channel closed');
});

QUnit.test("simple channel api", async assert => {
    const binary_foo = new TextEncoder().encode('foo');

    const echo = new Channel({ payload: 'echo' });
    assert.true(echo.toString().includes('waiting for open'), 'waiting for open');
    await echo.wait();
    assert.true(echo.toString().includes('opened'), 'opened');
    echo.send_data('foo');
    const unknown_echo: Channel<ChannelPayload> = echo;
    unknown_echo.send_data(binary_foo);
    // make sure it comes back as a string
    assert.equal(await new Promise(resolve => echo.on('data', resolve)), 'foo');
    echo.done();
    await new Promise(resolve => echo.on('done', resolve));
    await new Promise(resolve => echo.on('close', resolve));
    assert.true(echo.toString().includes('closed'), 'opened');

    const binary_echo = new Channel<Uint8Array>({ payload: 'echo', binary: true });
    await echo.wait();
    const unknown_binary_echo: Channel<ChannelPayload> = binary_echo;
    unknown_binary_echo.send_data('foo'); // send a string on a binary channel
    // make sure it comes back as binary
    assert.deepEqual(await new Promise(resolve => binary_echo.on('data', resolve)), binary_foo);
    binary_echo.done();
    await new Promise(resolve => binary_echo.on('done', resolve));
    await new Promise(resolve => binary_echo.on('close', resolve));
});

QUnit.test("unsupported channel", async assert => {
    const not_supported = new Channel({ payload: 'nonesuch' });
    let err = null;
    try {
        await not_supported.wait();
    } catch (exc) {
        err = exc as ChannelControlMessage; // yaya
    }
    assert.equal(err?.problem, 'not-supported');
    assert.true(not_supported.toString().includes('error not-supported'), 'got error');
});

QUnit.test("close with error", async assert => {
    const channel = new Channel({ payload: 'nonesuch' });

    let closed = null;
    channel.on('close', msg => { closed = msg });
    channel.close('xyz', { extra: 55 });
    assert.deepEqual(closed, { command: 'close', problem: 'xyz', extra: 55 });

    let err = null;
    try {
        await channel.wait();
    } catch (exc) {
        err = exc as ChannelControlMessage; // yaya;
    }
    assert.equal(err?.problem, 'xyz');
});

QUnit.test("no signals after manual close", async assert => {
    let saw_data = false;

    const channel = new Channel({ payload: 'echo' });
    channel.on('data', () => { saw_data = true });
    channel.send_data('a');
    channel.send_data('b');
    channel.send_data('c');
    channel.close();

    let err = null;
    try {
        await channel.wait();
    } catch (exc) {
        err = exc;
    }
    assert.deepEqual(err, { command: 'close' });

    // wait for any extra signals
    await new Promise(resolve => window.setTimeout(resolve, 100));
    assert.false(saw_data, 'no data callbacks after close');
});

QUnit.start();
