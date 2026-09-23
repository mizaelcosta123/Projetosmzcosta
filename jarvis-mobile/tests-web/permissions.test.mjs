/**
 * Asking the browser for things, and reading the answer honestly.
 *
 * The bugs this guards against are all mistranslations: an insecure origin
 * reported as a refusal, a browser that has never heard of a permission
 * reported as a refusal, a TypeError from an undefined `mediaDevices` shown
 * to a person as if it meant something. Each one sends the user to the wrong
 * place -- usually to browser settings, where there is nothing to fix.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PERMISSIONS,
  SAYS,
  STATE,
  find,
  inspect,
  secure,
} from '../web/permissions.js';

/** Install a fake browser for one test and take it away afterwards. */
function browser({ https = true, permissions, mediaDevices, geolocation, Notification } = {}) {
  const before = {
    isSecureContext: globalThis.isSecureContext,
    navigator: globalThis.navigator,
    location: globalThis.location,
    Notification: globalThis.Notification,
  };
  const set = (key, value) => Object.defineProperty(globalThis, key, {
    value, configurable: true, writable: true,
  });
  set('isSecureContext', https);
  set('location', { protocol: https ? 'https:' : 'http:', hostname: 'exemplo.test' });
  set('navigator', { permissions, mediaDevices, geolocation });
  set('Notification', Notification);
  return () => {
    for (const [key, value] of Object.entries(before)) set(key, value);
  };
}

/** A getUserMedia that hands back tracks and counts the ones stopped. */
function fakeMedia(behaviour) {
  const stopped = [];
  return {
    stopped,
    devices: {
      getUserMedia: async (constraints) => {
        if (behaviour) throw behaviour;
        return {
          getTracks: () => [
            { kind: constraints.audio ? 'audio' : 'video', stop() { stopped.push(this.kind); } },
          ],
        };
      },
    },
  };
}

// -- the shape of the list ---------------------------------------------------

test('every permission can be both read and asked for', () => {
  // The whole point: a query never prompts, so a row that could only query
  // would sit saying "vai perguntar" forever.
  for (const entry of PERMISSIONS) {
    assert.equal(typeof entry.read, 'function', entry.id);
    assert.equal(typeof entry.ask, 'function', entry.id);
  }
});

test('every permission says what it is for', () => {
  for (const entry of PERMISSIONS) {
    assert.ok(entry.label, entry.id);
    assert.ok(entry.why && entry.why.length > 10, `${entry.id} precisa dizer para quê`);
  }
});

test('every state has wording a person can read', () => {
  for (const key of Object.keys(STATE)) {
    assert.ok(SAYS[key], `falta texto para ${key}`);
  }
});

test('the ones he actually needs are all here', () => {
  const ids = PERMISSIONS.map((entry) => entry.id);
  for (const id of ['microphone', 'camera', 'geolocation']) {
    assert.ok(ids.includes(id), `falta ${id}`);
  }
});

test('find returns the entry, and nothing for a name nobody knows', () => {
  assert.equal(find('camera')?.label, 'Câmera');
  assert.equal(find('telepatia'), undefined);
});

// -- the secure-context question --------------------------------------------

test('https is a place where things may be asked', () => {
  const undo = browser({ https: true });
  assert.equal(secure(), true);
  undo();
});

test('plain http is not', () => {
  const undo = browser({ https: false });
  assert.equal(secure(), false);
  undo();
});

test('http is reported as http, never as a refusal', async () => {
  /* The difference decides where the user is sent. "Bloqueado" sends them to
     browser settings, where there is nothing to fix; the actual fix is the
     address bar. */
  const undo = browser({ https: false });
  const states = await inspect();
  for (const entry of PERMISSIONS) {
    if (entry.id === 'notifications') continue; // reads Notification, not the origin
    assert.equal(states[entry.id], STATE.insecure, entry.id);
  }
  undo();
});

test('and asking over http explains the address rather than the permission', async () => {
  const undo = browser({ https: false });
  const { state, note } = await find('camera').ask();
  assert.equal(state, STATE.insecure);
  assert.match(note, /https/i);
  undo();
});

// -- reading without prompting ----------------------------------------------

test('a granted permission reads as granted', async () => {
  const undo = browser({
    permissions: { query: async () => ({ state: 'granted' }) },
  });
  assert.equal(await find('camera').read(), STATE.granted);
  undo();
});

test('a browser that has never heard of the permission is unknown, not denied', async () => {
  /* Firefox throws TypeError for name:'camera' -- and the camera works there.
     Drawing that as a refusal would be a lie with a red dot on it. */
  const undo = browser({
    permissions: { query: async () => { throw new TypeError('camera is not a valid enum value'); } },
  });
  assert.equal(await find('camera').read(), STATE.unknown);
  undo();
});

test('a browser with no Permissions API at all is unknown too', async () => {
  const undo = browser({ permissions: undefined });
  assert.equal(await find('microphone').read(), STATE.unknown);
  undo();
});

test('inspect reports on everything at once', async () => {
  const undo = browser({
    permissions: { query: async () => ({ state: 'prompt' }) },
    Notification: { permission: 'default' },
  });
  const states = await inspect();
  assert.deepEqual(Object.keys(states).sort(), PERMISSIONS.map((e) => e.id).sort());
  assert.equal(states.microphone, STATE.prompt);
  assert.equal(states.notifications, STATE.prompt);
  undo();
});

// -- asking, which is the part that prompts ---------------------------------

test('a granted microphone gives the hardware straight back', async () => {
  /* Holding the stream open to prove the permission would leave the recording
     light on for as long as the settings sheet is open. */
  const media = fakeMedia(null);
  const undo = browser({ mediaDevices: media.devices });
  const { state } = await find('microphone').ask();
  assert.equal(state, STATE.granted);
  assert.deepEqual(media.stopped, ['audio']);
  undo();
});

test('a refusal is a refusal, and says where it can be undone', async () => {
  const media = fakeMedia(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
  const undo = browser({ mediaDevices: media.devices });
  const { state, note } = await find('camera').ask();
  assert.equal(state, STATE.denied);
  // A page cannot undo a denial; only the browser's own UI can.
  assert.match(note, /cadeado|navegador/i);
  undo();
});

test('no camera on the device is missing, not denied', async () => {
  const media = fakeMedia(Object.assign(new Error('none'), { name: 'NotFoundError' }));
  const undo = browser({ mediaDevices: media.devices });
  const { state } = await find('camera').ask();
  assert.equal(state, STATE.missing);
  undo();
});

test('another app holding the camera says so, and says what to do', async () => {
  const media = fakeMedia(Object.assign(new Error('busy'), { name: 'NotReadableError' }));
  const undo = browser({ mediaDevices: media.devices });
  const { state, note } = await find('camera').ask();
  assert.equal(state, STATE.unknown);
  assert.match(note, /outro aplicativo/i);
  undo();
});

test('mediaDevices missing entirely never throws at the caller', async () => {
  /* On http this is undefined, and `navigator.mediaDevices.getUserMedia(...)`
     throws a TypeError about reading a property of undefined -- which is what
     the user used to be shown. */
  const undo = browser({ https: true, mediaDevices: undefined });
  const { state, note } = await find('camera').ask();
  assert.equal(state, STATE.missing);
  assert.ok(note && !note.includes('undefined'), note);
  undo();
});

// -- location, whose errors are shaped differently --------------------------

test('location granted', async () => {
  const undo = browser({
    geolocation: { getCurrentPosition: (ok) => ok({ coords: { latitude: 0, longitude: 0 } }) },
  });
  assert.equal((await find('geolocation').ask()).state, STATE.granted);
  undo();
});

test('a refused location is a refusal', async () => {
  /* GeolocationPositionError carries a numeric `code` and no `name`, so the
     media path's name check would have read this as an unknown failure. */
  const undo = browser({
    geolocation: { getCurrentPosition: (ok, fail) => fail({ code: 1, message: 'User denied' }) },
  });
  assert.equal((await find('geolocation').ask()).state, STATE.denied);
  undo();
});

test('a location that simply cannot be fixed blames the GPS, not the user', async () => {
  const undo = browser({
    geolocation: { getCurrentPosition: (ok, fail) => fail({ code: 2, message: 'unavailable' }) },
  });
  const { state, note } = await find('geolocation').ask();
  assert.equal(state, STATE.unknown);
  assert.match(note, /GPS/i);
  undo();
});

test('no geolocation API is missing', async () => {
  const undo = browser({ geolocation: undefined });
  assert.equal((await find('geolocation').ask()).state, STATE.missing);
  undo();
});

// -- notifications, which have their own older API --------------------------

test('notifications report what Notification.permission says', async () => {
  for (const [given, want] of [
    ['granted', STATE.granted],
    ['denied', STATE.denied],
    ['default', STATE.prompt],
  ]) {
    const undo = browser({ Notification: { permission: given } });
    assert.equal(await find('notifications').read(), want, given);
    undo();
  }
});

test('a browser with no Notification API is missing, not denied', async () => {
  const undo = browser({ Notification: undefined });
  assert.equal(await find('notifications').read(), STATE.missing);
  undo();
});

test('dismissing the notification prompt is not a refusal', async () => {
  /* Closing the bar without answering leaves it askable. Recording that as
     denied would hide the button that asks again. */
  const undo = browser({
    Notification: { permission: 'default', requestPermission: async () => 'default' },
  });
  const { state } = await find('notifications').ask();
  assert.equal(state, STATE.prompt);
  undo();
});
